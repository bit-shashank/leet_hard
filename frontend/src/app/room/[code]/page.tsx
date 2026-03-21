"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, getRoomState, toggleManualSolve } from "@/lib/api";
import { formatCountdown, prettyDateTime } from "@/lib/format";
import { getRoomToken } from "@/lib/tokens";
import type { ProblemPublic, ProblemSource, RoomStateResponse } from "@/lib/types";
import { SectionCard } from "@/components/section-card";
import { AvatarBadge } from "@/components/avatar-badge";

const POLL_INTERVAL_MS = 5000;

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Unable to load room state.";
}

function formatProblemSource(source: ProblemSource) {
  const labels: Record<ProblemSource, string> = {
    random: "Random",
    neetcode_150: "NeetCode 150",
    neetcode_250: "NeetCode 250",
    blind_75: "Blind 75",
    striver_sde_sheet: "Striver SDE Sheet",
  };
  return labels[source];
}

export default function ActiveRoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomCode = (params.code || "").toUpperCase();

  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<RoomStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);

  useEffect(() => {
    setToken(getRoomToken(roomCode));
  }, [roomCode]);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const fetchState = useCallback(async () => {
    if (!token || !roomCode) return;

    try {
      const response = await getRoomState(roomCode, token);
      setState(response);
      setServerOffsetMs(new Date(response.server_time).getTime() - Date.now());
      setError(null);

      if (response.room.status === "lobby") {
        router.replace(`/room/${roomCode}/lobby`);
        return;
      }
      if (response.room.status === "ended") {
        router.replace(`/room/${roomCode}/history`);
      }
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  }, [roomCode, router, token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }

    void fetchState();
    const timer = setInterval(() => {
      void fetchState();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [fetchState, token]);

  const solvedSet = useMemo(() => new Set(state?.my_solved_slugs ?? []), [state?.my_solved_slugs]);

  const countdown = useMemo(() => {
    if (!state?.room.ends_at) return "00:00:00";
    const virtualServerNow = new Date(nowMs + serverOffsetMs).toISOString();
    return formatCountdown(state.room.ends_at, virtualServerNow);
  }, [nowMs, serverOffsetMs, state?.room.ends_at]);

  async function handleToggle(problem: ProblemPublic) {
    if (!token || !state) return;

    const isSolved = solvedSet.has(problem.title_slug);

    try {
      setPendingSlug(problem.title_slug);
      await toggleManualSolve(roomCode, token, {
        problem_slug: problem.title_slug,
        solved: !isSolved,
      });
      await fetchState();
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setPendingSlug(null);
    }
  }

  if (!token) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-6 text-amber-100">
          Missing participant token for this room. Go back to{" "}
          <Link href="/" className="font-semibold underline">
            home page
          </Link>{" "}
          and join again.
        </div>
      </main>
    );
  }

  if (loading && !state) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 text-slate-200">
          Loading challenge...
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-6 px-4 py-8 md:px-8">
      <header className="rounded-2xl border border-cyan-300/20 bg-slate-900/65 p-6 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-wide text-cyan-200">Challenge Live</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
              Room {roomCode}
            </h1>
          </div>

          <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-2 text-center">
            <p className="text-xs uppercase tracking-wide text-emerald-200">Time Left</p>
            <p className="font-mono text-2xl font-semibold text-emerald-100">{countdown}</p>
          </div>
        </div>
        <p className="mt-2 text-xs text-cyan-200/90">
          Source:{" "}
          {state?.room.problem_source
            ? formatProblemSource(state.room.problem_source)
            : "Random"}
        </p>
      </header>

      {state?.room.sync_warning ? (
        <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {state.room.sync_warning}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <section className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <SectionCard
          title="Problem Set"
          subtitle="Randomized non-paid problems assigned to everyone in the room."
        >
          <div className="space-y-3">
            {state?.problems.map((problem) => {
              const isSolved = solvedSet.has(problem.title_slug);
              return (
                <article
                  key={problem.title_slug}
                  className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-wide text-cyan-200">
                        #{problem.frontend_id || "?"} · {problem.difficulty}
                      </p>
                      <h3 className="text-lg font-semibold text-slate-100">
                        {problem.title}
                      </h3>
                      <p className="mt-1 font-mono text-xs text-slate-400">
                        {problem.title_slug}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={problem.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-cyan-300/30 px-3 py-2 text-sm text-cyan-200 transition hover:bg-cyan-500/10"
                      >
                        Open Problem
                      </a>
                      <button
                        onClick={() => void handleToggle(problem)}
                        disabled={pendingSlug === problem.title_slug}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-60 ${
                          isSolved
                            ? "bg-emerald-400 text-slate-900 hover:bg-emerald-300"
                            : "bg-slate-700 text-slate-100 hover:bg-slate-600"
                        }`}
                      >
                        {pendingSlug === problem.title_slug
                          ? "Saving..."
                          : isSolved
                            ? "Solved"
                            : "Mark Solved"}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </SectionCard>

        <SectionCard
          title="Leaderboard"
          subtitle="Ranked by solved count, tie-broken by earlier last solve time."
        >
          <table className="table-grid">
            <thead>
              <tr>
                <th>Rank</th>
                <th>Participant</th>
                <th>Solved</th>
                <th>Last Solve</th>
              </tr>
            </thead>
            <tbody>
              {state?.leaderboard.map((entry) => (
                <tr key={entry.participant_id}>
                  <td className="font-semibold text-cyan-200">#{entry.rank}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <AvatarBadge
                        name={entry.nickname}
                        avatarUrl={entry.avatar_url}
                        size="sm"
                      />
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-slate-100">{entry.nickname}</span>
                          {entry.is_host ? (
                            <span className="rounded bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-200">
                              Host
                            </span>
                          ) : null}
                          {state.my_participant_id === entry.participant_id ? (
                            <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-200">
                              You
                            </span>
                          ) : null}
                        </div>
                        <p className="font-mono text-xs text-slate-400">@{entry.leetcode_username}</p>
                      </div>
                    </div>
                  </td>
                  <td className="font-semibold text-emerald-200">{entry.solved_count}</td>
                  <td className="text-xs text-slate-300">
                    {prettyDateTime(entry.last_solved_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      </section>
    </main>
  );
}
