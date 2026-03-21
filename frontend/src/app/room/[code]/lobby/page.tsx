"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ApiError, getRoomState, startRoom } from "@/lib/api";
import { getRoomToken } from "@/lib/tokens";
import type { ProblemSource, RoomStateResponse } from "@/lib/types";
import { prettyDateTime } from "@/lib/format";
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

export default function LobbyPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomCode = (params.code || "").toUpperCase();

  const [token, setToken] = useState<string | null>(null);
  const [state, setState] = useState<RoomStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(getRoomToken(roomCode));
  }, [roomCode]);

  const fetchState = useCallback(async () => {
    if (!roomCode || !token) return;

    try {
      const response = await getRoomState(roomCode, token);
      setState(response);
      setError(null);

      if (response.room.status === "active") {
        router.replace(`/room/${roomCode}`);
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

  const me = useMemo(
    () => state?.participants.find((participant) => participant.id === state.my_participant_id),
    [state],
  );
  const isHost = Boolean(me?.is_host);

  async function handleStart() {
    if (!token) return;

    try {
      setStarting(true);
      await startRoom(roomCode, token);
      await fetchState();
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setStarting(false);
    }
  }

  if (!token) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-6 text-amber-100">
          You are not joined in this room on this browser. Return to{" "}
          <Link href="/" className="font-semibold underline">
            home page
          </Link>{" "}
          and join with room code.
        </div>
      </main>
    );
  }

  if (loading && !state) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 text-slate-200">
          Loading lobby...
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl space-y-6 px-4 py-8 md:px-8">
      <header className="rounded-2xl border border-cyan-300/20 bg-slate-900/65 p-6 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-wide text-cyan-200">Room Lobby</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
              Room {roomCode}
            </h1>
          </div>
          <Link
            href="/"
            className="rounded-lg border border-slate-500/60 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            Back Home
          </Link>
        </div>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Participants" subtitle="Everyone joins with nickname + LeetCode username.">
          <table className="table-grid">
            <thead>
              <tr>
                <th>#</th>
                <th>Participant</th>
                <th>Role</th>
              </tr>
            </thead>
            <tbody>
              {state?.participants.map((participant, idx) => (
                <tr key={participant.id}>
                  <td>{idx + 1}</td>
                  <td>
                    <div className="flex items-center gap-2">
                      <AvatarBadge
                        name={participant.nickname}
                        avatarUrl={participant.avatar_url}
                        size="sm"
                      />
                      <div>
                        <span className="font-medium text-slate-100">{participant.nickname}</span>
                        {participant.id === state.my_participant_id ? (
                          <span className="ml-2 rounded bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-200">
                            You
                          </span>
                        ) : null}
                        <p className="font-mono text-xs text-slate-400">
                          @{participant.leetcode_username}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td>{participant.is_host ? "Host" : "Player"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        <SectionCard title="Room Settings" subtitle="These are locked once host starts the challenge.">
          <div className="space-y-3 text-sm text-slate-200">
            <div className="flex items-center justify-between rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
              <span>Problems</span>
              <span className="font-semibold text-cyan-200">
                {state?.room.problem_count ?? "-"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
              <span>Difficulty Mix</span>
              <span className="font-semibold text-cyan-200">
                E{state?.room.easy_count ?? 0} / M{state?.room.medium_count ?? 0} / H
                {state?.room.hard_count ?? 0}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
              <span>Timer</span>
              <span className="font-semibold text-cyan-200">
                {state?.room.duration_minutes ?? "-"} minutes
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
              <span>Passcode</span>
              <span className="font-semibold text-cyan-200">
                {state?.room.has_passcode ? "Protected" : "Open"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
              <span>Source</span>
              <span className="font-semibold text-cyan-200">
                {state?.room.problem_source
                  ? formatProblemSource(state.room.problem_source)
                  : "-"}
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
              <span>Created</span>
              <span className="font-semibold text-cyan-200">
                {prettyDateTime(state?.room.created_at ?? null)}
              </span>
            </div>
          </div>

          <div className="mt-5">
            {isHost ? (
              <button
                onClick={handleStart}
                disabled={starting}
                className="w-full rounded-xl bg-emerald-400 px-4 py-2 font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {starting ? "Starting..." : "Start Challenge"}
              </button>
            ) : (
              <div className="rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-100">
                Waiting for host to start the challenge.
              </div>
            )}
          </div>
        </SectionCard>
      </section>
    </main>
  );
}
