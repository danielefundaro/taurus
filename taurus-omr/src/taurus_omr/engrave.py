"""Engraving of a part with Verovio and Cairo, run by the service as a separate process.

``python -m taurus_omr.engrave [--max-pages N] SCORE OPTIONS OUTPUT`` lays out the MusicXML file SCORE with the
options of the JSON file OPTIONS and writes to the OUTPUT folder the pages as ``page-1.png``, ``page-2.png``...
(grayscale, 300 DPI), the same pages as ``score.pdf`` and ``result.json``: ``{"pages": N}``, or ``{"error": code}``
for a score that Verovio cannot read or that needs more than N pages.

The layout follows the writing editor: Verovio keeps every system break of the part and breaks a full system by
itself. A page break starts a new page: the part is laid out in sections between page breaks. Verovio draws no header
for a selection of measures, so the first section is laid out from the part cut after it, and the following ones as
selections of the whole part, which keep the clef, key and time in force. The header is written in the MEI that
Verovio makes of the part, so that Verovio leaves room for it; the names of the part at the left of the staves are
left out, because the header carries the name of the part. The page numbers, from the second page, are written in a
strip kept free above the bottom margin, the same on every page.
"""

from __future__ import annotations

import argparse
import base64
import copy
import io
import json
import os
import re
import sys
from collections.abc import Sequence
from pathlib import Path
from xml.etree import ElementTree

from .engraving import EngravingOptions, Header

MEI = "http://www.music-encoding.org/ns/mei"
XML_ID = "{http://www.w3.org/XML/1998/namespace}id"
REFUSED_UNREADABLE = "unreadableScore"
REFUSED_TOO_MANY_PAGES = "tooManyPages"
# The page numbers in tenths of a millimetre, the unit of the SVG pages of Verovio: 3.5 mm high (10 points), with the
# baseline 1.5 mm above the bottom margin, inside the strip kept free by EngravingOptions.verovio().
PAGE_NUMBER_SIZE = 35
PAGE_NUMBER_BASELINE = 15
_SVG_SIZE = re.compile(r'<svg width="([0-9.]+)px" height="([0-9.]+)px"')


