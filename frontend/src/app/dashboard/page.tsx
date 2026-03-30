"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { AvatarBadge } from "@/components/avatar-badge";
import { InlineSpinner, PageLoader, SkeletonBlock, SkeletonText } from "@/components/loading";
import { ApiError, deleteMe, getDashboard, getMySubmissions, updateMe } from "@/lib/api";
import { saveFlashNotice } from "@/lib/auth-intent";
import { prettyDateTime } from "@/lib/format";
import { requiresOnboarding } from "@/lib/onboarding";
import type { DashboardResponse, RecentAcceptedSubmission } from "@/lib/types";

type RecentRoomsTab = "active" | "lobby" | "ended";

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Unable to load dashboard data.";
}

function parseSubmissionError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Unable to load room submissions.";
}

function formatSubmissionTime(value: string) {
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return value;

  const now = new Date();
  const diffMs = now.getTime() - target.getTime();
  if (diffMs < 0) {
    const minutesAhead = Math.ceil(Math.abs(diffMs) / 60000);
    if (minutesAhead <= 60) return "Just now";
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(target);
  }

  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const dayDiff = Math.round((nowDay.getTime() - targetDay.getTime()) / 86400000);

  if (dayDiff <= 0) {
    const hours = Math.max(1, Math.floor(diffMs / 3600000));
    return `${hours}h ago`;
  }

  if (dayDiff === 1) {
    return "Yesterday";
  }

  if (dayDiff >= 365) {
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, "0");
    const day = String(target.getDate()).padStart(2, "0");
    return `${year}.${month}.${day}`;
  }

  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(target);
}

function roomHref(roomCode: string, status: "lobby" | "active" | "ended") {
  const normalized = roomCode.toUpperCase();
  if (status === "active") return `/room/${normalized}`;
  if (status === "ended") return `/room/${normalized}/history`;
  return `/room/${normalized}/lobby`;
}

function relativeTimeText(value: string | null) {
  if (!value) return "soon";
  const target = new Date(value);
  if (Number.isNaN(target.getTime())) return prettyDateTime(value);
  const diffMs = target.getTime() - Date.now();
  const absMinutes = Math.max(1, Math.round(Math.abs(diffMs) / 60000));
  if (absMinutes < 60) {
    return diffMs >= 0 ? `in ${absMinutes}m` : `${absMinutes}m ago`;
  }
  const absHours = Math.round(absMinutes / 60);
  if (absHours < 24) {
    return diffMs >= 0 ? `in ${absHours}h` : `${absHours}h ago`;
  }
  const absDays = Math.round(absHours / 24);
  return diffMs >= 0 ? `in ${absDays}d` : `${absDays}d ago`;
}

function roomStatusClass(status: RecentRoomsTab) {
  if (status === "active") {
    return "border-emerald-300/40 bg-emerald-500/15 text-emerald-100";
  }
  if (status === "lobby") {
    return "border-cyan-300/40 bg-cyan-500/15 text-cyan-100";
  }
  return "border-slate-500/40 bg-slate-600/20 text-slate-200";
}

function StatsSkeleton() {
  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={`stat-skeleton-${index}`} className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
          <SkeletonBlock className="h-3 w-2/3" />
          <SkeletonBlock className="mt-2 h-8 w-1/2" />
        </div>
      ))}
      <div className="col-span-2 rounded-xl border border-slate-700/60 bg-slate-950/40 p-3">
        <SkeletonBlock className="h-3 w-1/3" />
        <SkeletonBlock className="mt-2 h-8 w-1/4" />
      </div>
    </div>
  );
}

