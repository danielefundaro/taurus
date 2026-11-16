"""Accuracy of the real engines on the reference corpus, against a running service.

Runs only with ``TAURUS_OMR_ACCURACY_URL`` and ``TAURUS_OMR_ACCURACY_KEY``; the CI starts the image it has just built.
The minimum share of correct measures of each engine is fixed here: an engine or model update that reads worse fails,
one that reads better allows raising the minimum.
"""

from __future__ import annotations

import os

import pytest

from accuracy import engraving, run

URL = os.environ.get("TAURUS_OMR_ACCURACY_URL")
KEY = os.environ.get("TAURUS_OMR_ACCURACY_KEY")
# Measured on 18/10/2026 with Audiveris 5.11.0 and homr 0.7.0 (measures 132/151 and 124/151, structure marks 15/26
# and 6/26), lowered by a margin of a few measures and marks for small differences between processors.
MINIMUM_MEASURES = {"AUDIVERIS": 0.84, "HOMR": 0.79}
MINIMUM_MARKS = {"AUDIVERIS": 0.5, "HOMR": 0.15}
# Measured on 01/11/2026 with RapidOCR 3.10.0 and the PP-OCRv6 small models: 6/6 part names read in the zone kept by
# the backend; one miss is allowed.
MINIMUM_NAMES = 0.8
# The target of the specification for a part of two A4 pages. Measured on 16/11/2026 with Verovio 6.4.1, with the
# limits of omr.yml on the development computer: 3.8 seconds, median of five.
ENGRAVING_TARGET_SECONDS = 15

pytestmark = pytest.mark.skipif(not URL or not KEY, reason="no OMR service to check: set TAURUS_OMR_ACCURACY_URL and TAURUS_OMR_ACCURACY_KEY")


@pytest.fixture(scope="module")
def results() -> list[run.PieceResult]:
    results = run.evaluate(URL or "", KEY or "")
    table = run.report(results)
    print(f"\n{table}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as output:
            output.write(f"### Accuratezza dei motori OMR\n\n{table}\n")
    return results


@pytest.mark.parametrize("engine", run.ENGINES)
def test_engine_reads_at_least_the_expected_share_of_measures(results: list[run.PieceResult], engine: str) -> None:
    correct, measures, _, _ = run.totals(results, engine)

    assert correct / measures >= MINIMUM_MEASURES[engine], f"{engine}: {correct}/{measures} correct measures"


@pytest.mark.parametrize("engine", run.ENGINES)
def test_engine_reads_at_least_the_expected_share_of_structure_marks(results: list[run.PieceResult], engine: str) -> None:
    _, _, found, marks = run.totals(results, engine)

    assert found / marks >= MINIMUM_MARKS[engine], f"{engine}: {found}/{marks} structure marks"


def test_every_piece_is_read_by_at_least_one_engine(results: list[run.PieceResult]) -> None:
    unread = [result.piece for result in results if all(comparison is None or comparison.correct_measures == 0 for comparison in result.comparisons.values())]

    assert unread == []


@pytest.fixture(scope="module")
def names() -> list[run.NameResult]:
    results = run.read_names(URL or "", KEY or "")
    table = run.names_report(results)
    print(f"\n{table}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as output:
            output.write(f"### Lettura dei nomi delle parti\n\n{table}\n")
    return results


def test_text_engine_reads_at_least_the_expected_share_of_part_names(names: list[run.NameResult]) -> None:
    correct = sum(result.correct for result in names)

    assert correct / len(names) >= MINIMUM_NAMES, f"{correct}/{len(names)} part names: {[r.piece for r in names if not r.correct]}"


@pytest.fixture(scope="module")
def engravings() -> list[engraving.Timing]:
    timings = engraving.measure(URL or "", KEY or "", runs=3)
    table = engraving.report(timings)
    print(f"\n{table}")
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as output:
            output.write(f"### Impaginazione\n\n{table}\n")
    return timings


def test_a_part_of_two_pages_is_engraved_within_the_target(engravings: list[engraving.Timing]) -> None:
    two_pages = engravings[0]

    # A different number of pages means that the engraver lays out the part differently: the case needs other measures.
    assert two_pages.pages == 2, f"{two_pages.case}: {two_pages.pages} pages"
    assert two_pages.median_request < ENGRAVING_TARGET_SECONDS, f"{two_pages.median_request:.1f} s"
