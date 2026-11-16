"""Engraving times of a running service, on long parts built from the corpus.

The parts of the corpus fill less than a page: a long part repeats their measures until it fills the pages of a case.
Each case is engraved several times; the service reports its own duration, and the duration of the request adds the
transfer of the pages and of the PDF.
"""

from __future__ import annotations

import copy
import json
import statistics
import time
from dataclasses import dataclass
from pathlib import Path
from xml.etree import ElementTree

import httpx

from .run import API_KEY_HEADER, CORPUS

FORMATS = {"A4_PORTRAIT": "A4 verticale", "A4_LANDSCAPE": "A4 orizzontale", "MARCH": "marcia"}


@dataclass(frozen=True)
class Case:
    """A corpus piece repeated up to ``measures`` measures, engraved in ``page_format``."""

    piece: str
    measures: int
    page_format: str = "A4_PORTRAIT"


# The first case is the target of the specification: a part of two A4 pages, engraved in less than 15 seconds. The
# others show how the time follows the pages and the format.
CASES = (
    Case("flauto", 100),
    Case("clarinetto", 100),
    Case("flauto", 100, "MARCH"),
    Case("flauto", 40),
)


@dataclass(frozen=True)
class Timing:
    """The pages of a case and the durations of its engravings, in seconds."""

    case: Case
    pages: int
    service: tuple[float, ...]
    request: tuple[float, ...]

    @property
    def median_service(self) -> float:
        return statistics.median(self.service)

    @property
    def median_request(self) -> float:
        return statistics.median(self.request)

    @property
    def slowest_request(self) -> float:
        return max(self.request)


def long_part(piece: str, measures: int, folder: Path = CORPUS) -> bytes:
    """The part of a corpus piece with its measures repeated up to ``measures``, numbered again from 1.

    The first measure stays whole. The copies lose attributes, printed breaks and barlines, so that the long part has no
    changes of clef, key or meter, no repeats and no endings, and the engraver breaks the systems by itself.
    """
    root = ElementTree.parse(folder / f"{piece}.musicxml").getroot()
    part = root.find("part")
    if part is None or part.find("measure") is None:
        raise ValueError(f"{piece} has no measures")
    originals = part.findall("measure")
    for measure in originals:
        part.remove(measure)
    for index in range(measures):
        measure = copy.deepcopy(originals[index % len(originals)])
        if index:
            for name in ("attributes", "print", "barline"):
                for element in measure.findall(name):
                    measure.remove(element)
        measure.set("number", str(index + 1))
        part.append(measure)
    return ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)


def engrave(url: str, key: str, score: bytes, page_format: str, client: httpx.Client | None = None, timeout_seconds: float = 180) -> tuple[int, float, float]:
    """The pages of one engraving, the duration reported by the service and the duration of the request."""
    options = json.dumps({"format": page_format, "header": {"title": "Misura dell'impaginazione", "partName": "Parte"}})
    started = time.perf_counter()
    response = (client or httpx).post(
        f"{url.rstrip('/')}/v1/engravings",
        headers={API_KEY_HEADER: key},
        files={"score": ("part.musicxml", score, "application/vnd.recordare.musicxml+xml")},
        data={"options": options},
        timeout=timeout_seconds,
    )
    elapsed = time.perf_counter() - started
    response.raise_for_status()
    body = response.json()
    return body["pageCount"], body["durationMillis"] / 1000, elapsed


def measure(url: str, key: str, cases: tuple[Case, ...] = CASES, runs: int = 5, client: httpx.Client | None = None, folder: Path = CORPUS) -> list[Timing]:
    """Engraves each case ``runs`` times, one request at a time."""
    timings = []
    for case in cases:
        score = long_part(case.piece, case.measures, folder)
        pages, service, request = 0, [], []
        for _ in range(runs):
            pages, seconds, elapsed = engrave(url, key, score, case.page_format, client)
            service.append(seconds)
            request.append(elapsed)
        timings.append(Timing(case, pages, tuple(service), tuple(request)))
    return timings


def report(timings: list[Timing]) -> str:
    """A Markdown table: the pages of each case and the median durations of the service and of the request."""
    lines = [
        "| Parte | Battute | Formato | Pagine | Servizio, mediana | Richiesta, mediana | Richiesta più lenta |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for timing in timings:
        case = timing.case
        lines.append(
            f"| {case.piece} | {case.measures} | {FORMATS.get(case.page_format, case.page_format)} | {timing.pages} "
            f"| {timing.median_service:.1f} s | {timing.median_request:.1f} s | {timing.slowest_request:.1f} s |"
        )
    return "\n".join(lines)
