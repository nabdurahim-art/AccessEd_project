# Lesson content

Write lessons in `content/`, build zips, publish them.

## Two levels
Courses live in one of two folders:

- `content/primary/` Maths, Social studies, Science, English
- `content/secondary/` Literacy basics, Everyday maths, Life skills (more subjects can be added)

The folder tells the app which level a course belongs to. Learners switch between **Primary** and **Secondary** on the Courses screen.

## Courses cut from the REB books
Four small courses follow the official REB books (downloaded from elearning.reb.rw). Each course takes two units of the book, one unit per week.

| Folder | Course | REB book | Week 1 | Week 2 |
|---|---|---|---|---|
| `content/primary/math-p5-en` | Maths P5: Angles and data | Mathematics Pupil's Book, Primary 5 (2025 edition) | Unit 11: angles and lines | Unit 14: data handling |
| `content/primary/english-p5-en` | English P5: Grammar | English Pupil's Book, Primary 5 | Unit 1: past and future events | Units 5 and 6: comparatives and superlatives |
| `content/secondary/math-s1-en` | Maths S1: Angles and statistics | Mathematics Student's Book, Senior 1 (2026-2027) | Unit 6: points, lines and angles | Unit 7: statistics with ungrouped data |
| `content/secondary/biology-s1-en` | Biology S1: Classification and cells | Biology Student's Book, Senior 1 | Unit 2: introduction to classification | Unit 5: plant and animal cells |

The lessons follow the order and the competences of each unit, but the wording, examples and questions are our own. The books belong to REB, so do not paste text or pictures from them into a lesson, and do not add the PDFs to this repository.

### Shape of a week in these courses
Each week has four modules: `m1`, `m2`, `m3` and `recap`.

A lesson (`m1` to `m3`) has the same parts in the same order:
- `## Think first`: one easy question, no marks.
- The teaching part: short sentences, about 300 to 400 words, one small skill.
- `## Example`, then `## Try it`: one worked example, then two for the learner with a hint and the answers.
- `## Think back`: one closing question.
- `quiz.json`: 5 to 8 questions with 3 or 4 options. Wrong options are real mistakes learners make, and every explanation says why the common wrong answer is wrong.

A `recap` has the three big ideas of the week, one real-life challenge that uses all three lessons, and a quiz of exactly 10 questions. The week 2 recap mixes 6 questions from week 2 with 4 from week 1.

To cut another unit into a course: write the goal sentence, write the recap questions first, keep only what those questions need, then split it into three lessons from easy to hard.

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
