# Deployment Guide (Vercel + Render + Supabase)

This guide is for this repository structure:
- `frontend/` -> Next.js app (Vercel)
- `backend/` -> FastAPI app (Render)
- DB -> Supabase Postgres

Follow the order exactly:
1. Supabase
2. Render (backend)
3. Vercel (frontend)
4. Verification

## 1) Supabase Setup

1. Create a Supabase project.
2. From Supabase, copy the Postgres connection string.
3. In Supabase Auth:
- Enable **Google** provider.
- Set **Site URL** to `https://leet-hard.vercel.app`.
- Add redirect URLs:
  - `http://localhost:3000`
  - `https://leet-hard.vercel.app`
  - preview URLs if you use Vercel previews
4. Use a SQLAlchemy-compatible URL in backend env:

```env
DATABASE_URL=postgresql+psycopg://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres?sslmode=require
```

## 2) Deploy Backend on Render

### Create Service

1. In Render, create a **Web Service** from your Git repo.
2. Configure:
- Root Directory: `backend`
- Runtime: `Python 3`
- Python Version: `3.12.3` (important, do not use 3.14 for current dependency set)
- Build Command: `pip install -r requirements.txt`
- Start Command: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
- Health Check Path: `/health`
- Pre-Deploy Command: `alembic upgrade head`

Using `alembic upgrade head` on each deploy is important so schema is always in sync.

### Backend Environment Variables (Render)

Set these in Render service env:

```env
APP_NAME=LeetRace API
APP_ENV=prod
DATABASE_URL=postgresql+psycopg://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres?sslmode=require
LEETCODE_API_BASE_URL=https://leetcode-api-pied.vercel.app
APP_TOKEN_SECRET=<long-random-secret>
CORS_ORIGINS=https://leet-hard.vercel.app,http://localhost:3000
FRONTEND_BASE_URL=https://leet-hard.vercel.app
SUPABASE_URL=https://<PROJECT_REF>.supabase.co
SUPABASE_JWKS_URL=https://<PROJECT_REF>.supabase.co/auth/v1/.well-known/jwks.json
SUPABASE_JWT_AUDIENCE=authenticated
SUPABASE_JWT_ISSUER=https://<PROJECT_REF>.supabase.co/auth/v1
SYNC_INTERVAL_SECONDS=15
AVATAR_SYNC_TTL_SECONDS=21600
MAX_PARTICIPANTS_PER_ROOM=50
PYTHON_VERSION=3.12.3
```

Notes:
- `APP_TOKEN_SECRET` should be a long random string.
- `CORS_ORIGINS` accepts comma-separated values.
- After first deploy, copy your Render backend URL (example: `https://<backend-name>.onrender.com`).

## 3) Deploy Frontend on Vercel

1. Import the same repo in Vercel.
2. Configure:
- Root Directory: `frontend`
- Framework: Next.js (auto-detected)
- Build Command: `npm run build` (default)
- Install Command: `npm install` (default)

### Frontend Environment Variables (Vercel)

```env
NEXT_PUBLIC_API_BASE_URL=https://<backend-name>.onrender.com
NEXT_PUBLIC_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<SUPABASE_ANON_KEY>
```

Redeploy frontend after setting env vars.

## 4) Post-Deploy Verification Checklist

Run these checks in order:

1. Backend health:
- `GET https://<backend-name>.onrender.com/health` -> `{"ok": true}`

2. Discover endpoint:
- `GET https://<backend-name>.onrender.com/api/v1/rooms/discover?statuses=lobby,active` -> `200`

3. Frontend connectivity:
- Open Vercel app.
- Confirm homepage loads active/lobby rooms (or empty state without errors).

4. End-to-end:
- Sign in with Google.
- Complete Getting Started onboarding:
  - enter LeetCode username
  - if `LEETCODE_VERIFICATION_MODE=soft`: confirm profile + click Verify
  - if `LEETCODE_VERIFICATION_MODE=strict`: submit accepted Fizz Buzz + click Verify
- Create room from frontend.
- Join from second browser/incognito.
- Wait for scheduled auto-start (or set near-future time in test).
- Confirm leaderboard updates.

## 5) Common Issues and Fixes

### Error: `column rooms.problem_source does not exist`

Cause: backend code updated but DB migration not applied.

Fix:
```bash
cd backend
alembic upgrade head
```

### Error: `'random' is not among the defined enum values`

Cause: older backend image/model code + newer DB values mismatch.

Fix:
1. Deploy latest backend code.
2. Ensure migrations are at head (`20260321_0003`).
3. Restart backend service.

### Crash on startup with Python 3.14 stack trace (`typing.Union` / SQLAlchemy declarative scan)

Cause: Render defaulted to Python 3.14, while this backend is validated on Python 3.12.

Fix:
1. Set Render env var `PYTHON_VERSION=3.12.3`.
2. Keep `backend/.python-version` in repo as `3.12.3`.
3. Clear build cache and redeploy.

### Error: CORS blocked in browser

Cause: missing or incorrect `CORS_ORIGINS`.

Fix:
- Add exact Vercel URL to `CORS_ORIGINS`.
- If using preview deployments, include each required domain or keep production-only for stability.

### `ERR_CONNECTION_REFUSED` from frontend to backend

Cause: frontend still points to localhost.

Fix:
- Set `NEXT_PUBLIC_API_BASE_URL` in Vercel to Render URL.
- Redeploy frontend.

## 6) Zero-Downtime Deployment Routine

For every backend release:
1. Push code.
2. Render runs `alembic upgrade head` as pre-deploy.
3. Render starts new app instance.
4. Verify `/health` and `/api/v1/rooms/discover`.
5. If backend URL unchanged, frontend usually does not need redeploy unless UI code changed.
