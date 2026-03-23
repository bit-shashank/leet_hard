"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { AvatarBadge } from "@/components/avatar-badge";
import { ApiError, getDashboard, updateMe } from "@/lib/api";
import { prettyDateTime } from "@/lib/format";
import type { DashboardResponse } from "@/lib/types";

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Unable to load dashboard data.";
}

function roomHref(roomCode: string, status: "lobby" | "active" | "ended") {
  const normalized = roomCode.toUpperCase();
  if (status === "active") return `/room/${normalized}`;
  if (status === "ended") return `/room/${normalized}/history`;
  return `/room/${normalized}/lobby`;
}

export default function DashboardPage() {
  const router = useRouter();
  const { accessToken, authLoading, me, refreshMe, user } = useAuth();

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [primaryLeet, setPrimaryLeet] = useState("");

  useEffect(() => {
    setDisplayName(me?.display_name || "");
    setPrimaryLeet(me?.primary_leetcode_username || "");
  }, [me?.display_name, me?.primary_leetcode_username]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !me) return;
    if (me.onboarding_required) {
      router.replace("/getting-started");
    }
  }, [authLoading, me, router, user]);

  const loadDashboard = useCallback(async () => {
    if (!accessToken) {
      setDashboard(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const response = await getDashboard(accessToken);
      setDashboard(response);
      setError(null);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  async function handleProfileSave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;

    setSaving(true);
    setProfileError(null);
    try {
      await updateMe(
        {
          display_name: displayName.trim() || null,
          primary_leetcode_username: primaryLeet.trim(),
        },
        accessToken,
      );
      await refreshMe();
    } catch (err) {
      setProfileError(parseApiError(err));
    } finally {
      setSaving(false);
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
          Please sign in to use dashboard. Return to{" "}
          <Link href="/" className="font-semibold underline">
            home page
          </Link>
          .
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl space-y-6 px-4 py-8 md:px-8">
      <header className="rounded-2xl border border-cyan-300/20 bg-slate-900/65 p-6 backdrop-blur">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Your Dashboard</h1>
        <p className="mt-2 text-sm text-slate-300">
          Track room performance and manage your LeetCode identity.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <article className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
          <h2 className="text-xl font-semibold text-slate-100">Profile</h2>
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
            <AvatarBadge name={me?.display_name || me?.email || "User"} avatarUrl={me?.avatar_url} size="lg" />
            <div className="text-sm">
              <p className="font-semibold text-slate-100">{me?.display_name || user.email}</p>
              <p className="text-slate-400">{me?.email || user.email}</p>
            </div>
          </div>

          {profileError ? (
            <div className="mt-3 rounded-lg border border-rose-300/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {profileError}
            </div>
          ) : null}

          <form className="mt-4 space-y-3" onSubmit={handleProfileSave}>
            <label className="block text-sm text-slate-200">
              Display name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
              />
            </label>
            <label className="block text-sm text-slate-200">
              Primary LeetCode username
              <input
                required
                value={primaryLeet}
                onChange={(e) => setPrimaryLeet(e.target.value)}
                disabled={Boolean(me?.leetcode_locked)}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
              />
              {me?.leetcode_locked ? (
                <p className="mt-1 text-xs text-slate-400">
                  Verified LeetCode ID is locked and cannot be changed from the app.
                </p>
              ) : null}
            </label>
            <button
              type="submit"
              disabled={saving}
              className="rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Profile"}
            </button>
          </form>
        </article>

        <article className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
          <h2 className="text-xl font-semibold text-slate-100">Core Stats</h2>
          {loading ? (
            <p className="mt-3 text-sm text-slate-300">Loading stats...</p>
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Rooms Created</p>
                <p className="mt-1 text-2xl font-semibold text-slate-100">{dashboard?.rooms_created ?? 0}</p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Rooms Joined</p>
                <p className="mt-1 text-2xl font-semibold text-slate-100">{dashboard?.rooms_joined ?? 0}</p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Wins</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-200">{dashboard?.wins ?? 0}</p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Total Solves</p>
                <p className="mt-1 text-2xl font-semibold text-cyan-200">{dashboard?.total_solves ?? 0}</p>
              </div>
              <div className="col-span-2 rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
                <p className="text-xs uppercase tracking-wide text-slate-400">Average Rank</p>
                <p className="mt-1 text-2xl font-semibold text-slate-100">
                  {dashboard?.avg_rank != null ? dashboard.avg_rank : "-"}
                </p>
              </div>
            </div>
          )}
        </article>
      </section>

      <section className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-100">Recent Rooms</h2>
          <button
            type="button"
            onClick={() => void loadDashboard()}
            className="rounded-lg border border-slate-500/60 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>
        {loading ? (
          <p className="text-sm text-slate-300">Loading rooms...</p>
        ) : dashboard?.recent_rooms.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {dashboard.recent_rooms.map((room) => (
              <article
                key={`${room.room_code}-${room.joined_at}`}
                className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">{room.room_title}</h3>
                    <p className="mt-1 font-mono text-xs uppercase text-slate-400">{room.room_code}</p>
                  </div>
                  <span className="rounded-full border border-slate-500/60 bg-slate-800/60 px-2 py-0.5 text-xs uppercase text-slate-200">
                    {room.status}
                  </span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-300">
                  <p>Joined: {prettyDateTime(room.joined_at)}</p>
                  <p>
                    Performance: {room.my_solved_count} solved
                    {room.my_rank ? ` · rank #${room.my_rank}` : ""}
                  </p>
                </div>
                <Link
                  href={roomHref(room.room_code, room.status)}
                  className="mt-4 inline-flex rounded-lg bg-cyan-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300"
                >
                  Open Room
                </Link>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-300">No recent rooms yet.</p>
        )}
      </section>
    </main>
  );
}
