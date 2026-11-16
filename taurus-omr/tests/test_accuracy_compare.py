from __future__ import annotations

import json
import zipfile
from pathlib import Path
from xml.etree import ElementTree

import pytest

from accuracy import cases, compare, corpus
from accuracy.__main__ import main
from accuracy.run import CORPUS, pages


def document(piece: corpus.Piece = corpus.MARCIA) -> ElementTree.Element:
    return ElementTree.fromstring(corpus.musicxml(piece).split("\n", 2)[2])


def measures(root: ElementTree.Element) -> list[compare.Measure]:
    return compare.load(ElementTree.tostring(root))


def measure(root: ElementTree.Element, number: str) -> ElementTree.Element:
    found = root.find(f"part/measure[@number='{number}']")
    assert found is not None
    return found


def test_every_piece_is_committed_with_its_reference_and_pages() -> None:
    for piece in corpus.PIECES:
        reference = (CORPUS / f"{piece.name}.musicxml").read_text(encoding="utf-8")

        assert reference == corpus.musicxml(piece), f"{piece.name}: run python -m accuracy render again"
        found = [path.name for path in pages(piece.name)]
        assert found == [f"{piece.name}-{number}.png" for number in range(1, len(found) + 1)]


def test_pieces_write_out_multi_measure_rests_and_number_a_pickup_as_zero() -> None:
    valzer = document(corpus.VALZER)
    tuba = document(corpus.TUBA)

    assert len(valzer.findall("part/measure")) == 32
    assert valzer.findtext("part/measure[@number='1']/attributes/measure-style/multiple-rest") == "8"
    assert valzer.find("part/measure[@number='2']/note/rest").get("measure") == "yes"
    assert measure(tuba, "0").get("implicit") == "yes"
    assert len(tuba.findall("part/measure")) == 21


def test_accidentals_are_written_only_where_key_and_measure_do_not_imply_them() -> None:
    marcia = document(corpus.MARCIA)
    flauto = document(corpus.FLAUTO)

    assert [note.findtext("accidental") for note in measure(marcia, "11").findall("note")] == ["flat", None]
    assert [note.findtext("accidental") for note in measure(marcia, "12").findall("note")] == [None, "natural", None, None]
    sharps = [note.findtext("accidental") for note in measure(flauto, "7").findall("note") if note.findtext("pitch/step") == "C"]
    assert sharps == ["sharp", None]


def test_ties_cross_the_barline_and_triplets_are_bracketed_by_three() -> None:
    marcia = document(corpus.MARCIA)
    flauto = document(corpus.FLAUTO)

    assert measure(marcia, "21").find("note/tie").get("type") == "start"
    assert measure(marcia, "22").find("note/tie").get("type") == "stop"
    tuplets = [note.find("notations/tuplet") for note in measure(flauto, "3").findall("note")]
    assert [tuplet.get("type") if tuplet is not None else None for tuplet in tuplets] == ["start", None, "stop", "start", None, "stop", None]


def test_a_measure_of_the_wrong_length_is_refused() -> None:
    broken = corpus.Piece("rotto", "Rotto", "Tuba", "F4", 0, "4/4", ("C3:h",))

    with pytest.raises(ValueError, match="measure of 24 divisions"):
        corpus.musicxml(broken)


def test_the_same_part_is_fully_correct() -> None:
    reference = measures(document())

    result = compare.compare(reference, measures(document()))

    assert (result.correct_measures, result.reference_measures, result.candidate_measures) == (32, 32, 32)
    assert result.found_marks == result.reference_marks == 7
    assert result.differences == ()
    assert result.accuracy == 1.0


def test_spelling_voices_divisions_beams_and_rests_do_not_matter() -> None:
    candidate = document()
    for element in candidate.iter("beam"):
        element.text = "begin"
    eb = measure(candidate, "11").find("note/pitch")
    eb.find("step").text, eb.find("alter").text = "D", "1"
    for note in measure(candidate, "4").findall("note"):
        if note.find("rest") is not None:
            measure(candidate, "4").remove(note)
    first = measure(candidate, "2")
    first.insert(0, ElementTree.fromstring("<attributes><divisions>24</divisions></attributes>"))
    for duration in first.iter("duration"):
        duration.text = str(int(duration.text) * 2)
    first.find("note/voice").text = "2"
    restore = ElementTree.fromstring("<attributes><divisions>12</divisions></attributes>")
    measure(candidate, "3").insert(0, restore)

    result = compare.compare(measures(document()), measures(candidate))

    assert result.correct_measures == 32


