from __future__ import annotations

import base64
import io
import json
import os
import re
import sys
from pathlib import Path
from xml.etree import ElementTree

import pytest
from fastapi.testclient import TestClient
from PIL import Image, ImageChops, ImageStat

from taurus_omr import engrave, musicxml
from taurus_omr.app import API_KEY_HEADER, create_app
from taurus_omr.engraving import EngravingOptions, Header, parse_options, score_document
from taurus_omr.errors import InvalidOptions, UnreadableScore

from .conftest import FAKES, settings
from .fakes.scores import compressed, part

REFERENCE = Path(__file__).parent / "engraving"
CORPUS = Path(__file__).parent.parent / "accuracy" / "corpus"


def _cairo() -> bool:
    try:
        import cairocffi  # noqa: F401
    except (ImportError, OSError):
        return False
    return True


# Cairo is a system library: without it the drawing tests are skipped, unless the CI asks for them.
requires_cairo = pytest.mark.skipif(
    not _cairo() and os.environ.get("TAURUS_OMR_REQUIRE_CAIRO") != "true",
    reason="the Cairo library is not installed",
)


@pytest.fixture(scope="module", autouse=True)
def music_font(tmp_path_factory: pytest.TempPathFactory) -> None:
    """The music font of Verovio for Cairo, configured before the first drawing: fontconfig reads it only once."""
    if _cairo():
        engrave.use_music_font(tmp_path_factory.mktemp("fonts"))


def options(**values: object) -> EngravingOptions:
    return EngravingOptions.model_validate(values)


def measures(svg: str) -> list[str]:
    return re.findall(r'<g id="(m\d+)" class="measure', svg)


# Options


def test_the_formats_give_the_page_sizes_and_their_defaults() -> None:
    a4 = options()
    assert a4.pixels() == (2480, 3508)
    assert a4.points() == pytest.approx((595.28, 841.89), abs=0.01)
    assert a4.verovio().items() >= {"pageWidth": 2100, "pageHeight": 2970, "pageMarginTop": 120, "pageMarginLeft": 120, "unit": 8.75}.items()
    # The page numbers keep a strip of 6 mm free above the bottom margin.
    assert a4.verovio()["pageMarginBottom"] == 180

    march = options(format="MARCH")
    assert march.pixels() == (2126, 1535)
    assert march.points() == pytest.approx((510.24, 368.5), abs=0.01)
    assert march.verovio().items() >= {"pageWidth": 1800, "pageHeight": 1300, "pageMarginTop": 80, "unit": 7.0}.items()

    assert options(format="A4_LANDSCAPE").pixels() == (3508, 2480)


def test_the_chosen_staff_margins_and_numbers_replace_the_defaults() -> None:
    chosen = options(format="MARCH", staffSize=6.4, margin=10, pageNumbers=False, measureNumbers="EVERY")

    verovio = chosen.verovio()
    assert verovio["unit"] == 8.0
    assert verovio["pageMarginTop"] == verovio["pageMarginBottom"] == 100
    assert verovio["mnumInterval"] == 1
    assert options().verovio()["mnumInterval"] == 0
    assert verovio["breaks"] == "smart" and verovio["breaksSmartSb"] == 0


def test_the_header_texts_are_single_lines() -> None:
    header = Header.model_validate({"title": "  Marcia\n reale\t", "partName": "Tromba\x00 1ª"})

    assert header.title == "Marcia reale"
    assert header.part_name == "Tromba 1ª"
    assert not header.empty
    assert Header().empty


@pytest.mark.parametrize(
    ("value", "field"),
    [
        ('{"format": "A3"}', "format"),
        ('{"staffSize": 12}', "staffSize"),
        ('{"margin": 1}', "margin"),
        ('{"colour": "red"}', "colour"),
        ('{"header": {"title": "' + "x" * 201 + '"}}', "header.title"),
        ("not json", "options"),
    ],
)
def test_refuses_invalid_options(value: str, field: str) -> None:
    with pytest.raises(InvalidOptions, match=re.escape(field)):
        parse_options(value)


def test_reads_the_options_of_the_backend() -> None:
    parsed = parse_options('{"format": "MARCH", "header": {"title": "Marcia", "partName": "Tromba"}, "measureNumbers": "NONE"}')

    assert parsed.format == "MARCH"
    assert parsed.header.part_name == "Tromba"
    assert parsed.measure_numbers == "NONE"
    assert parse_options("") == EngravingOptions()