function RecentRoomSkeleton() {
  return (
    <article className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <SkeletonBlock className="h-5 w-3/5" />
          <SkeletonBlock className="mt-2 h-3 w-20" />
        </div>
        <SkeletonBlock className="h-5 w-16 rounded-full" />
      </div>
      <SkeletonText className="mt-3" lines={2} />
      <SkeletonBlock className="mt-4 h-8 w-24 rounded-lg" />
    </article>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const { accessToken, authLoading, me, refreshMe, signOut, user } = useAuth();

  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [submissionsLoading, setSubmissionsLoading] = useState(true);
  const [recentSubmissions, setRecentSubmissions] = useState<RecentAcceptedSubmission[]>([]);
  const [submissionView, setSubmissionView] = useState<"recent" | "all">("recent");
  const [allSubmissionsLoading, setAllSubmissionsLoading] = useState(false);
  const [allSubmissionsError, setAllSubmissionsError] = useState<string | null>(null);
  const [allSubmissions, setAllSubmissions] = useState<RecentAcceptedSubmission[] | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [primaryLeet, setPrimaryLeet] = useState("");
  const [recentTab, setRecentTab] = useState<RecentRoomsTab>("active");

  const recentRoomsByStatus = useMemo(() => {
    const recentRooms = dashboard?.recent_rooms || [];
    return {
      active: recentRooms.filter((room) => room.status === "active"),
      lobby: recentRooms.filter((room) => room.status === "lobby"),
      ended: recentRooms.filter((room) => room.status === "ended"),
    };
  }, [dashboard?.recent_rooms]);
  const recentTabCounts = useMemo(
    () => ({
      active: recentRoomsByStatus.active.length,
      lobby: recentRoomsByStatus.lobby.length,
      ended: recentRoomsByStatus.ended.length,
    }),
    [recentRoomsByStatus.active.length, recentRoomsByStatus.ended.length, recentRoomsByStatus.lobby.length],
  );
  const visibleRecentRooms = recentRoomsByStatus[recentTab];
  const hasAnyRecentRoom =
    recentTabCounts.active + recentTabCounts.lobby + recentTabCounts.ended > 0;

  useEffect(() => {
    setDisplayName(me?.display_name || "");
    setPrimaryLeet(me?.primary_leetcode_username || "");
  }, [me?.display_name, me?.primary_leetcode_username]);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !me) return;
    if (requiresOnboarding(me)) {
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

  useEffect(() => {
    const token = accessToken;
    if (!token) {
      setRecentSubmissions([]);
      setSubmissionError(null);
      setSubmissionsLoading(false);
      setSubmissionView("recent");
      setAllSubmissions(null);
      setAllSubmissionsError(null);
      setAllSubmissionsLoading(false);
      return;
    }

    let cancelled = false;
    async function loadSubmissions() {
      setSubmissionsLoading(true);
      try {
        const response = await getMySubmissions(token, { limit: 20 });
        if (cancelled) return;
        setRecentSubmissions(response);
        setSubmissionError(null);
      } catch (err) {
        if (cancelled) return;
        setRecentSubmissions([]);
        setSubmissionError(parseSubmissionError(err));
      } finally {
        if (!cancelled) setSubmissionsLoading(false);
      }
    }

    void loadSubmissions();
    return () => {
      cancelled = true;
    };
  }, [accessToken]);

  async function handleToggleSubmissionView() {
    const token = accessToken;
    if (!token) return;
    if (submissionView === "all") {
      setSubmissionView("recent");
      return;
    }

    setSubmissionView("all");
    if (allSubmissions) return;

    setAllSubmissionsLoading(true);
    setAllSubmissionsError(null);
    try {
      const response = await getMySubmissions(token, { limit: 100 });
      setAllSubmissions(response);
    } catch (err) {
      setAllSubmissions([]);
      setAllSubmissionsError(parseSubmissionError(err));
    } finally {
      setAllSubmissionsLoading(false);
    }
  }

  useEffect(() => {
    if (recentTabCounts.active > 0) {
      setRecentTab("active");
      return;
    }
    if (recentTabCounts.lobby > 0) {
      setRecentTab("lobby");
      return;
    }
    if (recentTabCounts.ended > 0) {
      setRecentTab("ended");
      return;
    }
    setRecentTab("active");
  }, [recentTabCounts.active, recentTabCounts.ended, recentTabCounts.lobby]);

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

  async function handleDeleteProfile() {
    if (!accessToken || deleting) return;
    const confirmed = window.confirm(
      "Delete your profile? This will remove your app profile data and sign you out. This action cannot be undone.",
    );
    if (!confirmed) return;

    setDeleting(true);
    setProfileError(null);
    try {
      await deleteMe(accessToken);
      try {
        await signOut();
      } catch {
        // fallback to redirect even if sign-out request fails
      }
      saveFlashNotice("Your profile was deleted successfully.");
      router.replace("/");
    } catch (err) {
      setProfileError(parseApiError(err));
    } finally {
      setDeleting(false);
    }
  }

  if (authLoading) {
    return <PageLoader title="Checking session..." subtitle="Loading your dashboard context." />;
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
              {saving ? (
                <span className="inline-flex items-center gap-2">
                  <InlineSpinner className="h-4 w-4" label="Saving profile" />
                  Saving...
                </span>
              ) : (
                "Save Profile"
              )}
            </button>

            <button
              type="button"
              onClick={() => void handleDeleteProfile()}
              disabled={deleting}
              className="ml-2 rounded-xl border border-rose-300/40 bg-rose-500/10 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? (
                <span className="inline-flex items-center gap-2">
                  <InlineSpinner className="h-4 w-4" label="Deleting profile" />
                  Deleting...
                </span>
              ) : (
                "Delete Profile"
              )}
            </button>
          </form>

        </article>

        <article className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
          <h2 className="text-xl font-semibold text-slate-100">Core Stats</h2>
          {loading ? (
            <StatsSkeleton />
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-slate-100">Recent Room Submissions</h2>
          <button
            type="button"
            onClick={() => void handleToggleSubmissionView()}
            className="rounded-lg border border-slate-500/60 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            {submissionView === "all" ? "Show Recent 20" : "View All Room Submissions"}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          {submissionView === "all" ? "Showing up to 100 room submissions" : "Showing latest 20 room submissions"}
        </p>
        {submissionView === "recent" && submissionsLoading ? (
          <div className="mt-3 space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <SkeletonBlock key={`submission-skeleton-${index}`} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : submissionView === "all" && allSubmissionsLoading ? (
          <div className="mt-3 space-y-2">
            {Array.from({ length: 3 }).map((_, index) => (
              <SkeletonBlock key={`submission-all-skeleton-${index}`} className="h-9 w-full rounded-lg" />
            ))}
          </div>
        ) : (submissionView === "recent" ? submissionError : allSubmissionsError) ? (
          <div className="mt-3 rounded-lg border border-rose-300/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
            {submissionView === "recent" ? submissionError : allSubmissionsError}
          </div>
        ) : (submissionView === "recent" ? recentSubmissions : allSubmissions ?? []).length ? (
          <div className="site-scrollbar mt-4 max-h-[34rem] space-y-2 overflow-y-auto pr-1">
            {(submissionView === "recent" ? recentSubmissions : allSubmissions ?? []).map((submission, index) => (
              <article
                key={`${submission.problem_slug}-${submission.submitted_at}-${submission.submission_url ?? submission.problem_url}-${index}`}
                className="rounded-lg border border-slate-700/60 bg-slate-900/70 px-4 py-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[15px] font-medium text-slate-100">{submission.problem_title}</p>
                  <p className="text-xs text-slate-300">{formatSubmissionTime(submission.submitted_at)}</p>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <a
                    href={submission.problem_url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-cyan-300/30 px-2.5 py-1 text-xs font-semibold text-cyan-200 transition hover:bg-cyan-500/10"
                  >
                    Open Problem
                  </a>
                  {submission.submission_url ? (
                    <a
                      href={submission.submission_url}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-emerald-300/30 px-2.5 py-1 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/10"
                    >
                      Open Submission
                    </a>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-slate-300">No room submissions found yet.</p>
        )}
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
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            { key: "active" as const, label: "Active" },
            { key: "lobby" as const, label: "Upcoming" },
            { key: "ended" as const, label: "Ended" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setRecentTab(tab.key)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
                recentTab === tab.key
                  ? "border-cyan-300/50 bg-cyan-500/15 text-cyan-100"
                  : "border-slate-600/70 bg-slate-900/40 text-slate-300 hover:bg-slate-800"
              }`}
            >
              {tab.label} ({recentTabCounts[tab.key]})
            </button>
          ))}
        </div>
        {loading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <RecentRoomSkeleton key={`recent-room-skeleton-${index}`} />
            ))}
          </div>
        ) : visibleRecentRooms.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {visibleRecentRooms.map((room) => (
              <article
                key={`${room.room_code}-${room.joined_at}`}
                className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-100">{room.room_title}</h3>
                    <p className="mt-1 font-mono text-xs uppercase text-slate-400">{room.room_code}</p>
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-xs uppercase ${roomStatusClass(room.status)}`}
                  >
                    {room.status}
                  </span>
                </div>
                <div className="mt-3 space-y-1 text-xs text-slate-300">
                  {recentTab === "active" ? (
                    <p>
                      {room.ends_at
                        ? `Live now · ends ${relativeTimeText(room.ends_at)}`
                        : room.starts_at
                          ? `Live now · started ${relativeTimeText(room.starts_at)}`
                          : "Live now"}
                    </p>
                  ) : null}
                  {recentTab === "lobby" ? (
                    <p>
                      {room.starts_at
                        ? `Starts ${relativeTimeText(room.starts_at)}`
                        : "Upcoming · waiting for host to start"}
                    </p>
                  ) : null}
                  {recentTab === "ended" ? (
                    <p>
                      Performance: {room.my_solved_count} solved
                      {room.my_rank ? ` · rank #${room.my_rank}` : ""}
                    </p>
                  ) : null}
                  <p>Joined: {prettyDateTime(room.joined_at)}</p>
                </div>
                <Link
                  href={roomHref(room.room_code, room.status)}
                  className="mt-4 inline-flex rounded-lg bg-emerald-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300"
                >
                  Open Room
                </Link>
              </article>
            ))}
          </div>
        ) : hasAnyRecentRoom ? (
          <p className="text-sm text-slate-300">
            No{" "}
            {recentTab === "active"
              ? "active"
              : recentTab === "lobby"
                ? "upcoming"
                : "ended"}{" "}
            rooms right now.
          </p>
        ) : (
          <p className="text-sm text-slate-300">No recent rooms yet.</p>
        )}
      </section>
    </main>
  );
}
