"""Cases of the measure-by-measure comparison shared with the frontend.

The version comparison of Taurus runs in the browser (``taurus-fe/src/app/score-player/score-compare.ts``) with the rule
of ``compare.py``. ``python -m accuracy cases`` writes ``tests/compare_cases.json`` again: a short reference part and
the parts compared with it, each with what ``compare.py`` finds. The frontend keeps a copy of the file in
``taurus-fe/src/app/score-player/compare-cases.json``, and ``scripts/ops/check-compare-cases.mjs`` fails when the two
copies differ, so that a change of the rule is made in both modules.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from xml.etree import ElementTree

from . import compare, corpus

CASES_FILE = Path(__file__).parent.parent / "tests" / "compare_cases.json"

PIECE = corpus.Piece(
    name="confronto",
    title="Confronto",
    part="Tromba in Sib",
    clef="G2",
    key=-1,
    time="2/4",
    measures=(
        "tempo=96 mf |: F4:e A4:e C5:e A4:e",
        "F5:q. E5:e",
        "D5:et C5:et Bb4:et A4:q",
        "G4:q r:q",
        "[1 F4:q C5:q 1] :|",
        "[2 F4:q r:q 2]",
        "p rest*3",
        "C5:h~",
        "C5:q D5:q",
        "A4+C5:q Bb4:q fine",
        "mf Eb5:e D5:e C5:e Bb4:e",
        "F4:q r:q dc",
    ),
)


def _document() -> ElementTree.Element:
    return ElementTree.fromstring(corpus.musicxml(PIECE).split("\n", 2)[2])


def _measure(root: ElementTree.Element, number: str) -> ElementTree.Element:
    found = root.find(f"part/measure[@number='{number}']")
    assert found is not None, number
    return found


def _same(root: ElementTree.Element) -> None:
    pass


def _notation(root: ElementTree.Element) -> None:
    """Beams, the spelling of a note, rests, divisions and voices change, the sound does not."""
    for beam in root.iter("beam"):
        beam.text = "begin"
    pitch = _measure(root, "13").find("note/pitch")
    assert pitch is not None
    step, alter = pitch.find("step"), pitch.find("alter")
    assert step is not None and alter is not None
    step.text, alter.text = "D", "1"
    fourth = _measure(root, "4")
    for note in fourth.findall("note"):
        if note.find("rest") is not None:
            fourth.remove(note)
    second = _measure(root, "2")
    second.insert(0, ElementTree.fromstring("<attributes><divisions>24</divisions></attributes>"))
    for duration in second.iter("duration"):
        duration.text = str(int(duration.text or 0) * 2)
    voice = second.find("note/voice")
    assert voice is not None
    voice.text = "2"
    _measure(root, "3").insert(0, ElementTree.fromstring(f"<attributes><divisions>{corpus.DIVISIONS}</divisions></attributes>"))


def _notes(root: ElementTree.Element) -> None:
    """An octave, a tie, a duration and a meter are wrong."""
    octave = _measure(root, "2").find("note/pitch/octave")
    assert octave is not None
    octave.text = "4"
    tied = _measure(root, "10").find("note")
    tie = tied.find("tie") if tied is not None else None
    assert tied is not None and tie is not None
    tied.remove(tie)
    eleventh = _measure(root, "11")
    duration = eleventh.find("note/duration")
    assert duration is not None
    duration.text = str(corpus.DIVISIONS // 2)
    eleventh.append(ElementTree.fromstring(f"<note><rest/><duration>{corpus.DIVISIONS // 2}</duration></note>"))
    _measure(root, "13").insert(0, ElementTree.fromstring("<attributes><time><beats>4</beats><beat-type>4</beat-type></time></attributes>"))
    _measure(root, "14").insert(0, ElementTree.fromstring("<attributes><time><beats>2</beats><beat-type>4</beat-type></time></attributes>"))


def _missing(root: ElementTree.Element) -> None:
    """A measure is lost."""
    part = root.find("part")
    assert part is not None
    part.remove(_measure(root, "4"))


def _extra(root: ElementTree.Element) -> None:
    """A measure is read twice."""
    part = root.find("part")
    assert part is not None
    part.insert(10, ElementTree.fromstring(f"<measure number='x'><note><pitch><step>C</step><octave>5</octave></pitch><duration>{corpus.DIVISIONS * 2}</duration></note></measure>"))


def _multi_rest(root: ElementTree.Element) -> None:
    """A rest of three measures is read as one measure."""
    part = root.find("part")
    assert part is not None
    for number in ("8", "9"):
        part.remove(_measure(root, number))


def _marks(root: ElementTree.Element) -> None:
    """The tempo is not read, the D.C. only from its sound, and a repeat is read where there is none."""
    first = _measure(root, "1")
    first.remove(next(item for item in first.findall("direction") if item.find("direction-type/metronome") is not None))
    direction = _measure(root, "14").find("direction")
    words = direction.find("direction-type") if direction is not None else None
    assert direction is not None and words is not None
    direction.remove(words)
    _measure(root, "10").insert(0, ElementTree.fromstring("<barline location='left'><repeat direction='forward'/></barline>"))


CASES: tuple[tuple[str, Callable[[ElementTree.Element], None]], ...] = (
    ("same", _same),
    ("notation", _notation),
    ("notes", _notes),
    ("missing", _missing),
    ("extra", _extra),
    ("multiRest", _multi_rest),
    ("marks", _marks),
)


def _expected(result: compare.Comparison) -> dict[str, object]:
    differences: list[dict[str, object]] = []
    for detail in result.details:
        entry: dict[str, object] = {"kind": detail.kind, "measure": detail.measure}
        if detail.marks:
            entry["marks"] = list(detail.marks)
        differences.append(entry)
    return {
        "referenceMeasures": result.reference_measures,
        "candidateMeasures": result.candidate_measures,
        "correctMeasures": result.correct_measures,
        "referenceMarks": result.reference_marks,
        "foundMarks": result.found_marks,
        "differences": differences,
    }


def render() -> str:
    """The content of the cases file: the reference part and, for each case, the compared part and the result."""
    reference = ElementTree.tostring(_document(), encoding="unicode")
    cases: list[dict[str, object]] = []
    for name, change in CASES:
        root = _document()
        change(root)
        candidate = ElementTree.tostring(root, encoding="unicode")
        result = compare.compare(compare.load(reference.encode()), compare.load(candidate.encode()))
        cases.append({"name": name, "description": (change.__doc__ or "The same part.").strip(), "candidate": candidate, "expected": _expected(result)})
    return json.dumps({"reference": reference, "cases": cases}, ensure_ascii=False, indent=2) + "\n"


def write() -> Path:
    CASES_FILE.write_text(render(), encoding="utf-8", newline="\n")
    return CASES_FILE
