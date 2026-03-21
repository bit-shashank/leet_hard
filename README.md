# LeetCode Room Race MVP

Full-stack implementation of a private LeetCode race platform:
- `frontend`: Next.js App Router UI (deploy to Vercel)
- `backend`: FastAPI API with Postgres persistence (deploy to Render)
- `database`: Supabase Postgres via `DATABASE_URL`

## Features
- Create room with configurable settings (`3-6` medium problems, timer duration)
- Join room with nickname + LeetCode username
- Optional room passcode
- Host-started challenge with random `Medium + non-paid` problem set
- 1-hour default countdown (customizable)
- Live leaderboard (5s polling)
- Auto solve sync from unofficial LeetCode API + manual fallback toggles
- Persistent room history + solve timeline

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

Update `backend/.env` as needed (especially `DATABASE_URL`, `CORS_ORIGINS`).

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
- `SYNC_INTERVAL_SECONDS`
- `MAX_PARTICIPANTS_PER_ROOM`

### Frontend (`frontend/.env.local`)
- `NEXT_PUBLIC_API_BASE_URL`

## Deployment Notes
- Vercel (frontend): set `NEXT_PUBLIC_API_BASE_URL` to Render backend URL.
- Render (backend): set all backend env vars; point `DATABASE_URL` to Supabase Postgres.
- Render Python version: use `3.12.3` (`PYTHON_VERSION=3.12.3`).
- Supabase: create a Postgres project and use connection URI as `DATABASE_URL`.

Detailed step-by-step production guide:
- [DEPLOYMENT.md](/home/shashank-sahu/Documents/leet_hard/DEPLOYMENT.md)
