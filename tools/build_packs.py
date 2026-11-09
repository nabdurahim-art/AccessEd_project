#!/usr/bin/env python3
"""Builds lesson pack zips from the content/ folder.

    python3 tools/build_packs.py

Folder layout:
  content/<course>/course.json        title, subject, language, description
  content/<course>/week1/pack.json    title, week_number, modules [{key, title, duration_min}]
  content/<course>/week1/m1/lesson.md the lesson text
  content/<course>/week1/m1/quiz.json optional: pass_mark, questions [{prompt, options, correct_index, explanation}]

Writes dist/<course>-week<N>.zip and dist/catalog.json. Stops with a list of problems if anything is wrong.
"""
import hashlib, json, re, sys, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT, DIST = ROOT / "content", ROOT / "dist"
LANGS = {"en", "fr", "rw"}
KEY_RULE = re.compile(r"^[A-Za-z0-9_-]{1,30}$")
problems = []

def bad(where, msg):
    problems.append(f"{where}: {msg}")

def load(path, where):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        bad(where, f"missing {path.name}")
    except json.JSONDecodeError as e:
        bad(where, f"{path.name} is not valid JSON ({e})")
    return None

def check_lesson_text(text, where):
    # The phone app shows headings, **bold**, *italic*, "- " bullets and images only.
    for n, line in enumerate(text.splitlines(), 1):
        if re.match(r"^\s*\d+[.)]\s", line):
            bad(where, f"line {n}: numbered lists are not shown as a list, use '- ' bullets")
        if line.lstrip().startswith(("```", "|", ">")):
            bad(where, f"line {n}: code blocks, tables and quotes are not supported")
        if re.search(r"\[[^\]]+\]\(http", line):
            bad(where, f"line {n}: links do not work offline, remove them")

def check_quiz(quiz, where):
    if not isinstance(quiz.get("pass_mark", 70), int) or not 0 <= quiz.get("pass_mark", 70) <= 100:
        bad(where, "pass_mark must be a whole number from 0 to 100")
    qs = quiz.get("questions")
    if not isinstance(qs, list) or not qs:
        bad(where, "quiz needs at least one question")
        return []
    out = []
    for i, q in enumerate(qs, 1):
        w = f"{where} question {i}"
        opts = q.get("options")
        if not str(q.get("prompt", "")).strip():
            bad(w, "prompt is empty")
        if not isinstance(opts, list) or not 2 <= len(opts) <= 6 or not all(isinstance(o, str) and o.strip() for o in opts):
            bad(w, "needs 2 to 6 non-empty options")
            continue
        if len(set(opts)) != len(opts):
            bad(w, "two options are the same")
        ci = q.get("correct_index")
        if not isinstance(ci, int) or isinstance(ci, bool) or not 0 <= ci < len(opts):
            bad(w, "correct_index must point at one of the options (0 is the first)")
            continue
        item = {"key": f"q{i}", "type": "multiple_choice", "prompt": q["prompt"], "options": opts, "correct_index": ci}
        if q.get("explanation"):
            item["explanation"] = q["explanation"]
        out.append(item)
    return out

def build_pack(course_dir, course, week_dir):
    where = f"{course_dir.name}/{week_dir.name}"
    pack = load(week_dir / "pack.json", where)
    if not pack:
        return None
    if not str(pack.get("title", "")).strip():
        bad(where, "pack title is empty")
    wn = pack.get("week_number")
    if not isinstance(wn, int) or wn < 1:
        bad(where, "week_number must be 1 or more")
    mods = pack.get("modules")
    if not isinstance(mods, list) or not mods:
        bad(where, "needs at least one module")
        return None
    manifest_mods, files, seen = [], {}, set()
    for order, m in enumerate(mods, 1):
        key = str(m.get("key", ""))
        mw = f"{where}/{key or '?'}"
        if not KEY_RULE.match(key):
            bad(mw, "key must be 1 to 30 letters, numbers, - or _")
            continue
        if key in seen:
            bad(mw, "key used twice")
        seen.add(key)
        if not str(m.get("title", "")).strip():
            bad(mw, "title is empty")
        lesson = week_dir / key / "lesson.md"
        if not lesson.is_file():
            bad(mw, "missing lesson.md")
            continue
        text = lesson.read_text(encoding="utf-8")
        if len(text.strip()) < 40:
            bad(mw, "lesson.md is almost empty")
        check_lesson_text(text, mw)
        entry = {"key": key, "title": m["title"], "order": order, "duration_min": m.get("duration_min", 10),
                 "content_type": "markdown", "body_file": f"{key}/lesson.md"}
        files[entry["body_file"]] = text.encode("utf-8")
        quiz_file = week_dir / key / "quiz.json"
        if quiz_file.is_file():
            quiz = load(quiz_file, mw)
            if quiz is not None:
                qs = check_quiz(quiz, mw)
                if qs:
                    entry["quiz"] = {"pass_mark": quiz.get("pass_mark", 70), "questions": qs}
        manifest_mods.append(entry)
    manifest = {"manifest_version": 1, "language": course["language"], "modules": manifest_mods}
    return pack, manifest, files

def write_zip(path, manifest, files):
    # Fixed timestamps, so the same content always gives the same checksum.
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in [("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False).encode("utf-8")), *sorted(files.items())]:
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data)

def main():
    catalog = []
    built = []
    for course_dir in sorted(p for p in CONTENT.iterdir() if p.is_dir()):
        if not (course_dir / "course.json").is_file():
            print(f"skipping {course_dir.name}: no course.json")
            continue
        course = load(course_dir / "course.json", course_dir.name)
        if not course:
            continue
        if course.get("language") not in LANGS:
            bad(course_dir.name, "language must be en, fr or rw")
            continue
        for k in ("title", "subject"):
            if not str(course.get(k, "")).strip():
                bad(course_dir.name, f"course {k} is empty")
        weeks = sorted(course_dir.glob("week*/"))
        if not weeks:
            bad(course_dir.name, "no week folders (week1, week2 ...)")
        for week_dir in weeks:
            r = build_pack(course_dir, course, week_dir)
            if r:
                built.append((course_dir, course, week_dir, *r))
    if problems:
        print("Fix these first:\n  - " + "\n  - ".join(problems))
        sys.exit(1)

    DIST.mkdir(exist_ok=True)
    for old in DIST.glob("*.zip"):
        old.unlink()
    for course_dir, course, week_dir, pack, manifest, files in built:
        name = f"{course_dir.name}-week{pack['week_number']}.zip"
        write_zip(DIST / name, manifest, files)
        data = (DIST / name).read_bytes()
        catalog.append({"course": course, "pack": {"title": pack["title"], "week_number": pack["week_number"]},
                        "file": name, "size_kb": max(1, round(len(data) / 1024)), "sha256": hashlib.sha256(data).hexdigest(),
                        "lessons": len(manifest["modules"]),
                        "quiz_questions": sum(len(m.get("quiz", {}).get("questions", [])) for m in manifest["modules"])})
        print(f"built {name}: {len(manifest['modules'])} lessons, {len(data)} bytes")
    (DIST / "catalog.json").write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"done: {len(catalog)} packs in dist/")

main()
