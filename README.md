Project: AccessEd



AccessEd is a free learning platform that is both mobile based and web based, aimed to help the young school drop-outs particularly the youth in Bugesera Rwanda by bringing education closer to them. AccessEd enables access to educational resources through a Progressive Web Application (PWA), allowing the users to download the learning materials or lessons while connected to the internet and continue to access them and study even when offline.



AccessEd brings innovation unlike traditional but digital learning programs that require unbreakable internet connection. It enables continuous learning, access to quizzes, audio content and tracking of the learning progress of the user. Moreover, once the learner is connected back to the internet, there is an automatic synchronization of the progress with the server, ensuring that the learner’s progress when they were offline is not lost.



Live application is here: https://accessed.abdurahim.tech



Project overview



AccessEd is here to address the issue that has been long standing whereby children and young people from low income families tend to become unable to finish the education level due to lack of financial resources to support them with their educational needs and for those who try to use digital learning platforms, internet connectivity costs also hinder their progress.



Statistics prove that in Rwanda out of 98% children that start primary school, only 71% are able to complete it. This explicitly highlights the gap and the need for a platform like AccessEd to bridge this gap.



In that way, our platform is designed around three main principles:



1\. Accessibility: Enabling easy access of learning resources that users can access using their phones or computers, both online and offline.



2\. Offline learning and flexibility: Since one of the challenges of digital learning is limited internet access, AccessEd enables learning even when offline.



3\. Inclusiveness: AccessEd supports all kinds of learning by offering accessibility in terms of different educational levels' resources, languages, and usage of different learning preferences such as audio learning.

AccessEd is offered as a PWA, meaning that learners can access it via their web browser and for those who choose to have it as an app, they can simply install it on their device’s home screen without going through the whole process of getting it from the app store.



Objectives and features of AccessEd

The main purpose of AccessEd is to establish an accessible, flexible and offline digital learning platform that enables financially incapacitated children and youth to continue learning with no hindrance. 

Below are the key objectives:

Offline learning: AccessEd enables learners to access learning resources or their daily and weekly packs even when offline hence cutting the issues regarding internet connectivity. Each learning pack contains four modules, three learning lessons and one recap with a pass score of 70% of quizzes.



Providing interactive learning resources aligning with the Rwanda National Board (REB) and NESA programs. AccessEd provides learning resources of primary and secondary levels. For primary, there’s Maths, english, science and social studies, as for secondary, there’s maths, biology, literacy, life skills and other to be gradually added. 



Downloads: AccessEd enables learners to download the learning resources they need, e.g books so that they can be able to use that at anytime.



Audio and visual aids: Supporting inclusive and interactive learning through audio narrations in MP3 format, visual aids such as pictures and quizzes.



Motivational interactions: Introducing features such as strikes, badges and milestone trackers to encourage learners to be consistent with their studies.



Automatic synchronization of the learner’s progress as well as the quiz scores when online and offline



Multilingual interactions: AccessEd supports the various standard languages which are Kinyarwanda, English and French. 



Shared devices’ support: AccessEd allows shared devices to allow easy access of learners while their personal accounts stay secure and usable across different devices.

Others:

Screen modes which can be light or dark

Passcode visibility button

Responsive screen for phones, tablets and computers.

Entering optional email and phone login credentials during registration.



3\. How AccessEd Works

A learner accesses AccessEd via the browser and registers to create an account and from then, they login as usual using their credentials.



The level chooses the level of education (primary or secondary) of which they want to keep up with and downloads a lesson pack( a compressed ZIP file containing the modules of the lessons and quizzes) while still connected to the internet.



Once they have downloaded the packs, lessons, quizzes and other learning resources can then be accessed offline



The progress and quiz scores are stored locally and automatically synchronized with the server when the learner connects to the internet again.



&#x20;AccessEd installation



AccessEd can be accessed here: https://accessed.abdurahim.tech and installed on the learner’s respective devices

Installation :

1.Open AccessEd website using the browser

2\. Tap the three-dots once the website has opened

3\. Select “add to home screen” or “install app” accordingly



5\. Administration



AccessEd has an administrative interface that enables authorised administrators to monitor and coordinate educational contents and user accounts. 



5.1 Management of learning content



Administrators create, modify, and publish learning directly through the AccessEd application.



The course modifier enables:



Course titles and text.

Audio and visual aid uploads.

Quiz questions and their responses

Final publication of learning packs.

This allows educational content to be managed through the application without requiring administrators to use terminal commands.

Also administrators can also delete individual lessons or the entire learning pack accordingly.



