"""Command line of the accuracy checks, run from the ``taurus-omr`` folder.

- ``python -m accuracy render``: writes the reference parts and their pages again (``requirements-accuracy.txt``);
- ``python -m accuracy run --url http://localhost:8090 --key ...``: recognizes the corpus and prints the results;
  ``--save folder`` keeps what each engine read;
- ``python -m accuracy names --url http://localhost:8090 --key ...``: reads the part name on the first page of each
  piece with the text engine and prints the lines the backend would keep;
- ``python -m accuracy compare corrected.mxl recognized.mxl``: compares a real part recognized by an engine with the
  version corrected by an archivist, both downloaded from Taurus, and lists the different measures;
- ``python -m accuracy cases``: writes again the comparison cases shared with the frontend (``tests/compare_cases.json``).
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m accuracy", description="Accuratezza dei motori di riconoscimento.")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("render", help="disegna di nuovo le parti di riferimento")
    run = commands.add_parser("run", help="riconosce le parti di riferimento con il servizio")
    run.add_argument("--url", default=os.environ.get("TAURUS_OMR_ACCURACY_URL", "http://localhost:8090"))
    run.add_argument("--key", default=os.environ.get("TAURUS_OMR_ACCURACY_KEY"))
    run.add_argument("--save", type=Path, help="cartella dove salvare ciò che ha letto ogni motore")
    run.add_argument("pieces", nargs="*", help="solo i brani indicati")
    names = commands.add_parser("names", help="legge il nome della parte sulla prima pagina dei brani")
    names.add_argument("--url", default=os.environ.get("TAURUS_OMR_ACCURACY_URL", "http://localhost:8090"))
    names.add_argument("--key", default=os.environ.get("TAURUS_OMR_ACCURACY_KEY"))
    names.add_argument("pieces", nargs="*", help="solo i brani indicati")
    pair = commands.add_parser("compare", help="confronta una parte riconosciuta con la versione corretta")
    pair.add_argument("reference", type=Path, help="versione corretta (.mxl, .musicxml)")
    pair.add_argument("candidate", type=Path, help="versione riconosciuta (.mxl, .musicxml)")
    commands.add_parser("cases", help="scrive di nuovo i casi del confronto comuni con il frontend")
    options = parser.parse_args(arguments)

    if options.command == "render":
        from .render import render

        for path in render():
            print(path)
        return 0
    if options.command == "run":
        from .run import evaluate, report

        if not options.key:
            parser.error("serve la chiave del servizio: --key o TAURUS_OMR_ACCURACY_KEY")
        print(report(evaluate(options.url, options.key, options.pieces or None, save=options.save)))
        return 0

    if options.command == "names":
        from .run import names_report, read_names

        if not options.key:
            parser.error("serve la chiave del servizio: --key o TAURUS_OMR_ACCURACY_KEY")
        print(names_report(read_names(options.url, options.key, options.pieces or None)))
        return 0

    if options.command == "cases":
        from .cases import write

        print(write())
        return 0

    from .compare import compare, load_file

    result = compare(load_file(options.reference), load_file(options.candidate))
    for difference in result.differences:
        print(difference)
    print(
        f"Battute corrette: {result.correct_measures}/{result.reference_measures} ({result.accuracy:.0%}), "
        f"lette {result.candidate_measures}; struttura: {result.found_marks}/{result.reference_marks}"
    )
    kinds = result.kinds
    print(
        f"Battute diverse: altezze {kinds['pitch']}, ritmo {kinds['rhythm']}, legature {kinds['tie']}, "
        f"perse {kinds['missing']}, in più {kinds['extra']}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
