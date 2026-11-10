#!/usr/bin/env python3
"""Publishes the packs in dist/ to the running API (admin only). Safe to run again:
it reuses a course with the same title, language and level, and a pack for the same week gets a new version.

    ADMIN_PASSWORD='...' python3 tools/publish.py --user admin_name

Options: --api http://localhost:5000/api/v1   --compose backend/docker-compose.yml   --no-copy
"""
import argparse, json, os, subprocess, sys, urllib.request, urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ap = argparse.ArgumentParser()
ap.add_argument("--api", default="http://localhost:5000/api/v1")
ap.add_argument("--user", required=True)
ap.add_argument("--compose", default=str(ROOT / "backend" / "docker-compose.yml"))
ap.add_argument("--no-copy", action="store_true", help="do not copy zips into the api container (already there)")
a = ap.parse_args()
password = os.environ.get("ADMIN_PASSWORD")
if not password:
    sys.exit("Set ADMIN_PASSWORD first, for example:  ADMIN_PASSWORD='...' python3 tools/publish.py --user name")

def call(method, path, body=None, token=None):
    req = urllib.request.Request(a.api + path, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}
    except urllib.error.URLError as e:
        sys.exit(f"Cannot reach {a.api} ({e.reason}). Is the API running?")

st, res = call("POST", "/auth/login", {"identifier": a.user, "password": password})
if st != 200:
    sys.exit(f"Login failed ({st}): {res.get('error')}")
token = res["token"]

catalog = json.loads((ROOT / "dist" / "catalog.json").read_text(encoding="utf-8"))
st, res = call("GET", "/content/courses", token=token)
existing = res.get("courses", []) if st == 200 else []

for item in catalog:
    c, p = item["course"], item["pack"]
    found = next((x for x in existing if x["title"] == c["title"] and x["language"] == c["language"] and x.get("level", "secondary") == c["level"]), None)
    if found:
        course_id = found["course_id"]
    else:
        st, res = call("POST", "/content/courses", c, token)
        if st != 201:
            sys.exit(f"Could not create course {c['title']} ({st}): {res.get('error')}")
        course_id = res["course"]["course_id"]
        existing.append(res["course"])
    if not a.no_copy:
        zip_path = ROOT / "dist" / item["file"]
        r = subprocess.run(["docker", "compose", "-f", a.compose, "cp", str(zip_path), f"api:/app/storage/packs/{item['file']}"])
        if r.returncode != 0:
            sys.exit(f"Could not copy {item['file']} into the api container.")
    st, res = call("POST", "/content/packs", {"course_id": course_id, "title": p["title"], "week_number": p["week_number"], "file_path": item["file"]}, token)
    if st in (200, 201):
        pk = res["pack"]
        print(f"OK  [{c['level']}] {c['title']} / {p['title']}  (pack {pk['pack_id']}, version {pk['version']}, {'new' if st == 201 else 'updated'})")
    else:
        print(f"FAIL {item['file']} ({st}): {res.get('error')}")
        for d in res.get("details", []):
            print("      -", d)
