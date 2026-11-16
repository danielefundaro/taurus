"""Measure-by-measure comparison of two MusicXML parts, by what the Taurus score player plays.

A measure is correct when it has the same length and the same notes: start, duration, MIDI pitch and tie to the next
note, whatever the voices, spelling, beams or rests. Measures are aligned first, so a measure read twice or missed
counts once and does not shift the rest of the part. Structure marks (repeats, endings, segno, coda, Fine, D.C., D.S.
and tempo) are compared on the aligned measures. The reading rules follow ``score-player/musicxml-score.ts``.

A different measure has a kind: ``rhythm`` when its length, starts or durations differ, ``pitch`` when only pitches
differ, ``tie`` when only ties differ; ``missing`` and ``extra`` are the measures of only one part. The frontend compares
versions with the same rule (``score-player/score-compare.ts``) and the cases of ``tests/compare_cases.json``.
"""

from __future__ import annotations

import difflib
import io
import re
import zipfile
from dataclasses import dataclass
from fractions import Fraction
from pathlib import Path
from xml.etree import ElementTree

_STEPS = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
_NAMES = ("C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B")
_BEAT_UNITS = {"whole": 4, "half": 2, "quarter": 1, "eighth": Fraction(1, 2), "16th": Fraction(1, 4)}


@dataclass(frozen=True)
class Note:
    start: Fraction
    duration: Fraction
    midi: int
    tie: bool

    def __str__(self) -> str:
        name = f"{_NAMES[self.midi % 12]}{self.midi // 12 - 1}"
        return f"{name}{'~' if self.tie else ''}@{self.start}+{self.duration}"


@dataclass(frozen=True)
class Measure:
    number: str
    length: Fraction
    notes: tuple[Note, ...]
    marks: frozenset[str]

    @property
    def content(self) -> tuple[Fraction, tuple[Note, ...]]:
        return self.length, self.notes

    def describe(self) -> str:
        notes = " ".join(str(note) for note in self.notes) or "pausa"
        return f"{self.length} q: {notes}"


KINDS = ("pitch", "rhythm", "tie", "missing", "extra")


@dataclass(frozen=True)
class Difference:
    """A different measure, or the structure marks of a reference measure not found: ``measure`` is the number of the
    reference measure, the one before for an extra measure."""

    kind: str
    measure: str
    text: str
    marks: tuple[str, ...] = ()


@dataclass(frozen=True)
class Comparison:
    reference_measures: int
    candidate_measures: int
    correct_measures: int
    reference_marks: int
    found_marks: int
    details: tuple[Difference, ...]

    @property
    def accuracy(self) -> float:
        return self.correct_measures / self.reference_measures if self.reference_measures else 1.0

    @property
    def differences(self) -> tuple[str, ...]:
        return tuple(detail.text for detail in self.details)

    @property
    def kinds(self) -> dict[str, int]:
        """Different measures by kind, without the structure marks."""
        return {kind: sum(1 for detail in self.details if detail.kind == kind) for kind in KINDS}


def load(data: bytes) -> list[Measure]:
    """Reads the first part of a plain or compressed MusicXML document."""
    if zipfile.is_zipfile(io.BytesIO(data)):
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            data = archive.read(_root_file(archive))
    root = ElementTree.fromstring(data)
    part = root.find("part")
    if root.tag != "score-partwise" or part is None:
        raise ValueError("not a score-partwise document with a part")
    state = {"divisions": Fraction(1), "length": Fraction(4)}
    return [_measure(element, state) for element in part.findall("measure")]


def load_file(path: Path) -> list[Measure]:
    return load(path.read_bytes())


