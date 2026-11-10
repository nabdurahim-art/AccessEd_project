#!/usr/bin/env python3
"""Writes AUDIO_SCRIPTS.md: a plain reading script for every lesson, to read aloud when recording.

    python3 tools/make_scripts.py
"""
import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = ROOT / "content"

LEVELS = ("primary", "secondary")

def course_dirs():
    """Every course folder as (level, folder): content/primary/<course> and content/secondary/<course>."""
    for level in LEVELS:
        base = CONTENT / level
        if base.is_dir():
            for p in sorted(x for x in base.iterdir() if x.is_dir()):
                yield level, p

def spoken(md):
    out = []
    for line in md.splitlines():
        t = line.strip()
        if not t:
            continue
        t = re.sub(r"^#+\s*", "", t)
        t = re.sub(r"^[-*]\s+", "", t)
        t = t.replace("**", "").replace("*", "")
        t = re.sub(r"(\d)\s*RWF", r"\1 Rwandan francs", t)
        t = t.replace(" + ", " plus ").replace(" - ", " minus ").replace(" = ", " equals ").replace(" x ", " times ")
        t = t.replace("____", "your name")
        if t and t[-1] not in ".?!:":
            t += "."
        out.append(t)
    return "\n\n".join(out)

def main():
    lines = ["# Audio reading scripts", "",
             "Record each lesson in a quiet room, at a calm speed, with a short pause between paragraphs.",
             "Name each recording exactly as shown, put it in the `recordings/` folder, then run `python3 tools/import_audio.py`.", ""]
    for level, course_dir in ((l, d) for l, d in course_dirs() if (d / "course.json").is_file()):
        course = json.loads((course_dir / "course.json").read_text(encoding="utf-8"))
        for week_dir in sorted(course_dir.glob("week*/")):
            pack = json.loads((week_dir / "pack.json").read_text(encoding="utf-8"))
            lines += [f"## {level.capitalize()} - {course['title']} - {pack['title']}", ""]
            for m in pack["modules"]:
                md = (week_dir / m["key"] / "lesson.md").read_text(encoding="utf-8")
                lines += [f"### {m['title']}", f"File name: `{level}-{course_dir.name}-{week_dir.name}-{m['key']}.m4a` (or .mp3, .wav, .ogg)", "", spoken(md), ""]
    (ROOT / "AUDIO_SCRIPTS.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("wrote AUDIO_SCRIPTS.md")


if __name__ == "__main__":
    main()
