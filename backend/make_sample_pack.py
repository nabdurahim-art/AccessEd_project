import json, zipfile

manifest = {
    "manifest_version": 1,
    "language": "en",
    "modules": [
        {
            "key": "m1",
            "title": "The alphabet",
            "order": 1,
            "duration_min": 10,
            "content_type": "text",
            "body_file": "m1/lesson.md",
            "quiz": {
                "pass_mark": 70,
                "questions": [
                    {
                        "key": "q1",
                        "type": "single_choice",
                        "prompt": "Which letter comes first?",
                        "options": ["A", "B", "C"],
                        "correct_index": 0,
                        "explanation": "A is the first letter."
                    },
                    {
                        "key": "q2",
                        "type": "single_choice",
                        "prompt": "Which letter comes after B?",
                        "options": ["A", "C", "D"],
                        "correct_index": 1
                    }
                ]
            }
        },
        {
            "key": "m2",
            "title": "Reading short words",
            "order": 2,
            "duration_min": 15,
            "content_type": "text",
            "body_file": "m2/lesson.md"
        }
    ]
}

with zipfile.ZipFile("week1.zip", "w") as z:
    z.writestr("manifest.json", json.dumps(manifest, indent=2))
    z.writestr("m1/lesson.md", "# The alphabet\n\nA, B, C are letters.\n")
    z.writestr("m2/lesson.md", "# Short words\n\nCat, dog, sun.\n")
print("Made week1.zip")
