# LeetCode Room Race MVP

Full-stack implementation of a private LeetCode race platform:
- `frontend`: Next.js App Router UI (deploy to Vercel)
- `backend`: FastAPI API with Postgres persistence (deploy to Render)
- `database`: Supabase Postgres via `DATABASE_URL`

## Features
- Google OAuth login via Supabase Auth (hard cutover, login required)
- Account profile with one primary LeetCode username
- Create room with configurable settings (difficulty mix, source, strict-check, timer, schedule)
- Optional room passcode
- Auto-started challenge at scheduled time
- Live leaderboard (5s polling)
- Auto solve sync from unofficial LeetCode API + manual fallback toggles
- Persistent room history + solve timeline
- User dashboard with core performance metrics and recent rooms

## Tech Stack
- Frontend: Next.js + Tailwind (professional coding-platform style)
- Backend: FastAPI + SQLAlchemy
- Database: PostgreSQL (Supabase)
- LeetCode source: `https://leetcode-api-pied.vercel.app`

## Local Setup

### 1) Backend
```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
cp backend/.env.example backend/.env
```

Update `backend/.env` as needed (especially auth + database values).

Run API:
```bash
. .venv/bin/activate
python backend/run.py
```

API docs: `http://localhost:8000/docs`

Run backend tests:
```bash
. .venv/bin/activate
PYTHONPATH=backend pytest -q backend/tests
```

### 2) Frontend
```bash
cd frontend
cp .env.local.example .env.local
npm install
npm run dev
```

Frontend app: `http://localhost:3000`

## Key Environment Variables

### Backend (`backend/.env`)
- `DATABASE_URL`
  Example: `postgresql+psycopg://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require`
- `LEETCODE_API_BASE_URL`
- `APP_TOKEN_SECRET`
- `CORS_ORIGINS`
- `SUPABASE_URL`
- `SUPABASE_JWKS_URL` (optional if derivable from `SUPABASE_URL`)
- `SUPABASE_JWT_AUDIENCE` (default `authenticated`)
- `SUPABASE_JWT_ISSUER` (optional if derivable from `SUPABASE_URL`)
- `SYNC_INTERVAL_SECONDS`
- `MAX_PARTICIPANTS_PER_ROOM`

### Frontend (`frontend/.env.local`)
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Deployment Notes
- Vercel (frontend): set `NEXT_PUBLIC_API_BASE_URL` to Render backend URL.
- Render (backend): set all backend env vars; point `DATABASE_URL` to Supabase Postgres.
- Render Python version: use `3.12.3` (`PYTHON_VERSION=3.12.3`).
- Supabase: create a project, enable Google provider, configure redirect URLs for localhost + Vercel.
- Run DB migrations before serving traffic: `alembic upgrade head`.

Detailed step-by-step production guide:
- [DEPLOYMENT.md](/home/shashank-sahu/Documents/leet_hard/DEPLOYMENT.md)
