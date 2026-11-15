"""Small MusicXML documents and Audiveris projects used by the tests and by the fake engines."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path

NOTE = "<note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>"


def score(measures: int, *, implicit_first: bool = False, multiple_rest: dict[int, int] | None = None, title: str | None = None) -> str:
    """A one-part score with ``measures`` measures; ``multiple_rest`` maps a measure index to the measures it groups."""
    rests = multiple_rest or {}
    body = []
    for index in range(measures):
        attributes = "<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>" if index == 0 else ""
        if index in rests:
            attributes += f"<attributes><measure-style><multiple-rest>{rests[index]}</multiple-rest></measure-style></attributes>"
        implicit = ' implicit="yes"' if index == 0 and implicit_first else ""
        body.append(f'<measure number="{index + 1}"{implicit}>{attributes}{NOTE}</measure>')
    work = f"<work><work-title>{title}</work-title></work>" if title else ""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
        f'<score-partwise version="4.0">{work}<part-list><score-part id="P1"><part-name>Tuba</part-name></score-part></part-list>'
        f'<part id="P1">{"".join(body)}</part></score-partwise>'
    )


def compressed(document: str, root_name: str = "tuba.xml") -> bytes:
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(
            "META-INF/container.xml",
            f'<container><rootfiles><rootfile full-path="{root_name}"/></rootfiles></container>',
        )
        archive.writestr(root_name, document)
    return output.getvalue()


def project(path: Path, pages: list[list[int]], width: int = 2000, height: int = 1000) -> Path:
    """An Audiveris project: for each page, the number of measure stacks of each system."""
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("book.xml", "<book>" + "".join(f'<sheet number="{n}"/>' for n in range(1, len(pages) + 1)) + "</book>")
        for number, systems in enumerate(pages, start=1):
            archive.writestr(f"sheet#{number}/sheet#{number}.xml", _sheet(systems, width, height))
    return path


def _sheet(systems: list[int], width: int, height: int) -> str:
    content = []
    for index, stacks in enumerate(systems):
        top = 100 + index * 200
        stack_width = 1600 // stacks
        stack_elements = "".join(
            f'<stack id="{s + 1}" left="{200 + s * stack_width}" right="{200 + (s + 1) * stack_width}"/>' for s in range(stacks)
        )
        lines = "".join(
            f'<line><point x="200" y="{top + line * 10}"/><point x="1800" y="{top + line * 10}"/></line>' for line in range(5)
        )
        content.append(f'<system id="{index + 1}">{stack_elements}<part id="1"><staff id="1"><lines>{lines}</lines></staff></part></system>')
    return (
        f'<sheet><picture width="{width}" height="{height}"/><scale><interline main="10"/></scale>'
        f'<page id="1">{"".join(content)}</page></sheet>'
    )


_STEPS = "CDEFGAB"


def part(
    measures: int,
    *,
    system_every: int = 0,
    page_breaks: tuple[int, ...] = (),
    part_name: str = "Tromba in Sib",
    credit: str | None = None,
) -> str:
    """A one-part score in 4/4 with four quarter notes per measure, measures numbered from 1 with the id ``m<number>``.

    ``system_every`` starts a new system every that many measures; ``page_breaks`` lists the measures that start a page.
    """
    body = []
    for index in range(measures):
        number = index + 1
        attributes = (
            "<attributes><divisions>1</divisions><key><fifths>-2</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time>"
            "<clef><sign>G</sign><line>2</line></clef></attributes>"
            if index == 0
            else ""
        )
        if number in page_breaks:
            attributes = '<print new-page="yes"/>' + attributes
        elif system_every and index and index % system_every == 0:
            attributes = '<print new-system="yes"/>' + attributes
        notes = "".join(
            f"<note><pitch><step>{_STEPS[(index + beat) % 7]}</step><octave>{4 + (index + beat) // 7 % 2}</octave></pitch>"
            "<duration>1</duration><type>quarter</type></note>"
            for beat in range(4)
        )
        body.append(f'<measure number="{number}" id="m{number}">{attributes}{notes}</measure>')
    credits = (
        f'<credit page="1"><credit-words default-x="600" default-y="1600" justify="center" valign="top">{credit}</credit-words></credit>'
        if credit
        else ""
    )
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        f'<score-partwise version="4.0">{credits}<part-list><score-part id="P1"><part-name>{part_name}</part-name></score-part></part-list>'
        f'<part id="P1">{"".join(body)}</part></score-partwise>'
    )