def compare(reference: list[Measure], candidate: list[Measure]) -> Comparison:
    matcher = difflib.SequenceMatcher(None, [m.content for m in reference], [m.content for m in candidate], autojunk=False)
    correct = 0
    pairs: list[tuple[Measure, Measure]] = []
    differences: list[Difference] = []
    for operation, ref_start, ref_end, cand_start, cand_end in matcher.get_opcodes():
        expected, found = reference[ref_start:ref_end], candidate[cand_start:cand_end]
        if operation == "equal":
            correct += len(expected)
        elif operation == "replace":
            for index in range(max(len(expected), len(found))):
                if index < len(expected) and index < len(found):
                    text = f"battuta {expected[index].number}: attesa {expected[index].describe()}; letta {found[index].describe()}"
                    differences.append(Difference(kind(expected[index], found[index]), expected[index].number, text))
                elif index < len(expected):
                    differences.append(Difference("missing", expected[index].number, f"battuta {expected[index].number}: mancante"))
                else:
                    after = expected[-1].number
                    differences.append(Difference("extra", after, f"battuta in più dopo la {after}: {found[index].describe()}"))
        elif operation == "delete":
            differences.extend(Difference("missing", measure.number, f"battuta {measure.number}: mancante") for measure in expected)
        else:
            after = reference[ref_start - 1].number if ref_start else "0"
            differences.extend(Difference("extra", after, f"battuta in più dopo la {after}: {measure.describe()}") for measure in found)
        if operation in ("equal", "replace"):
            pairs.extend(zip(expected, found))
    aligned = {id(ref): cand for ref, cand in pairs}
    reference_marks = sum(len(measure.marks) for measure in reference)
    found_marks = 0
    for measure in reference:
        other = aligned.get(id(measure))
        found = measure.marks & other.marks if other else frozenset()
        found_marks += len(found)
        missing = sorted(measure.marks - found)
        if missing:
            differences.append(Difference("marks", measure.number, f"battuta {measure.number}: struttura non letta: {', '.join(missing)}", tuple(missing)))
    return Comparison(len(reference), len(candidate), correct, reference_marks, found_marks, tuple(differences))


def kind(reference: Measure, candidate: Measure) -> str:
    """Why two aligned measures differ: the rhythm, only the pitches or only the ties."""
    if reference.length != candidate.length or _rhythm(reference) != _rhythm(candidate):
        return "rhythm"
    if _pitches(reference) != _pitches(candidate):
        return "pitch"
    return "tie"


def _rhythm(measure: Measure) -> list[tuple[Fraction, Fraction]]:
    return sorted((note.start, note.duration) for note in measure.notes)


def _pitches(measure: Measure) -> list[tuple[Fraction, Fraction, int]]:
    return sorted((note.start, note.duration, note.midi) for note in measure.notes)


def _measure(element: ElementTree.Element, state: dict[str, Fraction]) -> Measure:
    notes: list[Note] = []
    marks: set[str] = set()
    position = furthest = last_start = Fraction(0)
    for item in element:
        if item.tag == "attributes":
            divisions = _number(item.findtext("divisions"))
            if divisions:
                state["divisions"] = Fraction(divisions)
            time = item.find("time")
            if time is not None:
                beats = sum(int(part) for part in (time.findtext("beats") or "").split("+") if part.strip().isdigit())
                beat_type = _number(time.findtext("beat-type"))
                if beats and beat_type:
                    state["length"] = Fraction(beats * 4) / Fraction(beat_type)
        elif item.tag == "note":
            if item.find("grace") is not None or item.find("cue") is not None:
                continue
            duration = Fraction(_number(item.findtext("duration")) or 0) / state["divisions"]
            chord = item.find("chord") is not None
            start = last_start if chord else position
            if not chord:
                last_start = position
                position += duration
                furthest = max(furthest, position)
            midi = _midi(item)
            if midi is not None:
                tie = any(tie.get("type") == "start" for tie in item.findall("tie"))
                notes.append(Note(start, duration, midi, tie))
        elif item.tag == "backup":
            position -= Fraction(_number(item.findtext("duration")) or 0) / state["divisions"]
        elif item.tag == "forward":
            position += Fraction(_number(item.findtext("duration")) or 0) / state["divisions"]
            furthest = max(furthest, position)
        elif item.tag == "barline":
            _barline(item, marks)
        elif item.tag == "direction":
            _direction(item, marks)
        elif item.tag == "sound":
            _sound(item, marks)
    implicit = element.get("implicit") == "yes"
    length = furthest if implicit and furthest > 0 else state["length"]
    return Measure(element.get("number", ""), length, tuple(sorted(notes, key=lambda n: (n.start, n.midi, n.duration))), frozenset(marks))


