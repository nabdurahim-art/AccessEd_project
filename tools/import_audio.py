#!/usr/bin/env python3
"""Turns recordings into lesson audio.

Put recordings in recordings/ named  <course>-week<N>-<lesson>.<ext>, for example
    recordings/literacy-en-week1-m1.m4a
then run:
    python3 tools/import_audio.py
Each one becomes content/<course>/week<N>/<lesson>/audio.mp3 (mono, small). Needs ffmpeg.
After that: python3 tools/build_packs.py, then tools/publish.py.
"""
import re, shutil, subprocess, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REC = ROOT / "recordings"
NAME = re.compile(r"^(?P<course>.+)-week(?P<week>\d+)-(?P<mod>[A-Za-z0-9_]+)\.(m4a|mp3|wav|ogg|aac|opus|webm|amr|flac)$", re.I)

if not shutil.which("ffmpeg"):
    sys.exit("ffmpeg is not installed. Run: sudo apt install ffmpeg")
if not REC.is_dir():
    sys.exit("Make a folder called recordings/ in the project and put your recordings in it.")

done = bad = 0
for f in sorted(REC.iterdir()):
    if not f.is_file() or f.name.startswith("."):
        continue
    m = NAME.match(f.name)
    if not m:
        print(f"skip  {f.name}: name must look like literacy-en-week1-m1.m4a")
        bad += 1
        continue
    lesson_dir = ROOT / "content" / m["course"] / f"week{m['week']}" / m["mod"]
    if not (lesson_dir / "lesson.md").is_file():
        print(f"skip  {f.name}: no lesson at {lesson_dir.relative_to(ROOT)}")
        bad += 1
        continue
    out = lesson_dir / "audio.mp3"
    # speech clean-up: remove low rumble, even out the volume, mono, 48 kbps
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(f), "-af", "highpass=f=80,loudnorm=I=-16:TP=-1.5",
                        "-ac", "1", "-ar", "44100", "-b:a", "48k", str(out)])
    if r.returncode != 0:
        print(f"FAIL  {f.name}: ffmpeg could not read it")
        bad += 1
        continue
    kb = out.stat().st_size // 1024
    print(f"ok    {f.name} -> {out.relative_to(ROOT)} ({kb} KB)")
    if kb > 2048:
        print("      warning: over 2 MB, the builder will refuse it. Record a shorter lesson or split it.")
    done += 1
print(f"{done} imported, {bad} skipped")
