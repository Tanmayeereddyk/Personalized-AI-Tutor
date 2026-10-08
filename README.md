<<<<<<< HEAD
# StudyAI Backend

The backend for **StudyAI**, an AI-powered study assistant built for an AI/ML hackathon.

> **Current status: Phase 1 — Part 2.**
> Part 1 gave us the foundation (app, config, health check). Part 2 added Supabase,
> email/password authentication, user profiles, and courses protected by Row Level Security.
> AI features (Gemini, RAG, quizzes, ...) come in later phases.

---

## 1. Why FastAPI?

- **Fast and simple** — a normal Python function becomes an API endpoint.
- **Automatic docs** — Swagger UI at `/docs`, no extra work needed.
- **Validation for free** — Pydantic checks request/response data.
- **Easy to test** — tests call the app without starting a server.

## 2. What is Supabase? Why does StudyAI use it?

**Supabase** is an open-source backend platform that gives you:

- a **PostgreSQL database** (tables, queries, indexes),
- **authentication** (signup, login, sessions) out of the box,
- **Row Level Security** (database-level permissions),
- a hosted project with a SQL editor and dashboard.

StudyAI uses it so a student team can focus on the AI features instead of building
user accounts and a database from scratch.

### What Supabase Auth does

Supabase Auth handles email/password signup, login, JWT (Bearer) tokens, and
email confirmation. **It stores passwords — our application never does.** We send
the password to Supabase and never write it to our own tables.

### What the tables store

| Table | Stores |
|---|---|
| `profiles` | `id` (same as the auth user id), `email`, `full_name`, `created_at`, `updated_at` — created by the backend on signup |
| `courses` | `id` (UUID), `user_id` (owner), `name`, `description`, `created_at`, `updated_at` |

### What RLS means

**Row Level Security** is a database feature: with RLS enabled, even code using the
anon key can only touch rows that a *policy* allows. Our policies mean:

- a user reads/updates **only their own profile**,
- a user inserts/reads/updates/deletes **only their own courses**.

The backend additionally filters every query by the authenticated user id, and the
powerful **service-role key** stays on the server only — it never reaches the frontend.

## 3. How authentication works

```text
1. POST /api/auth/signup  -> Supabase creates the auth user + our profiles row
2. POST /api/auth/login   -> returns an access_token (JWT)
3. Frontend sends every protected request with:
      Authorization: Bearer <access_token>
4. Backend dependency get_current_user() validates the JWT with Supabase
   -> valid   : request continues
   -> missing/invalid : 401 Unauthorized
5. POST /api/auth/logout -> revokes the token at Supabase
```

The user's id always comes from the **validated token**, never from the request
body — so users can't act as someone else.

## 4. How FastAPI talks to Supabase

`app/db/supabase.py` creates two lazy clients from environment variables:

- **anon client** — Auth operations (signup, login, token checks),
- **service-role client** — table reads/writes (profiles, courses).

Routes receive a client and the current user via FastAPI dependencies
(`app/api/dependencies.py`), then call a service, which runs the Supabase query
and returns a Pydantic schema:

```text
Request
   ↓
Route        (app/api/routes/)   — HTTP only, injects user + db client
   ↓
Service      (app/services/)     — logic + Supabase queries
   ↓
Database     (app/db/supabase.py) — the Supabase client
   ↓
Schema       (app/schemas/)      — response shape & validation
   ↓
JSON response
```

## 5. Folder structure

```text
backend/
├── app/
│   ├── main.py                  # Creates the app, CORS, registers routers
│   ├── core/
│   │   └── config.py            # All settings from environment variables (.env)
│   ├── api/
│   │   ├── dependencies.py      # get_supabase, get_current_user (401 logic)
│   │   └── routes/
│   │       ├── health.py        # GET /health
│   │       ├── auth.py          # /api/auth/* (signup, login, me, logout)
│   │       └── courses.py       # /api/courses/* (CRUD, all protected)
│   ├── schemas/
│   │   ├── health.py            # HealthResponse
│   │   ├── auth.py              # SignupRequest, SessionResponse, MeResponse, ...
│   │   └── course.py            # CourseCreate / CourseUpdate / CourseResponse
│   ├── services/
│   │   ├── health_service.py    # Health-check logic
│   │   ├── auth_service.py      # Signup/login/me/logout logic
│   │   └── course_service.py    # Course CRUD logic (always filters by user id)
│   └── db/
│       └── supabase.py          # The two Supabase clients (anon + service role)
│
├── database/
│   └── schema.sql               # Tables, indexes, trigger, RLS policies
│
├── tests/
│   ├── conftest.py              # Fake Supabase + shared fixtures (tests run offline)
│   ├── test_health.py           # Part 1 health tests
│   ├── test_auth.py             # Auth routes, validation, 401s, schemas
│   └── test_courses.py          # Course routes, 401s, ownership, validation
│
├── requirements.txt
├── .env.example                 # Template — copy to .env and fill in
├── .gitignore                   # .env is ignored by Git
└── README.md                    # This file
```

## 6. API endpoints

