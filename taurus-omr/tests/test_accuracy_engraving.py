"""The engraving measure of the accuracy tool, with a fake service: the long parts, the requests and the report."""

from __future__ import annotations

import json
from xml.etree import ElementTree

import httpx
import pytest

from accuracy import engraving
from accuracy.__main__ import main
from accuracy.run import API_KEY_HEADER, CORPUS


def _measures(score: bytes) -> list[ElementTree.Element]:
    return ElementTree.fromstring(score).findall("part/measure")


def test_a_long_part_repeats_the_measures_of_the_piece_numbered_again() -> None:
    original = _measures((CORPUS / "flauto.musicxml").read_bytes())

    measures = _measures(engraving.long_part("flauto", 100))

    assert [measure.get("number") for measure in measures] == [str(number) for number in range(1, 101)]
    for index, measure in enumerate(measures):
        source = original[index % len(original)]
        assert len(measure.findall("note")) == len(source.findall("note"))


def test_a_long_part_keeps_the_attributes_of_the_first_measure_only() -> None:
    measures = _measures(engraving.long_part("clarinetto", 45))

    assert measures[0].find("attributes") is not None
    assert all(measure.find(name) is None for measure in measures[1:] for name in ("attributes", "print", "barline"))


def _service(pages: int, millis: int, seen: list[httpx.Request]) -> httpx.Client:
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"pageCount": pages, "durationMillis": millis, "pdf": "", "pages": []})

    return httpx.Client(transport=httpx.MockTransport(handle))


def test_an_engraving_sends_the_part_and_the_options_with_the_key() -> None:
    seen: list[httpx.Request] = []

    pages, service, request = engraving.engrave("http://omr:8090/", "secret-key", b"<score-partwise/>", "MARCH", _service(5, 3600, seen))

    assert (pages, service) == (5, 3.6)
    assert request >= 0
    sent = seen[0]
    assert str(sent.url) == "http://omr:8090/v1/engravings"
    assert sent.headers[API_KEY_HEADER] == "secret-key"
    body = sent.read().decode()
    assert "<score-partwise/>" in body
    options = json.loads(body.split('name="options"')[1].split("\r\n\r\n", 1)[1].split("\r\n--", 1)[0])
    assert options["format"] == "MARCH"
    assert set(options["header"]) == {"title", "partName"}


def test_the_measure_engraves_each_case_the_given_times_and_reports_the_medians() -> None:
    seen: list[httpx.Request] = []
    cases = (engraving.Case("flauto", 20), engraving.Case("tuba", 30, "A4_LANDSCAPE"))

    timings = engraving.measure("http://omr:8090", "key", cases, runs=3, client=_service(2, 3800, seen))

    assert len(seen) == 6
    assert [timing.case for timing in timings] == list(cases)
    assert all(timing.pages == 2 and timing.service == (3.8, 3.8, 3.8) and len(timing.request) == 3 for timing in timings)
    table = engraving.report(timings)
    assert "| flauto | 20 | A4 verticale | 2 | 3.8 s |" in table
    assert "| tuba | 30 | A4 orizzontale | 2 | 3.8 s |" in table


def test_the_command_needs_the_key_of_the_service(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    monkeypatch.delenv("TAURUS_OMR_ACCURACY_KEY", raising=False)

    with pytest.raises(SystemExit) as exit:
        main(["engraving", "--url", "http://omr:8090"])

    assert exit.value.code == 2
    assert "TAURUS_OMR_ACCURACY_KEY" in capsys.readouterr().err
