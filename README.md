# LeetRace

Full-stack implementation of LeetRace, a competitive LeetCode room platform:
- `frontend`: Next.js App Router UI (deploy to Vercel)
- `backend`: FastAPI API with Postgres persistence (deploy to Render)
- `database`: Supabase Postgres via `DATABASE_URL`

## Features
- Public room discovery (lobby + active) even for logged-out users
- Google OAuth login via Supabase Auth for all room actions
- Mandatory Getting Started onboarding with immutable verified LeetCode username
- Create room with configurable settings (difficulty mix, source, strict-check, timer, schedule)
- Optional room passcode
- Auto-started challenge at scheduled time
- Live leaderboard (5s polling)
- Manual-first solve toggles (optional auto solve sync via feature flag)
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
cp backend/.env.example backend/.env.local
```

Update `backend/.env.local` as needed (especially auth + database values).

Run API:
```bash
. .venv/bin/activate
python backend/run.py
```

API docs: `http://localhost:8000/docs`

Run migrations:
```bash
cd backend
alembic upgrade head
```

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

### Backend (`backend/.env.local` for local, `backend/.env` or env vars for prod)
- `DATABASE_URL`
  Local example: `sqlite:///./leetcode_room_race.db`
  Prod example: `postgresql+psycopg://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres?sslmode=require`
- `LEETCODE_API_BASE_URL`
- `APP_TOKEN_SECRET`
- `CORS_ORIGINS`
- `CORS_ORIGIN_REGEX` (optional, useful for preview domains like `https://.*\.vercel\.app`)
- `SUPABASE_URL`
- `SUPABASE_JWKS_URL` (optional if derivable from `SUPABASE_URL`)
- `SUPABASE_JWT_AUDIENCE` (default `authenticated`)
- `SUPABASE_JWT_ISSUER` (optional if derivable from `SUPABASE_URL`)
- `LEETCODE_VERIFICATION_MODE` (`soft` default, set `strict` for challenge-based verification)
- `SYNC_INTERVAL_SECONDS` (used only when auto solve sync is enabled)
- `AUTO_SOLVE_SYNC_ENABLED` (`false` default for manual-only tracking)
- `MAX_PARTICIPANTS_PER_ROOM`

### Frontend (`frontend/.env.local`)
- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Deployment Notes
- Vercel (frontend): set `NEXT_PUBLIC_API_BASE_URL` to Render backend URL.
- Render (backend): set all backend env vars; point `DATABASE_URL` to Supabase Postgres.
- Production processes should set `APP_ENV=prod` to force `.env` usage if local files exist in the repo.
- Render Python version: use `3.12.3` (`PYTHON_VERSION=3.12.3`).
- Supabase Auth: set `Site URL` to `https://leet-hard.vercel.app`.
- Supabase Auth redirect allow-list: add `http://localhost:3000`, `https://leet-hard.vercel.app`, and preview URLs if used.
- Run DB migrations before serving traffic: `alembic upgrade head`.
- After Google OAuth, users complete Getting Started before create/join.
- Verification mode is controlled by `LEETCODE_VERIFICATION_MODE`:
  - `soft`: username existence check + user confirmation
  - `strict`: Fizz Buzz accepted submission challenge

Detailed step-by-step production guide:
- [DEPLOYMENT.md](/home/shashank-sahu/Documents/leet_hard/DEPLOYMENT.md)
