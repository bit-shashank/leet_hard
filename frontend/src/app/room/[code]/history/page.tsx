"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { AvatarBadge } from "@/components/avatar-badge";
import { PageLoader, SkeletonBlock, SkeletonRow, SkeletonText } from "@/components/loading";
import { SectionCard } from "@/components/section-card";
import { ShareCopyButton } from "@/components/share-copy-button";
import { ApiError, getRoomHistory, getRoomState, getRoomTopics } from "@/lib/api";
import { prettyDateTime } from "@/lib/format";
import { requiresOnboarding } from "@/lib/onboarding";
import { formatProblemSource } from "@/lib/problem-source";
import { copyRoomShareMessage } from "@/lib/share-room";
import type { HistoryResponse, TopicInfo } from "@/lib/types";

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Could not load room history.";
}

function RoomHistoryLoadingSkeleton() {
  return (
    <PageLoader title="Loading history..." subtitle="Gathering final standings and event timeline.">
      <div className="space-y-4">
        <SkeletonBlock className="h-20 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-[1.05fr_0.95fr]">
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <SkeletonText lines={2} />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <SkeletonRow key={`history-leaderboard-skeleton-${index}`} columns={4} />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <SkeletonText lines={2} />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <SkeletonBlock key={`history-event-skeleton-${index}`} className="h-12 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageLoader>
  );
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
  const [topics, setTopics] = useState<TopicInfo[]>([]);
  const [topicsError, setTopicsError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !me) return;
    if (requiresOnboarding(me)) {
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

  useEffect(() => {
    let mounted = true;
    async function loadTopics() {
      try {
        const response = await getRoomTopics();
        if (!mounted) return;
        setTopics(response);
        setTopicsError(null);
      } catch (err) {
        if (!mounted) return;
        const message = err instanceof ApiError ? err.message : "Topics unavailable right now.";
        setTopics([]);
        setTopicsError(message);
      }
    }

    void loadTopics();
    return () => {
      mounted = false;
    };
  }, []);

  const winner = useMemo(() => history?.leaderboard[0] ?? null, [history?.leaderboard]);
  const topicNameBySlug = useMemo(
    () => new Map(topics.map((topic) => [topic.slug, topic.name])),
    [topics],
  );
  const roomTopicNames = useMemo(
    () =>
      (history?.room.topic_slugs || []).map((slug) => topicNameBySlug.get(slug) || slug),
    [history?.room.topic_slugs, topicNameBySlug],
  );

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
    return <PageLoader title="Checking session..." subtitle="Verifying your account access." />;
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
    return <RoomHistoryLoadingSkeleton />;
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
          <p className="mt-1 text-xs text-emerald-200/90">
            Exclude pre-solved: {history?.room.exclude_pre_solved ? "On" : "Off"}
          </p>
          {roomTopicNames.length ? (
            <p className="mt-1 text-xs text-emerald-200/90">
              Topics: {roomTopicNames.join(" • ")}
            </p>
          ) : topicsError ? (
            <p className="mt-1 text-xs text-emerald-200/70">{topicsError}</p>
          ) : null}
        </section>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <section className="grid gap-6 lg:h-[36rem] lg:grid-cols-[1.05fr_0.95fr]">
        <SectionCard
          title="Final Leaderboard"
          subtitle="Saved for future reference."
          className="lg:flex lg:h-full lg:min-h-0 lg:flex-col"
          contentClassName="site-scrollbar lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        >
          <div className="space-y-3 sm:hidden">
            {history?.leaderboard.map((entry) => (
              <article
                key={entry.participant_id}
                className="rounded-lg border border-slate-700/60 bg-slate-950/45 px-3 py-2 text-sm"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <AvatarBadge
                      name={entry.leetcode_username}
                      avatarUrl={entry.avatar_url}
                      size="sm"
                    />
                    <div className="min-w-0">
                      <p className="truncate font-mono font-medium text-slate-100">
                        @{entry.leetcode_username}
                      </p>
                      <p className="text-xs text-slate-400">
                        Rank #{entry.rank} · {entry.solved_count} solved
                      </p>
                    </div>
                  </div>
                  <span className="text-xs text-slate-400">
                    {prettyDateTime(entry.last_solved_at)}
                  </span>
                </div>
              </article>
            ))}
          </div>

          <div className="hidden sm:block">
            <table className="table-grid w-full">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Participant</th>
                  <th>Solved</th>
                  <th className="hidden sm:table-cell">Last Solve</th>
                </tr>
              </thead>
              <tbody>
                {history?.leaderboard.map((entry) => (
                  <tr key={entry.participant_id}>
                    <td className="font-semibold text-cyan-200">#{entry.rank}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <AvatarBadge name={entry.leetcode_username} avatarUrl={entry.avatar_url} size="sm" />
                        <div className="min-w-0">
                          <span className="truncate font-mono font-medium text-slate-100">
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
          </div>
        </SectionCard>

        <SectionCard
          title="Solve Timeline"
          subtitle="All auto/manual solve events in chronological order."
          className="lg:flex lg:h-full lg:min-h-0 lg:flex-col"
          contentClassName="min-w-0 lg:min-h-0 lg:flex-1"
        >
          <div className="site-scrollbar space-y-3 overflow-x-hidden lg:h-full lg:overflow-y-auto lg:pr-1">
            {history?.events.length ? (
              history.events.map((event, idx) => (
                <div
                  key={`${event.participant_id}-${event.problem_slug}-${event.event_at}-${idx}`}
                  className="rounded-lg border border-slate-700/60 bg-slate-950/45 px-3 py-2 text-sm"
                >
                  <p className="text-slate-100 break-words">
                    <span className="font-semibold text-cyan-200">
                      @{event.participant_leetcode_username}
                    </span>{" "}
                    <span className="font-mono text-slate-300 break-all">{event.problem_slug}</span>
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

      <SectionCard title="Problem Set" subtitle="Questions assigned in this completed room.">
        <div className="space-y-3">
          {history?.problems.length ? (
            history.problems.map((problem, index) => (
              <article
                key={`${problem.title_slug}-${problem.sort_order}`}
                className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-cyan-200">
                      #{problem.sort_order || index + 1} · {problem.difficulty}
                    </p>
                    <h3 className="text-lg font-semibold text-slate-100">{problem.title}</h3>
                    <p className="mt-1 font-mono text-xs text-slate-400">{problem.title_slug}</p>
                  </div>

                  <a
                    href={problem.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg border border-cyan-300/30 px-3 py-2 text-sm text-cyan-200 transition hover:bg-cyan-500/10"
                  >
                    Open Problem
                  </a>
                </div>
              </article>
            ))
          ) : (
            <p className="text-sm text-slate-300">No problems were recorded for this room.</p>
          )}
        </div>
      </SectionCard>
    </main>
  );
}