# Score


def test_reads_plain_and_compressed_scores() -> None:
    document = part(2)

    plain = score_document(document.encode(), 1_000_000)
    assert musicxml.measure_count(ElementTree.fromstring(plain)) == 2
    assert score_document(compressed(document), 1_000_000) == plain


@pytest.mark.parametrize(
    "data",
    [
        b"<score-partwise><part",
        b'<score-timewise version="4.0"/>',
        b'<score-partwise version="4.0"><part-list/><part id="P1"/></score-partwise>',
        b"PK\x03\x04 not really a zip",
    ],
)
def test_refuses_unreadable_scores(data: bytes) -> None:
    with pytest.raises(UnreadableScore):
        score_document(data, 1_000_000)


def test_refuses_compressed_scores_larger_than_the_limit() -> None:
    with pytest.raises(UnreadableScore, match="too large"):
        score_document(compressed(part(40)), 5_000)


# Layout


def test_writes_the_header_on_the_first_page_only() -> None:
    pages = engrave.layout(
        part(90, credit="Titolo letto"),
        options(header={"title": "Marcia & inno", "composer": "Mario Rossi", "arranger": "arr. Luigi Bianchi", "partName": "Tromba 1ª"}),
        30,
    )

    assert len(pages) >= 2
    first = pages[0]
    for text in ("Marcia &amp; inno", "Mario Rossi", "arr. Luigi Bianchi", "Tromba 1ª"):
        assert text in first
    assert "Titolo letto" not in first
    # The name of the part is in the header, not at the left of the staves.
    assert 'class="label"' not in first
    assert all('class="pgHead' not in page for page in pages[1:])


def test_without_texts_there_is_no_header() -> None:
    pages = engrave.layout(part(4, credit="Titolo letto"), options(), 30)

    assert 'class="pgHead' not in pages[0]
    assert "Titolo letto" not in pages[0]


def test_numbers_the_pages_from_the_second() -> None:
    pages = engrave.layout(part(90), options(), 30)

    numbers = [re.findall(r'class="pageNumber">(\d+)<', page) for page in pages]
    assert numbers == [[]] + [[str(number)] for number in range(2, len(pages) + 1)]
    unnumbered = engrave.layout(part(90), options(pageNumbers=False), 30)
    assert not any("pageNumber" in page for page in unnumbered)


def test_a_page_break_starts_a_new_page_and_keeps_the_header_and_the_numbers() -> None:
    pages = engrave.layout(part(30, system_every=4, page_breaks=(9, 21)), options(header={"title": "Marcia"}), 30)

    assert [measures(page)[0] for page in pages] == ["m1", "m9", "m21"]
    assert measures(pages[0])[-1] == "m8"
    assert measures(pages[2])[-1] == "m30"
    assert "Marcia" in pages[0]
    assert re.findall(r'class="pageNumber">(\d+)<', pages[2]) == ["3"]
    # Every system break of the part is kept, as in the writing editor.
    assert [len(system.split('class="measure')) - 1 for system in pages[1].split('class="system"')[1:]] == [4, 4, 4]


def test_a_page_break_before_the_music_is_ignored() -> None:
    pages = engrave.layout(part(6, page_breaks=(1,)), options(), 30)

    assert len(pages) == 1


def test_the_measure_numbers_follow_the_options() -> None:
    def numbers(choice: str) -> int:
        return sum(page.count('class="mNum') for page in engrave.layout(part(24), options(measureNumbers=choice), 30))

    assert numbers("NONE") == 0
    assert 0 < numbers("SYSTEM") < numbers("EVERY")
    assert numbers("EVERY") >= 23


def test_refuses_parts_longer_than_the_page_limit() -> None:
    with pytest.raises(engrave.Refused) as refusal:
        engrave.layout(part(200), options(format="MARCH"), 2)

    assert refusal.value.code == "tooManyPages"


def test_refuses_what_verovio_cannot_read() -> None:
    with pytest.raises(engrave.Refused) as refusal:
        engrave.layout("not a score", options(), 30)

    assert refusal.value.code == "unreadableScore"