class Refused(Exception):
    """A score that cannot be engraved, reported with a stable code."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _tag(name: str) -> str:
    return f"{{{MEI}}}{name}"


def layout(document: str, options: EngravingOptions, max_pages: int) -> list[str]:
    """The pages of the part as SVG documents, in order."""
    import verovio

    toolkit = verovio.toolkit()
    toolkit.setOptions(options.verovio())
    if not toolkit.loadData(document):
        raise Refused(REFUSED_UNREADABLE)
    try:
        mei = ElementTree.fromstring(toolkit.getMEI())
    except ElementTree.ParseError as exception:
        raise Refused(REFUSED_UNREADABLE) from exception
    sections = page_sections(mei)
    pages: list[str] = []

    def render() -> None:
        count = toolkit.getPageCount()
        if len(pages) + count > max_pages:
            raise Refused(REFUSED_TOO_MANY_PAGES)
        pages.extend(toolkit.renderToSVG(number) for number in range(1, count + 1))

    _load(toolkit, prepare(mei, options, header=True, until=sections[0][1] if len(sections) > 1 else None))
    render()
    if len(sections) > 1:
        _load(toolkit, prepare(mei, options, header=False))
        for start, end in sections[1:]:
            toolkit.select({"start": start, "end": end})
            toolkit.redoLayout()
            render()
    if not options.page_numbers:
        return pages
    return [number_page(page, number, options) for number, page in enumerate(pages, start=1)]


def _load(toolkit: object, mei: str) -> None:
    if not toolkit.loadData(mei):  # type: ignore[attr-defined]
        raise Refused(REFUSED_UNREADABLE)


def page_sections(mei: ElementTree.Element) -> list[tuple[str, str]]:
    """First and last measure of each section between two page breaks; a page break before the music is ignored."""
    sections: list[list[str]] = [[]]
    for element in mei.iter():
        if element.tag == _tag("pb") and sections[-1]:
            sections.append([])
        elif element.tag == _tag("measure"):
            sections[-1].append(element.get(XML_ID, ""))
    return [(section[0], section[-1]) for section in sections if section]


def prepare(mei: ElementTree.Element, options: EngravingOptions, header: bool, until: str | None = None) -> str:
    """The MEI to engrave: without the names of the part and the header of the source, with those of the options.

    With ``until``, the part ends at that measure; the repeats played back, which refer to the whole part, are left out.
    """
    root = copy.deepcopy(mei)
    if until is not None:
        _cut_after(root, until)
        for parent in root.iter():
            for child in [child for child in parent if child.tag == _tag("expansion")]:
                parent.remove(child)
    for parent in root.iter():
        for child in list(parent):
            if child.tag in (_tag("pgHead"), _tag("pgFoot")) or (
                child.tag in (_tag("label"), _tag("labelAbbr")) and parent.tag in (_tag("staffDef"), _tag("staffGrp"))
            ):
                parent.remove(child)
    score_def = root.find(f".//{_tag('scoreDef')}")
    if score_def is None:
        raise Refused(REFUSED_UNREADABLE)
    if options.measure_numbers == "NONE":
        score_def.set("mnum.visible", "false")
    if header and not options.header.empty:
        score_def.insert(0, page_head(options.header))
    ElementTree.register_namespace("", MEI)
    return ElementTree.tostring(root, encoding="unicode")


def page_head(header: Header) -> ElementTree.Element:
    """Header of the first page: name of the part on the left, title in the middle, composer and arranger on the right."""
    head = ElementTree.Element(_tag("pgHead"), {"func": "first"})
    if header.part_name:
        _text(head, "left", header.part_name, {"fontweight": "bold", "fontsize": "large"})
    if header.title:
        _text(head, "center", header.title, {"fontsize": "x-large"})
    credits = [text for text in (header.composer, header.arranger) if text]
    if credits:
        rend = ElementTree.SubElement(head, _tag("rend"), {"halign": "right", "valign": "top"})
        rend.text = credits[0]
        for text in credits[1:]:
            ElementTree.SubElement(rend, _tag("lb")).tail = text
    return head


def _text(head: ElementTree.Element, align: str, text: str, style: dict[str, str]) -> None:
    rend = ElementTree.SubElement(head, _tag("rend"), {"halign": align, "valign": "top"})
    ElementTree.SubElement(rend, _tag("rend"), style).text = text


def _cut_after(element: ElementTree.Element, last: str) -> bool:
    """Removes everything that follows the measure ``last`` in document order; True once the measure is found."""
    for index, child in enumerate(list(element)):
        if (child.tag == _tag("measure") and child.get(XML_ID) == last) or _cut_after(child, last):
            for following in list(element)[index + 1 :]:
                element.remove(following)
            return True
    return False


def number_page(svg: str, number: int, options: EngravingOptions) -> str:
    """The page with its number centred in the strip above the bottom margin; the first page has none."""
    size = _SVG_SIZE.search(svg)
    if number == 1 or size is None:
        return svg
    width, height = float(size.group(1)), float(size.group(2))
    y = height - options.margins * 10 - PAGE_NUMBER_BASELINE
    text = (
        f'<text x="{width / 2:.0f}" y="{y:.0f}" font-family="Times, serif" font-size="{PAGE_NUMBER_SIZE}px" '
        f'text-anchor="middle" fill="black" class="pageNumber">{number}</text>'
    )
    end = svg.rindex("</svg>")
    return svg[:end] + text + svg[end:]


def use_music_font(folder: Path) -> None:
    """Makes the music font of Verovio, embedded in its CSS for browsers, available to Cairo through fontconfig.

    Verovio writes some symbols as text in that font, such as the notes of tempo marks; without it Cairo would draw
    them as empty boxes. Call it before Cairo is loaded: fontconfig reads its configuration once.
    """
    import verovio
    from fontTools.ttLib import TTFont

    css = (Path(verovio.__file__).parent / "data" / "Leipzig.css").read_text(encoding="utf-8")
    match = re.search(r"base64,([A-Za-z0-9+/=]+)", css)
    if match is None:
        raise RuntimeError("music font not found in the Verovio data")
    folder.mkdir(parents=True, exist_ok=True)
    font = TTFont(io.BytesIO(base64.b64decode(match.group(1))))
    font.flavor = None
    font.save(folder / "Leipzig.otf")
    config = folder / "fonts.conf"
    config.write_text(
        f'<?xml version="1.0"?><fontconfig><include ignore_missing="yes">/etc/fonts/fonts.conf</include><dir>{folder}</dir></fontconfig>',
        encoding="utf-8",
    )
    os.environ["FONTCONFIG_FILE"] = str(config)


def draw(pages: Sequence[str], options: EngravingOptions, output: Path) -> None:
    """Writes the pages as grayscale PNG images at 300 DPI and as one PDF, with the vector drawing of Verovio."""
    import cairocffi
    import cairosvg
    import verovio
    from PIL import Image

    class PdfPage(cairosvg.surface.PDFSurface):
        """A page drawn on a PDF shared by all the pages: CairoSVG would otherwise make a document for each page."""

        def _create_surface(self, width: float, height: float) -> tuple[object, float, float]:
            return self.output, width, height

    width, height = options.pixels()
    for number, svg in enumerate(pages, start=1):
        png = cairosvg.svg2png(bytestring=svg.encode("utf-8"), output_width=width, output_height=height, background_color="white")
        with Image.open(io.BytesIO(png)) as image:
            image.convert("L").save(output / f"page-{number}.png", dpi=(300, 300), optimize=True)
    points = options.points()
    with (output / "score.pdf").open("wb") as file:
        document = cairocffi.PDFSurface(file, *points)
        # PDF 1.4, without the compressed object streams of later versions, is read by every viewer and printer.
        document.restrict_to_version(cairocffi.PDF_VERSION_1_4)
        title = " - ".join(text for text in (options.header.title, options.header.part_name) if text)
        if title:
            document.set_metadata(cairocffi.PDF_METADATA_TITLE, title)
        document.set_metadata(cairocffi.PDF_METADATA_CREATOR, f"Taurus, Verovio {verovio.toolkit().getVersion()}")
        # CairoSVG measures PDF pages in CSS pixels, three quarters of a point.
        size = {"output_width": points[0] / 0.75, "output_height": points[1] / 0.75}
        for svg in pages:
            PdfPage(cairosvg.parser.Tree(bytestring=svg.encode("utf-8")), document, 96, **size)
            document.show_page()
        document.finish()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m taurus_omr.engrave", description="Engraves a MusicXML part")
    parser.add_argument("--max-pages", type=int, default=30)
    parser.add_argument("score", type=Path)
    parser.add_argument("options", type=Path)
    parser.add_argument("output", type=Path)
    arguments = parser.parse_args(argv)
    options = EngravingOptions.model_validate_json(arguments.options.read_text(encoding="utf-8"))
    arguments.output.mkdir(parents=True, exist_ok=True)
    use_music_font(arguments.output.parent / "fonts")
    result = arguments.output / "result.json"
    try:
        pages = layout(arguments.score.read_text(encoding="utf-8"), options, arguments.max_pages)
    except Refused as refusal:
        result.write_text(json.dumps({"error": refusal.code}), encoding="utf-8")
        return 0
    draw(pages, options, arguments.output)
    result.write_text(json.dumps({"pages": len(pages)}), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
