# AccessEd frontend

One web app for phones and computers. It uses plain HTML, CSS and JavaScript, with no build step.
The layout changes with the screen width: phone layout below 768 px, desktop layout (side menu, wide pages) above it.

## Run it
It is served by Nginx together with the API (see `deploy/nginx.conf` and `backend/docker-compose.web.yml`):

    cd backend
    docker compose -f docker-compose.yml -f docker-compose.web.yml up -d

Then open http://localhost:8080

## Settings
`js/config.js` sets `API_URL`. It is `/api/v1`, because Nginx sends `/api/` to the backend on the same address.

## What it does
- Sign up and log in (English, French, Kinyarwanda)
- Download weekly lesson packs and keep them for offline use
- Lessons with optional audio, quizzes, points, streaks, badges and a progress summary
- Works offline after the first load, and sends saved work to the server when the internet returns
- Each learner's progress is kept apart on a shared device

## Files
- `index.html`, `manifest.webmanifest`, `sw.js` (page, install info, offline shell)
- `css/styles.css` (phone styles, then desktop styles at the end)
- `js/app.js` (router, sign-up, login, banner), `js/learn.js` (courses, lessons, quiz),
  `js/packs.js` (download, checksum, unzip), `js/sync.js` (offline queue), `js/db.js` (IndexedDB), `js/strings.js` (translations)
- `vendor/` (JSZip and js-sha256, kept locally so the app works offline)

## Notes
- The service worker and offline reload need HTTPS, or `localhost`.
- The Kinyarwanda texts should be checked by a native speaker before the pilot.