def test_the_part_cut_after_a_measure_keeps_only_what_comes_before() -> None:
    import verovio

    toolkit = verovio.toolkit()
    toolkit.loadData(part(12))
    mei = ElementTree.fromstring(toolkit.getMEI())

    cut = ElementTree.fromstring(engrave.prepare(mei, options(), header=False, until="m5"))

    ids = [element.get(engrave.XML_ID) for element in cut.iter(f"{{{engrave.MEI}}}measure")]
    assert ids == ["m1", "m2", "m3", "m4", "m5"]
    assert cut.find(f".//{{{engrave.MEI}}}expansion") is None


# Drawing


@requires_cairo
def test_draws_the_pages_and_the_pdf(tmp_path: Path) -> None:
    chosen = options(header={"title": "Marcia", "partName": "Tromba"})
    pages = engrave.layout(part(90), chosen, 30)

    engrave.draw(pages, chosen, tmp_path)

    for number in range(1, len(pages) + 1):
        with Image.open(tmp_path / f"page-{number}.png") as image:
            assert image.size == (2480, 3508)
            assert image.mode == "L"
            assert image.info["dpi"] == pytest.approx((300, 300), abs=0.01)
    pdf = (tmp_path / "score.pdf").read_bytes()
    assert pdf.startswith(b"%PDF-1.4")
    assert len(re.findall(rb"/Type\s*/Page\b", pdf)) == len(pages)
    assert re.search(rb"/MediaBox\s*\[\s*0 0 595\.27\d* 841\.88\d*\s*\]", pdf)
    assert b"Marcia - Tromba" in pdf


@requires_cairo
def test_draws_the_march_format(tmp_path: Path) -> None:
    chosen = options(format="MARCH")

    engrave.draw(engrave.layout(part(8), chosen, 30), chosen, tmp_path)

    with Image.open(tmp_path / "page-1.png") as image:
        assert image.size == (2126, 1535)


@requires_cairo
def test_the_engraved_page_matches_the_reference_within_a_tolerance(tmp_path: Path) -> None:
    """The reference corpus part as an A4 page: a change of Verovio, Cairo or the options shows up here.

    The reference was drawn with ``python -m taurus_omr.engrave`` in the Docker image and is compared at a quarter of
    the size, so that the smoothing of the edges and small differences of the text font do not count.
    """
    document = (CORPUS / "marcia.musicxml").read_text(encoding="utf-8")
    chosen = options(header={"title": "Marcia", "composer": "Taurus", "partName": "Tromba in Sib"})
    pages = engrave.layout(document, chosen, 30)
    engrave.draw(pages, chosen, tmp_path)

    assert len(pages) == 1
    with Image.open(tmp_path / "page-1.png") as drawn, Image.open(REFERENCE / "marcia-a4-1.png") as reference:
        small = drawn.resize(reference.size, Image.Resampling.BOX)
        difference = ImageChops.difference(small, reference.convert("L"))
        assert ImageStat.Stat(difference).mean[0] < 1.5
        assert sum(difference.histogram()[64:]) < reference.width * reference.height * 0.004


@requires_cairo
def test_the_program_writes_pages_pdf_and_result(tmp_path: Path) -> None:
    (tmp_path / "score.musicxml").write_text(part(8), encoding="utf-8")
    (tmp_path / "options.json").write_text('{"format": "A4_LANDSCAPE"}', encoding="utf-8")

    assert engrave.main([str(tmp_path / "score.musicxml"), str(tmp_path / "options.json"), str(tmp_path / "out")]) == 0

    assert json.loads((tmp_path / "out" / "result.json").read_text(encoding="utf-8")) == {"pages": 1}
    assert (tmp_path / "out" / "page-1.png").is_file()
    assert (tmp_path / "out" / "score.pdf").is_file()


@requires_cairo
def test_the_program_reports_refused_scores(tmp_path: Path) -> None:
    (tmp_path / "score.musicxml").write_text(part(200), encoding="utf-8")
    (tmp_path / "options.json").write_text("{}", encoding="utf-8")

    engrave.main(["--max-pages", "1", str(tmp_path / "score.musicxml"), str(tmp_path / "options.json"), str(tmp_path / "out")])

    assert json.loads((tmp_path / "out" / "result.json").read_text(encoding="utf-8")) == {"error": "tooManyPages"}


# API


def fake_client(tmp_path: Path, **overrides: object) -> TestClient:
    values: dict[str, object] = {"engraving_command": (sys.executable, str(FAKES / "fake_engrave.py"))} | overrides
    return TestClient(create_app(settings(tmp_path, **values)))


