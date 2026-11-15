#!/usr/bin/env python3
"""Makes natural-sounding audio for lessons with a free online voice (edge-tts), then you import it as usual.

    pip install --user --break-system-packages edge-tts
    python3 tools/make_tts.py                       # all lessons that have no recording yet
    python3 tools/make_tts.py --only literacy-en-week1-m1
    python3 tools/make_tts.py --voice en-US-AriaNeural --rate -10%
    python3 tools/make_tts.py --list-voices         # see voice names (English, French)

Writes recordings/<course>-week<N>-<lesson>.mp3. Then run:
    python3 tools/import_audio.py && python3 tools/build_packs.py

Needs internet only while making the audio. The finished mp3 goes into the pack, so learners need no internet.
Kinyarwanda has no voice here: record those lessons with a person.
"""
import argparse, asyncio, json, sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
ROOT = Path(__file__).resolve().parent.parent
CONTENT, REC = ROOT / "content", ROOT / "recordings"

LEVELS = ("primary", "secondary")

def course_dirs():
    """Every course folder as (level, folder): content/primary/<course> and content/secondary/<course>."""
    for level in LEVELS:
        base = CONTENT / level
        if base.is_dir():
            for p in sorted(x for x in base.iterdir() if x.is_dir()):
                yield level, p
DEFAULT_VOICE = {"en": "en-GB-SoniaNeural", "fr": "fr-FR-DeniseNeural"}

ap = argparse.ArgumentParser()
ap.add_argument("--only", help="one recording name, e.g. literacy-en-week1-m1")
ap.add_argument("--voice", help="voice name; default depends on the course language")
ap.add_argument("--rate", default="-10%", help="speaking speed, e.g. -10%% (slower) or +0%%")
ap.add_argument("--force", action="store_true", help="redo lessons that already have a recording")
ap.add_argument("--list-voices", action="store_true")
a = ap.parse_args()

try:
    import edge_tts
except ImportError:
    sys.exit("Install it first:  pip install --user --break-system-packages edge-tts")

from make_scripts import spoken  # same clean-up used for the reading scripts

async def list_voices():
    for v in await edge_tts.list_voices():
        if v["Locale"].split("-")[0] in ("en", "fr"):
            print(f"{v['ShortName']:28} {v['Gender']:7} {v['Locale']}")

async def main():
    REC.mkdir(exist_ok=True)
    jobs = []
    for level, course_dir in ((l, d) for l, d in course_dirs() if (d / "course.json").is_file()):
        lang = json.loads((course_dir / "course.json").read_text(encoding="utf-8"))["language"]
        for week_dir in sorted(course_dir.glob("week*/")):
            pack = json.loads((week_dir / "pack.json").read_text(encoding="utf-8"))
            for m in pack["modules"]:
                name = f"{level}-{course_dir.name}-{week_dir.name}-{m['key']}"
                if a.only and a.only != name:
                    continue
                if lang not in DEFAULT_VOICE and not a.voice:
                    print(f"skip {name}: no voice for language '{lang}', record it with a person")
                    continue
                existing = [f for f in REC.glob(name + ".*")]
                if existing and not a.force:
                    print(f"skip {name}: already has {existing[0].name}")
                    continue
                text = spoken((week_dir / m["key"] / "lesson.md").read_text(encoding="utf-8")).replace("\n\n", "\n")
                jobs.append((name, text, a.voice or DEFAULT_VOICE[lang]))
    for name, text, voice in jobs:
        out = REC / f"{name}.mp3"
        try:
            await edge_tts.Communicate(text, voice, rate=a.rate).save(str(out))
        except Exception as e:
            out.unlink(missing_ok=True)
            sys.exit(f"Could not make {name} ({e}). Check your internet and the voice name (--list-voices).")
        print(f"made {out.relative_to(ROOT)}  ({out.stat().st_size // 1024} KB, {voice})")
    print(f"{len(jobs)} made. Next: python3 tools/import_audio.py && python3 tools/build_packs.py")

asyncio.run(list_voices() if a.list_voices else main())
