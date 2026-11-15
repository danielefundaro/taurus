"""MusicXML handling: reading compressed files, joining movements and pages, writing compressed files."""

from __future__ import annotations

import copy
import io
import zipfile
from collections.abc import Sequence
from pathlib import Path
from xml.etree import ElementTree

from .errors import EngineFailure

CONTAINER_PATH = "META-INF/container.xml"
SCORE_PATH = "score.musicxml"
_CONTAINER = (
    '<?xml version="1.0" encoding="UTF-8"?>\n'
    '<container><rootfiles><rootfile full-path="score.musicxml" '
    'media-type="application/vnd.recordare.musicxml+xml"/></rootfiles></container>\n'
)


def parse(data: bytes) -> ElementTree.Element:
    """Parses a score-partwise document produced by an engine. External entities are never resolved."""
    try:
        root = ElementTree.fromstring(data)
    except ElementTree.ParseError as exception:
        raise EngineFailure("malformed MusicXML") from exception
    if root.tag != "score-partwise":
        raise EngineFailure(f"unexpected root element {root.tag}")
    return root


def read(path: Path) -> ElementTree.Element:
    """Reads a plain (.musicxml, .xml) or compressed (.mxl) MusicXML file."""
    data = path.read_bytes()
    if not zipfile.is_zipfile(path):
        return parse(data)
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        return parse(archive.read(root_file(archive)))


def concatenate(documents: Sequence[ElementTree.Element]) -> ElementTree.Element:
    """Joins documents in order, appending the measures of each part to the same part of the first document.

    Used for the movements exported separately by Audiveris and for the pages recognized separately by homr.
    Measures are numbered again from 1, keeping a leading pickup measure as 0.
    """
    if not documents:
        raise EngineFailure("no MusicXML document")
    result = copy.deepcopy(documents[0])
    parts = result.findall("part")
    if not parts:
        raise EngineFailure("MusicXML without parts")
    for document in documents[1:]:
        others = document.findall("part")
        for part, other in zip(parts, others):
            part.extend(copy.deepcopy(measure) for measure in other.findall("measure"))
    for part in parts:
        _renumber(part)
    return result


def remove_titles(root: ElementTree.Element) -> None:
    """Drops work, movement and credit titles: a title read from the image is not reliable and is not used."""
    for name in ("work", "movement-number", "movement-title", "credit"):
        for element in root.findall(name):
            root.remove(element)


def number_parts(root: ElementTree.Element) -> None:
    """Names the parts P1, P2... in order, so that converting the same file twice gives the same part ids."""
    names: dict[str | None, str] = {}
    for number, score_part in enumerate(root.findall("part-list/score-part"), start=1):
        names[score_part.get("id")] = f"P{number}"
        score_part.set("id", f"P{number}")
    for part in root.findall("part"):
        if part.get("id") in names:
            part.set("id", names[part.get("id")])


def measure_count(root: ElementTree.Element) -> int:
    part = root.find("part")
    return 0 if part is None else len(part.findall("measure"))


def to_bytes(root: ElementTree.Element) -> bytes:
    return ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)


def to_compressed(root: ElementTree.Element) -> bytes:
    """Writes the document as a compressed MusicXML (.mxl) archive."""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(CONTAINER_PATH, _CONTAINER)
        archive.writestr(SCORE_PATH, to_bytes(root))
    return output.getvalue()


def root_file(archive: zipfile.ZipFile) -> str:
    """The path of the score in a compressed MusicXML archive, from its container or its first MusicXML file."""
    names = archive.namelist()
    if CONTAINER_PATH in names:
        container = ElementTree.fromstring(archive.read(CONTAINER_PATH))
        rootfile = container.find(".//rootfile")
        if rootfile is not None and rootfile.get("full-path") in names:
            return rootfile.get("full-path", "")
    candidates = [name for name in names if name.endswith((".xml", ".musicxml")) and not name.startswith("META-INF/")]
    if not candidates:
        raise EngineFailure("compressed MusicXML without score")
    return candidates[0]


def _renumber(part: ElementTree.Element) -> None:
    number = 1
    for index, measure in enumerate(part.findall("measure")):
        if index == 0 and measure.get("implicit") == "yes":
            measure.set("number", "0")
            continue
        measure.set("number", str(number))
        number += 1