&#x20;5.2 Password Reset Management



For security purposes, AccessEd provides the password reset option for learners who have forgotten their passwords.



Here’s how it works: 



A learner uses their username and then their email or phone number (depending on what they used for their initial registration) on their “Forgot password” screen.



The app submits a reset password request. 

Administrators receive and view the requests through their interface. 



The administrator then prompts and generates an 8 - digits reset code that is sent to the learner.

The learner enters the code and creates a new password.



Security measures include:



Verification codes are to be used only once.

Verification codes expire after 24 hours.

Verification codes are stored as SHA-256 hashes

Reset password requests are disqualified after 5 incorrect code trials.

For those who have verified, they are given the interface of entering their new password and then the issue is resolved.

Password verification codes aren’t via SMS or email, and administrators handle password reset requests through their administrative interfaces.



Project structure





AccessEd\_project/

├── backend/

│   ├── src/

│   │   ├── routes/

│   │   ├── controllers/

│   │   ├── middleware/

│   │   └── utils/

│   ├── db/

│   │   ├── schema.sql

│   │   ├── seed.sql

│   │   └── migrations/

│   ├── Dockerfile

│   ├── docker-compose.yml

│   ├── docker-compose.web.yml

│   └── .env.example

├── frontend/

│   ├── index.html

│   ├── manifest.webmanifest

│   ├── sw.js

│   ├── css/

│   ├── js/

│   └── icons/

├── content/

│   ├── primary/

│   └── secondary/

├── tools/

├── deploy/

├── mobile/

├── .github/

├── CONTENT\_README.md

└── AUDIO\_SCRIPTS.md


7. Technology stack

Frontend: HTML, CSS and Javascript
Application type: PWA
Offline storage: Service worker and IndexedDB
Backend: Express and Node.js 22
Testing: Github actions
Public access:  Cloudflare Tunnel together with HTTPS
Hosting: O oracle Cloud Ubuntu server
Deployment: Docker compose and Nginx
Database: PostgreSQL 16
Password security: Argon2id
Authentication: JSON Web Tokens(JWT)
API: REST APIs

8. Running AccessEd locally 

Requirements:
- Git
- Docker compose
- Docker

Installation steps:

Cloning the repository


git clone https://github.com/abdurahim-art/AccessED_project.git
cd AccessEd_project/backend

Creating the environment file:

Cp .env.example .env

Generate secure values for the required environment variables:

openssl rand -hex 16
openssl rand -hex 32
Use the generated values for DB_PASSWORD and JWT_SECRET in the .env file

Start the application:

Docker compose -f docker-compose.yml -f docker-compose.web.yml up -d —build

Check the API:


Curl http://localhost:5000/health

For success, the response is:

{“status”:”ok”}

Open the application in your browser:

http://localhost:8080

9. API OVERVIEW

The API health check is here:


https://accessed.abdurahim.tech/api/health


The backend provides a REST API under:

/api/v1

Endpoints and their purposes:

GET /health: Checks for the APIs and the availability of the database
POST /auth/register: Handles the registration of a learner
POST /auth/login: Handles the authentication of the user
GET /auth/me: Handles the retrieval of the current user
GET /content/courses: Lists available courses
GET /content/courses/ :courseId/packs: Lists the available lesson packs
POST /content/packs/ :packId/download: Downloads the available and selected lesson pack
POST /content/packs/check-updates: Checks for the lessons that have been updated
POST /sync: Handles the synchronization of the learner’s progress and quiz scores
GET /progress/summary: Handles the retrieval of the leaning progress

The protected endpoints require a valid JWT in the request header:

Authorization : Bearer YOUR_TOKEN

10. AccessED deployment

AccessEd is deployed on an Oracle Cloud Ubuntu using Docker Compose

The deployment contains:
PostgreSQL for the storage of data
Express for the API’s backend
Nginx for forwarding the API requests as well as serving the frontend
And Cloudflare Tunnel for secure public access

11. Quality assurance and testing

Automated testing and integration is done through Github Actions
During pull requests is when CI workflow does its evaluations to identify problems before modifications are integrated into the main project.
The checks involve:
Validation of backend javascript syntax
Frontend testing that targets phone-side functionality
Testing application startup for a complete system stack
These validation checks ensure the high reliability of AccessEd while identifying potential threats during development. 
On top of the checks, additional validations can be made through registration, authentication, lesson downloads, offline learning and all other components of AccessEd.

12. Future improvements

In the coming days AccessEd aims to include more lessons than the current ones, and will be reaching a wider population hence improving the issue of learners who have limited access to digital learning. 




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



