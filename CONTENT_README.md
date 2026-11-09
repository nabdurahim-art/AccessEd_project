# Lesson content

Write lessons in `content/`, build zips, publish them.

## Add a lesson
1. Make a folder: `content/<course>/week1/m4/` with `lesson.md` and (optional) `quiz.json`.
2. Add it to `content/<course>/week1/pack.json` under `modules`.
3. Run `python3 tools/build_packs.py`. It lists every problem it finds.

## Add a language or course
Copy a course folder, for example `content/literacy-en` to `content/literacy-rw`, translate the files,
and set `"language"` in `course.json` to `en`, `fr` or `rw`.

## Lesson text rules (the phone app shows only these)
`# Heading`, `**bold**`, `*italic*`, `- bullet`, and short paragraphs.
No numbered lists, tables, code blocks or links. Use `- ` bullets with the word "First", "Then".

## quiz.json
`correct_index` counts from 0 (0 = the first option). `explanation` is optional.

## Publish (admin account needed)
    cd backend && docker compose up -d && cd ..
    ADMIN_PASSWORD='your-admin-password' python3 tools/publish.py --user your_admin_username

Running it again is safe, but every run raises the pack version by 1, so run it only when the content changed.
