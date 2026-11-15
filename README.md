# AccessEd

AccessEd is a free, phone-first learning app for out-of-school children and youth in Bugesera District, Rwanda. Learners download short lessons while online, study offline, and their progress syncs when they get internet again.

## The Problem

Many learners cannot get steady internet or afford learning materials. Online-only platforms leave them out. In Rwanda, 98% of children start primary school but only 71% finish.

## Our Solution

- Short, interactive lessons in literacy, maths and life skills
- Download lessons once, study offline
- Audio support and visual aids
- Points, streaks and badges to keep learners motivated
- Progress syncs automatically when the learner is back online

## Tech Stack

- **Front end:** HTML, CSS, JavaScript
- **Back end:** Python with a REST API
- **Database:** PostgreSQL
- **Deployment:** Docker

## Project Status

Foundations project (BSc. in Software Engineering, ALU). We are building a prototype and will pilot it with 15-20 learners.

## Team

| Name | Role |
|---|---|
| Nshimiyimana Abdurahim | Project Manager & Requirements Lead |
| Batsinde Ange Liana | Database Architect & UML Specialist |
| Elvis Gatunzi Mutangana | Backend Engineer & Systems Architect |
| Abubakar Hussaina Shehu | Lead Mobile Developer |
| Ezio Munyengango | UI/UX & Content Designer |
| Samuel Ishimwe | QA Engineer & Field Evaluator |


Backend progress:

- [x] Project structure, Docker Compose, PostgreSQL connection
- [x] The 11 database tables from the ERD
- [x] Register, log in (username, email or phone number) and "who am I"
- [x] Automated tests for the above
- [ ] Courses and content packs (list, version check, download with checksum)
- [ ] Sync endpoint for progress and quiz attempts
- [ ] Quizzes, points and badges
- [ ] Rate limiting on login
- [ ] Front end connected to the API
- [ ] Pilot with learners

## Getting Started

Clone the project:

    git clone https://github.com/nabdurahim-art/AccessEd_project.git
    cd AccessEd_project

Start the backend and the database with one command (Docker must be installed):

    docker compose up --build

Then open http://localhost:8000/docs to try the API in your browser.

Run the tests (no Docker needed):

    cd backend
    python -m venv .venv
    source .venv/bin/activate        # on Windows: .venv\Scripts\activate
    pip install -r requirements.txt
    python -m pytest

## API so far

| Method | Address | What it does |
|---|---|---|
| GET | /health | Checks the server is running |
| POST | /api/v1/auth/register | Creates a learner account (username and password required; email and phone optional) |
| POST | /api/v1/auth/login | Logs in with a username, email or phone number and returns a token |
| GET | /api/v1/auth/me | Shows the logged-in user (send the token in the Authorization header) |

## Project Structure

    docker-compose.yml           starts the API and PostgreSQL
    .env.example                 settings to copy into .env
    backend/
      Dockerfile                 builds the API image
      requirements.txt           Python libraries
      app/
        main.py                  starts the app
        config.py                settings
        database.py              database connection
        models.py                the 11 tables
        schemas.py               shape of requests and responses
        security.py              password hashing and login tokens
        dependencies.py          finds out who is making a request
        routers/auth.py          register, login, me
      tests/                     automated tests