def engrave_request(client: TestClient, document: bytes | None = None, options_json: str | None = None, key: str | None = None) -> object:
    data = {} if options_json is None else {"options": options_json}
    headers = {} if key == "" else {API_KEY_HEADER: key or "test-key-0123456789"}
    return client.post("/v1/engravings", files={"score": ("part.musicxml", document or part(4).encode(), "application/xml")}, data=data, headers=headers)


def test_the_health_reports_the_engraving_engine(tmp_path: Path) -> None:
    engine = fake_client(tmp_path).get("/v1/health").json()["engravingEngine"]

    assert engine["name"] == "VEROVIO"
    assert engine["version"] == "6.4.1"


def test_engravings_require_the_service_key(tmp_path: Path) -> None:
    response = engrave_request(fake_client(tmp_path), key="")

    assert response.status_code == 401


def test_returns_the_pages_and_the_pdf_of_the_engraving(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    received = tmp_path / "received.json"
    monkeypatch.setenv("FAKE_ENGRAVE_RECEIVED", str(received))

    response = engrave_request(fake_client(tmp_path, max_pages=12), compressed(part(4)), '{"format": "MARCH", "header": {"title": "Marcia"}}')

    assert response.status_code == 200
    body = response.json()
    assert body["engine"] == "VEROVIO"
    assert body["pageCount"] == 2
    assert base64.b64decode(body["pdf"]) == b"%PDF-1.4 fake"
    assert [Image.open(io.BytesIO(base64.b64decode(page))).size for page in body["pages"]] == [(40, 56), (40, 56)]
    sent = json.loads(received.read_text(encoding="utf-8"))
    assert sent["maxPages"] == 12
    assert sent["options"]["format"] == "MARCH"
    assert sent["options"]["header"]["title"] == "Marcia"
    # The compressed part reaches the engraving as a plain MusicXML.
    assert sent["score"].startswith("<?xml") and 'id="m4"' in sent["score"]


@pytest.mark.parametrize(("mode", "status", "code"), [("unreadable", 422, "unreadableScore"), ("many", 422, "tooManyPages"), ("fail", 500, "engineFailed"), ("garbage", 500, "engineFailed"), ("missing", 500, "engineFailed")])
def test_reports_the_failures_of_the_engraving(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, mode: str, status: int, code: str) -> None:
    monkeypatch.setenv("FAKE_ENGRAVE", mode)

    response = engrave_request(fake_client(tmp_path))

    assert response.status_code == status
    assert response.json()["code"] == code


def test_stops_an_engraving_at_the_timeout(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_ENGRAVE", "sleep")

    response = engrave_request(fake_client(tmp_path, engraving_timeout_seconds=1))

    assert response.status_code == 500
    assert response.json()["code"] == "engineTimeout"


def test_refuses_invalid_options_and_scores_before_engraving(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("FAKE_ENGRAVE", "fail")
    client = fake_client(tmp_path)

    invalid = engrave_request(client, options_json='{"format": "A3"}')
    unreadable = engrave_request(client, b"<score-partwise><part")

    assert (invalid.status_code, invalid.json()["code"]) == (422, "invalidOptions")
    assert (unreadable.status_code, unreadable.json()["code"]) == (422, "unreadableScore")


def test_refuses_scores_larger_than_the_limit(tmp_path: Path) -> None:
    response = engrave_request(fake_client(tmp_path, max_score_bytes=1000), part(40).encode())

    assert response.status_code == 413
    assert response.json()["code"] == "tooLarge"


@requires_cairo
def test_engraves_a_part_with_verovio(tmp_path: Path, headers: dict[str, str], monkeypatch: pytest.MonkeyPatch) -> None:
    # The real engraving program, which runs as a separate process like in the image.
    monkeypatch.setenv("PYTHONPATH", str(Path(__file__).parent.parent / "src"))
    client = TestClient(create_app(settings(tmp_path)))

    response = client.post(
        "/v1/engravings",
        files={"score": ("part.mxl", compressed(part(8)), "application/vnd.recordare.musicxml")},
        data={"options": '{"format": "MARCH", "header": {"title": "Marcia"}}'},
        headers=headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["pageCount"] == len(body["pages"]) == 1
    assert base64.b64decode(body["pdf"]).startswith(b"%PDF")
    with Image.open(io.BytesIO(base64.b64decode(body["pages"][0]))) as page:
        assert page.size == (2126, 1535)