def test_a_wrong_pitch_duration_tie_or_meter_makes_the_measure_wrong() -> None:
    candidate = document()
    measure(candidate, "2").find("note/pitch/octave").text = "4"
    measure(candidate, "21").find("note").remove(measure(candidate, "21").find("note/tie"))
    measure(candidate, "13").find("note/duration").text = "12"
    measure(candidate, "13").append(ElementTree.fromstring("<note><rest/><duration>12</duration></note>"))
    measure(candidate, "30").insert(0, ElementTree.fromstring("<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"))
    measure(candidate, "31").insert(0, ElementTree.fromstring("<attributes><time><beats>2</beats><beat-type>4</beat-type></time></attributes>"))

    result = compare.compare(measures(document()), measures(candidate))

    assert result.correct_measures == 28
    assert any(difference.startswith("battuta 2: attesa 2 q: F5@0+3/2") for difference in result.differences)
    assert [(detail.kind, detail.measure) for detail in result.details] == [("pitch", "2"), ("rhythm", "13"), ("tie", "21"), ("rhythm", "30")]
    assert result.kinds == {"pitch": 1, "rhythm": 2, "tie": 1, "missing": 0, "extra": 0}


def test_a_missing_or_extra_measure_does_not_shift_the_rest_of_the_part() -> None:
    missing = document()
    missing.find("part").remove(measure(missing, "5"))
    extra = document()
    extra.find("part").insert(10, ElementTree.fromstring("<measure number='x'><note><pitch><step>C</step><octave>5</octave></pitch><duration>24</duration></note></measure>"))

    without = compare.compare(measures(document()), measures(missing))
    added = compare.compare(measures(document()), measures(extra))

    assert (without.correct_measures, without.differences[0]) == (31, "battuta 5: mancante")
    assert added.correct_measures == 32
    assert added.differences[0].startswith("battuta in più dopo la 10")


def test_a_multi_measure_rest_read_as_one_measure_misses_the_other_measures() -> None:
    candidate = document(corpus.VALZER)
    part = candidate.find("part")
    for number in range(2, 9):
        part.remove(measure(candidate, str(number)))

    result = compare.compare(measures(document(corpus.VALZER)), measures(candidate))

    assert result.correct_measures == 25
    assert result.candidate_measures == 25


def test_structure_marks_are_found_in_words_or_sound_and_missing_ones_are_listed() -> None:
    reference = document(corpus.TUBA)
    candidate = document(corpus.TUBA)
    direction = measure(candidate, "20").find("direction")
    direction.remove(direction.find("direction-type"))
    pickup = measure(candidate, "0")
    pickup.remove(next(item for item in pickup.findall("direction") if item.find("direction-type/metronome") is not None))

    result = compare.compare(measures(reference), measures(candidate))

    assert compare.load_file(CORPUS / "tuba.musicxml")[-1].marks == frozenset({"da capo"})
    assert (result.found_marks, result.reference_marks) == (2, 3)
    assert result.differences == ("battuta 0: struttura non letta: tempo 92",)


def test_reads_compressed_files_and_compares_from_the_command_line(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    packed = tmp_path / "corretta.mxl"
    with zipfile.ZipFile(packed, "w") as archive:
        archive.writestr("META-INF/container.xml", '<container><rootfiles><rootfile full-path="parte.xml"/></rootfiles></container>')
        archive.writestr("parte.xml", corpus.musicxml(corpus.TUBA))
    recognized = document(corpus.TUBA)
    measure(recognized, "3").find("note/pitch/octave").text = "3"
    candidate = tmp_path / "audiveris.musicxml"
    candidate.write_bytes(ElementTree.tostring(recognized))

    assert len(compare.load(packed.read_bytes())) == 21
    assert main(["compare", str(packed), str(candidate)]) == 0
    output = capsys.readouterr().out
    assert output.startswith("battuta 3: attesa 4 q: Eb2@0+2 G2@2+2; letta 4 q: Eb3@0+2 G2@2+2")
    assert "Battute corrette: 20/21 (95%), lette 21; struttura: 3/3" in output
    assert "Battute diverse: altezze 1, ritmo 0, legature 0, perse 0, in più 0" in output


def test_the_cases_shared_with_the_frontend_are_written_again_after_a_change_of_the_rule() -> None:
    assert cases.CASES_FILE.read_text(encoding="utf-8") == cases.render(), "run python -m accuracy cases again"


def test_the_shared_cases_cover_every_kind_of_difference() -> None:
    found = {difference["kind"] for case in json.loads(cases.render())["cases"] for difference in case["expected"]["differences"]}

    assert found == {"pitch", "rhythm", "tie", "missing", "extra", "marks"}
