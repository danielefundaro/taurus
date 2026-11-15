"""Stands in for the engraving module: same arguments, two blank pages and a placeholder PDF.

The behavior is chosen with the FAKE_ENGRAVE environment variable: ok, fail, sleep, garbage, unreadable, many, missing.
With FAKE_ENGRAVE_RECEIVED, the arguments and the options received are written as JSON to that file.
"""

import argparse
import io
import json
import os
import sys
import time
from pathlib import Path

from PIL import Image

parser = argparse.ArgumentParser()
parser.add_argument("--max-pages", type=int, required=True)
parser.add_argument("score", type=Path)
parser.add_argument("options", type=Path)
parser.add_argument("output", type=Path)
arguments = parser.parse_args()
mode = os.environ.get("FAKE_ENGRAVE", "ok")
if mode == "sleep":
    time.sleep(60)
if mode == "fail":
    sys.exit(1)
arguments.output.mkdir(parents=True, exist_ok=True)
received = {
    "maxPages": arguments.max_pages,
    "options": json.loads(arguments.options.read_text(encoding="utf-8")),
    "score": arguments.score.read_text(encoding="utf-8"),
}
if os.environ.get("FAKE_ENGRAVE_RECEIVED"):
    Path(os.environ["FAKE_ENGRAVE_RECEIVED"]).write_text(json.dumps(received), encoding="utf-8")
result = arguments.output / "result.json"
if mode == "garbage":
    result.write_text("not json", encoding="utf-8")
    sys.exit(0)
if mode in ("unreadable", "many"):
    result.write_text(json.dumps({"error": "unreadableScore" if mode == "unreadable" else "tooManyPages"}), encoding="utf-8")
    sys.exit(0)
for number in (1, 2):
    page = io.BytesIO()
    Image.new("L", (40, 56), "white").save(page, format="PNG")
    (arguments.output / f"page-{number}.png").write_bytes(page.getvalue())
if mode != "missing":
    (arguments.output / "score.pdf").write_bytes(b"%PDF-1.4 fake")
result.write_text(json.dumps({"pages": 2}), encoding="utf-8")