def _midi(note: ElementTree.Element) -> int | None:
    pitch = note.find("pitch")
    if pitch is not None:
        step, octave = _STEPS.get(pitch.findtext("step") or ""), _number(pitch.findtext("octave"))
        if step is None or octave is None:
            return None
        return (int(octave) + 1) * 12 + step + round(float(pitch.findtext("alter") or 0))
    unpitched = note.find("unpitched")
    if unpitched is not None:
        octave = _number(unpitched.findtext("display-octave"))
        return (int(octave if octave is not None else 4) + 1) * 12 + _STEPS.get(unpitched.findtext("display-step") or "", 0)
    return None


def _barline(barline: ElementTree.Element, marks: set[str]) -> None:
    repeat = barline.find("repeat")
    if repeat is not None and repeat.get("direction") in ("forward", "backward"):
        marks.add("ritornello inizio" if repeat.get("direction") == "forward" else "ritornello fine")
    ending = barline.find("ending")
    if ending is not None and ending.get("type") == "start":
        marks.add(f"volta {ending.get('number', '1')}")
    if barline.find("segno") is not None:
        marks.add("segno")
    if barline.find("coda") is not None:
        marks.add("coda")


def _direction(direction: ElementTree.Element, marks: set[str]) -> None:
    for kind in direction.findall("direction-type"):
        if kind.find("segno") is not None:
            marks.add("segno")
        if kind.find("coda") is not None:
            marks.add("coda")
        words = re.sub(r"\s+", " ", (kind.findtext("words") or "").lower())
        if words == "fine":
            marks.add("fine")
        if re.search(r"d\.\s?c\.|da capo", words):
            marks.add("da capo")
        if re.search(r"d\.\s?s\.|dal segno", words):
            marks.add("dal segno")
        if re.search(r"to coda|alla coda", words):
            marks.add("al coda")
        metronome = kind.find("metronome")
        if metronome is not None:
            per_minute = _number(metronome.findtext("per-minute"))
            unit = _BEAT_UNITS.get(metronome.findtext("beat-unit") or "quarter", 1)
            if per_minute:
                dotted = Fraction(3, 2) if metronome.find("beat-unit-dot") is not None else 1
                marks.add(f"tempo {round(per_minute * unit * dotted)}")
    sound = direction.find("sound")
    if sound is not None:
        _sound(sound, marks)


def _sound(sound: ElementTree.Element, marks: set[str]) -> None:
    tempo = _number(sound.get("tempo"))
    if tempo:
        marks.add(f"tempo {round(tempo)}")
    for attribute, mark in (("dacapo", "da capo"), ("dalsegno", "dal segno"), ("fine", "fine"), ("segno", "segno"), ("coda", "coda"), ("tocoda", "al coda")):
        value = sound.get(attribute)
        if value and (attribute != "dacapo" or value == "yes"):
            marks.add(mark)


def _number(value: str | None) -> float | None:
    try:
        return float(value) if value is not None else None
    except ValueError:
        return None


def _root_file(archive: zipfile.ZipFile) -> str:
    names = archive.namelist()
    if "META-INF/container.xml" in names:
        rootfile = ElementTree.fromstring(archive.read("META-INF/container.xml")).find(".//rootfile")
        if rootfile is not None and rootfile.get("full-path") in names:
            return rootfile.get("full-path", "")
    candidates = [name for name in names if name.endswith((".xml", ".musicxml")) and not name.startswith("META-INF/")]
    if not candidates:
        raise ValueError("compressed MusicXML without score")
    return candidates[0]
