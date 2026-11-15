"""Engraving of written parts: the MusicXML is laid out in pages by a separate process, which stops at the timeout.

The options are validated here, before any work; ``taurus_omr.engrave`` lays out and draws the pages with Verovio and
Cairo. The service keeps nothing: the pages and the PDF go back in the response.
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from dataclasses import dataclass
from importlib import metadata
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from pydantic.alias_generators import to_camel

from . import musicxml, process
from .config import Settings
from .errors import EngineFailure, InvalidOptions, OmrError, TooManyPages, UnreadableScore

VEROVIO = "VEROVIO"
DPI = 300
MM_PER_INCH = 25.4
POINTS_PER_INCH = 72
# Height of the staff as a multiple of the Verovio unit, half the distance between two lines.
UNITS_PER_STAFF = 8
# Strip kept free above the bottom margin for the page numbers, in millimetres.
PAGE_NUMBER_STRIP = 6
_CONTROL = re.compile(r"[\x00-\x1f\x7f]+")


@dataclass(frozen=True)
class PageFormat:
    """Size of the page in millimetres, with the staff and the margins used when the request does not give them."""

    width: float
    height: float
    staff: float
    margin: float


FORMATS: dict[str, PageFormat] = {
    "A4_PORTRAIT": PageFormat(210, 297, staff=7.0, margin=12),
    "A4_LANDSCAPE": PageFormat(297, 210, staff=7.0, margin=12),
    # The march card of band players: 18 x 13 cm in landscape, held by the lyre of the instrument.
    "MARCH": PageFormat(180, 130, staff=5.6, margin=8),
}


class _Options(BaseModel):
    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True, frozen=True, str_strip_whitespace=True)


class Header(_Options):
    """Texts of the header of the first page; an empty text is left out, and with no text there is no header."""

    title: str = Field("", max_length=200)
    composer: str = Field("", max_length=200)
    arranger: str = Field("", max_length=200)
    part_name: str = Field("", max_length=200)

    @field_validator("title", "composer", "arranger", "part_name")
    @classmethod
    def _single_line(cls, value: str) -> str:
        # Control characters are not valid in XML: line breaks and tabs become spaces.
        return " ".join(_CONTROL.sub(" ", value).split())

    @property
    def empty(self) -> bool:
        return not (self.title or self.composer or self.arranger or self.part_name)


class EngravingOptions(_Options):
    """Format of the page, size of the staff and margins in millimetres, header, page and measure numbers.

    Measure numbers are shown at the start of every system (``SYSTEM``), above every measure (``EVERY``, for study
    parts) or never (``NONE``). Page numbers start from the second page.
    """

    format: Literal["A4_PORTRAIT", "A4_LANDSCAPE", "MARCH"] = "A4_PORTRAIT"
    staff_size: float | None = Field(None, ge=4.0, le=9.6)
    margin: float | None = Field(None, ge=3.0, le=30.0)
    header: Header = Field(default_factory=Header)
    page_numbers: bool = True
    measure_numbers: Literal["NONE", "SYSTEM", "EVERY"] = "SYSTEM"

    @property
    def page(self) -> PageFormat:
        return FORMATS[self.format]

    @property
    def staff(self) -> float:
        return self.page.staff if self.staff_size is None else self.staff_size

    @property
    def margins(self) -> float:
        return self.page.margin if self.margin is None else self.margin

    def pixels(self) -> tuple[int, int]:
        """Size of a page image at 300 DPI."""
        return _round(self.page.width / MM_PER_INCH * DPI), _round(self.page.height / MM_PER_INCH * DPI)

    def points(self) -> tuple[float, float]:
        """Size of a PDF page in points."""
        return self.page.width / MM_PER_INCH * POINTS_PER_INCH, self.page.height / MM_PER_INCH * POINTS_PER_INCH

    def verovio(self) -> dict[str, object]:
        """Options of the Verovio toolkit: its page sizes are in tenths of a millimetre."""
        margin = _round(self.margins * 10)
        bottom = _round((self.margins + (PAGE_NUMBER_STRIP if self.page_numbers else 0)) * 10)
        return {
            "pageWidth": _round(self.page.width * 10),
            "pageHeight": _round(self.page.height * 10),
            "pageMarginTop": margin,
            "pageMarginBottom": bottom,
            "pageMarginLeft": margin,
            "pageMarginRight": margin,
            "unit": round(self.staff * 10 / UNITS_PER_STAFF, 3),
            "adjustPageHeight": False,
            # As in the writing editor: every encoded system break is kept, and a full system breaks by itself.
            "breaks": "smart",
            "breaksSmartSb": 0,
            "header": "encoded",
            "footer": "encoded",
            "justifyVertically": True,
            "mnumInterval": 1 if self.measure_numbers == "EVERY" else 0,
        }


def parse_options(value: str) -> EngravingOptions:
    try:
        return EngravingOptions.model_validate_json(value or "{}")
    except ValidationError as exception:
        fields = sorted({".".join(str(part) for part in error["loc"]) or "options" for error in exception.errors()})
        raise InvalidOptions(f"invalid engraving options: {', '.join(fields)}") from exception


def score_document(data: bytes, limit: int) -> bytes:
    """The part as a plain UTF-8 MusicXML, from a plain or compressed file; never larger than ``limit`` bytes."""
    if zipfile.is_zipfile(io.BytesIO(data)):
        data = _uncompressed(data, limit)
    try:
        root = musicxml.parse(data)
    except EngineFailure as exception:
        raise UnreadableScore("the score is not a readable MusicXML document") from exception
    if root.find("part/measure") is None:
        raise UnreadableScore("the score has no measures")
    return musicxml.to_bytes(root)


@dataclass(frozen=True)
class Engraving:
    pdf: bytes
    pages: list[bytes]


class Engraver:
    name = VEROVIO

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    @property
    def version(self) -> str:
        try:
            return metadata.version("verovio")
        except metadata.PackageNotFoundError:
            return "unknown"

    def engrave(self, document: bytes, options: EngravingOptions, work: Path, timeout_seconds: int) -> Engraving:
        score = work / "score.musicxml"
        score.write_bytes(document)
        settings_file = work / "options.json"
        settings_file.write_text(options.model_dump_json(by_alias=True), encoding="utf-8")
        output = work / "output"
        process.run(
            [*self._settings.engraving_command, "--max-pages", str(self._settings.max_pages), str(score), str(settings_file), str(output)],
            cwd=work,
            timeout_seconds=timeout_seconds,
            environment={"HOME": str(work)},
        )
        try:
            result = json.loads((output / "result.json").read_text(encoding="utf-8"))
            if "error" in result:
                raise _refusal(str(result["error"]))
            count = int(result["pages"])
            pages = [(output / f"page-{number}.png").read_bytes() for number in range(1, count + 1)]
            pdf = (output / "score.pdf").read_bytes()
        except (OSError, ValueError, KeyError, TypeError) as exception:
            raise EngineFailure("unreadable result of the engraving") from exception
        if not pages or not pdf:
            raise EngineFailure("the engraving produced no pages")
        return Engraving(pdf=pdf, pages=pages)


def _refusal(code: str) -> OmrError:
    if code == TooManyPages.code:
        return TooManyPages("the part needs more pages than allowed")
    return UnreadableScore("Verovio could not read the score")


def _uncompressed(data: bytes, limit: int) -> bytes:
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            info = archive.getinfo(musicxml.root_file(archive))
            if info.file_size > limit:
                raise UnreadableScore("the compressed score is too large")
            with archive.open(info) as member:
                content = member.read(limit + 1)
    except (zipfile.BadZipFile, KeyError, EngineFailure, OSError) as exception:
        raise UnreadableScore("unreadable compressed MusicXML") from exception
    if len(content) > limit:
        raise UnreadableScore("the compressed score is too large")
    return content


def _round(value: float) -> int:
    return int(value + 0.5)
