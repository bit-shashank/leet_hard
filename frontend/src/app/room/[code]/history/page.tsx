"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { AvatarBadge } from "@/components/avatar-badge";
import { SectionCard } from "@/components/section-card";
import { ShareCopyButton } from "@/components/share-copy-button";
import { ApiError, getRoomHistory, getRoomState } from "@/lib/api";
import { prettyDateTime } from "@/lib/format";
import { formatProblemSource } from "@/lib/problem-source";
import { copyRoomShareMessage } from "@/lib/share-room";
import type { HistoryResponse } from "@/lib/types";

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Could not load room history.";
}

export default function RoomHistoryPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomCode = (params.code || "").toUpperCase();
  const { accessToken, authLoading, me, profileLoading, user } = useAuth();

  const [history, setHistory] = useState<HistoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !me) return;
    if (me.onboarding_required) {
      router.replace("/getting-started");
    }
  }, [authLoading, me, profileLoading, router, user]);

  useEffect(() => {
    if (!accessToken) {
      setLoading(false);
      return;
    }
    const token = accessToken;

    async function loadHistory() {
      try {
        const response = await getRoomHistory(roomCode, token);
        setHistory(response);
        setError(null);
      } catch (err) {
        const maybeApi = err as ApiError;
        if (maybeApi?.status === 400) {
          try {
            const roomState = await getRoomState(roomCode, token);
            if (roomState.room.status === "active") {
              router.replace(`/room/${roomCode}`);
              return;
            }
            if (roomState.room.status === "lobby") {
              router.replace(`/room/${roomCode}/lobby`);
              return;
            }
          } catch {
            // fallback to normal error display
          }
        }
        setError(parseApiError(err));
      } finally {
        setLoading(false);
      }
    }

    void loadHistory();
  }, [accessToken, roomCode, router]);

  const winner = useMemo(() => history?.leaderboard[0] ?? null, [history?.leaderboard]);

  async function handleShareRoom() {
    if (!history?.room) return;

    setShareCopied(false);
    try {
      await copyRoomShareMessage({
        roomCode,
        roomTitle: history.room.room_title,
        status: history.room.status,
        scheduledStartAt: history.room.scheduled_start_at,
        startsAt: history.room.starts_at,
        endsAt: history.room.ends_at,
        durationMinutes: history.room.duration_minutes,
        easyCount: history.room.easy_count,
        mediumCount: history.room.medium_count,
        hardCount: history.room.hard_count,
        problemSource: history.room.problem_source,
        strictCheck: history.room.strict_check,
        hasPasscode: history.room.has_passcode,
      });
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 1600);
    } catch {
      setError("Could not copy invite. Please try again.");
    }
  }

  if (authLoading) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 text-slate-200">
          Checking session...
        </div>
      </main>
    );
  }

  if (!user || !accessToken) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-6 text-amber-100">
          Please sign in to access room history. Return to{" "}
          <Link href="/" className="font-semibold underline">
            home page
          </Link>
          .
        </div>
      </main>
    );
  }

  if (loading && !history) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 text-slate-200">
          Loading history...
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl space-y-6 px-4 py-8 md:px-8">
      <header className="rounded-2xl border border-cyan-300/20 bg-slate-900/65 p-6 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-wide text-cyan-200">Final Results</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
              {history?.room.room_title}
            </h1>
            <p className="mt-1 font-mono text-xs uppercase tracking-wide text-slate-300">
              {roomCode}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/room/${roomCode}`}
              className="rounded-lg border border-slate-500/60 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
            >
              Live View
            </Link>
            <Link
              href="/"
              className="rounded-lg border border-slate-500/60 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
            >
              Home
            </Link>
            <ShareCopyButton copied={shareCopied} onClick={() => void handleShareRoom()} />
          </div>
        </div>
      </header>

      {winner ? (
        <section className="rounded-2xl border border-emerald-300/30 bg-emerald-500/10 p-5">
          <p className="text-xs uppercase tracking-wide text-emerald-200">Winner</p>
          <div className="mt-2 flex items-center gap-3">
            <AvatarBadge name={winner.leetcode_username} avatarUrl={winner.avatar_url} size="lg" />
            <h2 className="text-2xl font-semibold text-emerald-100">
              @{winner.leetcode_username} ({winner.solved_count} solved)
            </h2>
          </div>
          <p className="mt-2 text-xs text-emerald-200/90">
            Source:{" "}
            {history?.room.problem_source ? formatProblemSource(history.room.problem_source) : "Random"}
          </p>
          <p className="mt-1 text-xs text-emerald-200/90">
            Strict checking: {history?.room.strict_check ? "On" : "Off"}
          </p>
        </section>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <SectionCard title="Final Leaderboard" subtitle="Saved for future reference.">
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
              {history?.leaderboard.map((entry) => (
                <tr key={entry.participant_id}>
                  <td className="font-semibold text-cyan-200">#{entry.rank}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <AvatarBadge name={entry.leetcode_username} avatarUrl={entry.avatar_url} size="sm" />
                      <div>
                        <span className="font-mono font-medium text-slate-100">
                          @{entry.leetcode_username}
                        </span>
                      </div>
                    </div>
                  </td>
                  <td className="font-semibold text-emerald-200">{entry.solved_count}</td>
                  <td className="text-xs text-slate-300">{prettyDateTime(entry.last_solved_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        <SectionCard title="Solve Timeline" subtitle="All auto/manual solve events in chronological order.">
          <div className="space-y-3">
            {history?.events.length ? (
              history.events.map((event, idx) => (
                <div
                  key={`${event.participant_id}-${event.problem_slug}-${event.event_at}-${idx}`}
                  className="rounded-lg border border-slate-700/60 bg-slate-950/45 px-3 py-2 text-sm"
                >
                  <p className="text-slate-100">
                    <span className="font-semibold text-cyan-200">
                      @{event.participant_leetcode_username}
                    </span>{" "}
                    <span className="font-mono text-slate-300">{event.problem_slug}</span>
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    {event.event_type} via {event.source} · {prettyDateTime(event.event_at)}
                  </p>
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-300">No solve events recorded in this room.</p>
            )}
          </div>
        </SectionCard>
      </section>
    </main>
  );
}
