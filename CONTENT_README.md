# Lesson content

Write lessons in `content/`, build zips, publish them.

## Two levels
Courses live in one of two folders:

- `content/primary/` Maths, Social studies, Science, English
- `content/secondary/` Literacy basics, Everyday maths, Life skills (more subjects can be added)

The folder tells the app which level a course belongs to. Learners switch between **Primary** and **Secondary** on the Courses screen.

## Add a lesson
1. Make a folder: `content/primary/<course>/week1/m4/` with `lesson.md` and (optional) `quiz.json`.
2. Add it to `content/primary/<course>/week1/pack.json` under `modules`.
3. Run `python3 tools/build_packs.py`. It lists every problem it finds.

## Add a week
Copy `week1` to `week2` inside the course, change `week_number` to 2 in `pack.json`, then write the new lessons.

## Add a course or a language
Copy a course folder, for example `content/primary/math-en` to `content/primary/math-rw`, translate the files,
and set `"language"` in `course.json` to `en`, `fr` or `rw`. A new subject is a new folder with a `course.json` and a `week1`.

## Lesson text rules (the phone app shows only these)
`# Heading`, `**bold**`, `*italic*`, `- bullet`, and short paragraphs.
No numbered lists, tables, code blocks or links. Use `- ` bullets with the word "First", "Then".

## Audio (optional)
Put a recording named `audio.mp3` in the lesson folder (next to `lesson.md`). The lesson then shows a Listen button.
Record with a phone, then shrink it: `ffmpeg -i recording.m4a -ac 1 -b:a 32k audio.mp3` (about 250 KB per minute, limit 2 MB).
Video is not supported: it is too big for phones with little data and offline storage.

## quiz.json
`correct_index` counts from 0 (0 = the first option). `explanation` is optional.

## Existing database: add the level column (once)
A database made before levels existed needs one change. From the project folder:

    docker compose -f backend/docker-compose.yml exec -T db psql -U accessed -d accessed < backend/db/migrations/001_course_level.sql

Courses already in the database become `secondary`. A new database gets the column automatically.

## Publish (admin account needed)
    cd backend && docker compose up -d && cd ..
    ADMIN_PASSWORD='your-admin-password' python3 tools/publish.py --user your_admin_username

Running it again is safe, but every run raises the pack version by 1, so run it only when the content changed.