| Method | URL | Auth | Purpose |
|---|---|---|---|
| GET | `/` | no | "backend is running" |
| GET | `/health` | no | health check |
| POST | `/api/auth/signup` | no | create account (+ profile) |
| POST | `/api/auth/login` | no | get access token |
| GET | `/api/auth/me` | yes | current user + profile |
| POST | `/api/auth/logout` | yes | revoke token |
| POST | `/api/courses` | yes | create a course |
| GET | `/api/courses` | yes | list **my** courses |
| GET | `/api/courses/{id}` | yes | get one of my courses |
| PUT | `/api/courses/{id}` | yes | update one of my courses |
| DELETE | `/api/courses/{id}` | yes | delete one of my courses |

## 7. Getting started (Windows PowerShell)

Open PowerShell and go to the backend folder:

```powershell
cd "C:\Users\Lenovo\OneDrive\hackathon\backend"
```

### Step 1 — Create and activate a virtual environment

```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

> If PowerShell blocks the script, run once and try again:
> `Set-ExecutionPolicy -Scope Process -ExecutionPolicy RemoteSigned`

### Step 2 — Install dependencies

```powershell
pip install -r requirements.txt
```

## 8. Create a Supabase project

1. Go to <https://supabase.com> and sign up (free).
2. Click **New project**, give it a name (e.g. `studyai`), and set a database password.
3. Wait for the project to be created, then open **Project Settings → API**.
4. Copy the three values:
   - **Project URL** → `SUPABASE_URL`
   - **anon / public** key → `SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret!)

## 9. Configure `.env`

```powershell
Copy-Item .env.example .env
```

Then edit `.env` and fill in your Supabase values:

```text
APP_NAME=StudyAI Backend
APP_ENV=development
FRONTEND_URL=http://localhost:3000

SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

`.env` is listed in `.gitignore`, so it is never committed. Never hardcode keys
in Python files or put them in the README.

## 10. Create the database tables + RLS

1. In the Supabase dashboard, open **SQL Editor**.
2. Click **New query**.
3. Paste the entire contents of `database/schema.sql`.
4. Click **Run** (or press Ctrl+Enter).

This creates `profiles` and `courses`, the indexes, the `updated_at` trigger,
and all Row Level Security policies. You should see `Success. No rows returned`.

> Tip: under **Authentication → Providers → Email**, you can disable
> "Confirm email" while developing, so signup returns a token immediately.

## 11. Start the backend

```powershell
uvicorn app.main:app --reload
```

Expected:

```text
INFO:     Uvicorn running on http://127.0.0.1:8000
INFO:     Application startup complete.
```

## 12. Try the endpoints

| URL | What it is |
|---|---|
| `http://127.0.0.1:8000/` | confirms the backend is running |
| `http://127.0.0.1:8000/health` | health check |
| `http://127.0.0.1:8000/docs` | interactive Swagger documentation |

### Test `/` and `/health`

```powershell
Invoke-RestMethod http://127.0.0.1:8000/
Invoke-RestMethod http://127.0.0.1:8000/health
```

### Test signup and login (PowerShell)

```powershell
Invoke-RestMethod -Uri http://127.0.0.1:8000/api/auth/signup -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"you@example.com","password":"password123","full_name":"Your Name"}'

# Copy access_token from the login response into $token:
$login = Invoke-RestMethod -Uri http://127.0.0.1:8000/api/auth/login -Method Post `
  -ContentType "application/json" `
  -Body '{"email":"you@example.com","password":"password123"}'
$token = $login.access_token

# Use it on protected endpoints:
Invoke-RestMethod http://127.0.0.1:8000/api/auth/me -Headers @{ Authorization = "Bearer $token" }

Invoke-RestMethod -Uri http://127.0.0.1:8000/api/courses -Method Post `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body '{"name":"Algebra 101","description":"Intro course"}'

Invoke-RestMethod http://127.0.0.1:8000/api/courses -Headers @{ Authorization = "Bearer $token" }
```

Calling a protected endpoint **without** the header returns `401 Unauthorized`.

## 13. Open the docs

Visit **<http://127.0.0.1:8000/docs>** — click an endpoint, press
**Try it out**, fill in the body, and (for protected routes) add a header:

```text
Authorization: Bearer <your access_token>
```

## 14. Run the tests

With the virtual environment active, from the `backend/` folder:

```powershell
pytest
```

To see each test by name:

```powershell
pytest -v
```

Tests use a **fake Supabase client** (`tests/conftest.py`), so they run fully
offline — no real Supabase account, keys, or internet required.

## 15. Security notes

- Passwords go to Supabase Auth only — never stored by our app.
- All secrets come from `.env` (Git-ignored); nothing is hardcoded.
- The service-role key exists only on the server and never in frontend code.
- Protected routes return 401 for missing/invalid/expired tokens.
- Error responses never include stack traces or keys.
- RLS policies protect the tables even if a key ever leaked.

## 16. Adding a new feature (the pattern)

1. **Schema** → `app/schemas/<feature>.py`
2. **Service** → `app/services/<feature>_service.py` (logic + Supabase queries)
3. **Route** → `app/api/routes/<feature>.py` (HTTP + `Depends(get_current_user)`)
4. **Register** → `app/main.py`: `app.include_router(...)` (keep main.py small)
5. **Test** → `tests/test_<feature>.py`
=======
# Pixel Perfect Pixels

Implement exactly the screenshot and nothing else

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/9eab364a-cc2f-442a-9b8a-d7ec9e6c4dcf).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
>>>>>>> 2674cd1b6eb01f6de554c5a7016018c5678dd640
