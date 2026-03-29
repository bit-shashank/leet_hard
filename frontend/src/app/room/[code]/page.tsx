"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { AvatarBadge } from "@/components/avatar-badge";
import { InlineSpinner, PageLoader, SkeletonBlock, SkeletonRow, SkeletonText } from "@/components/loading";
import { SectionCard } from "@/components/section-card";
import { ShareCopyButton } from "@/components/share-copy-button";
import { ApiError, getRoomFeed, getRoomState, sendRoomMessage, toggleManualSolve } from "@/lib/api";
import { formatCountdown, prettyDateTime } from "@/lib/format";
import { requiresOnboarding } from "@/lib/onboarding";
import { formatProblemSource } from "@/lib/problem-source";
import { copyRoomShareMessage } from "@/lib/share-room";
import type { ProblemPublic, RoomFeedEvent, RoomStateResponse } from "@/lib/types";

const STATE_POLL_INTERVAL_MS = 5000;
const FEED_POLL_INTERVAL_MS = 4000;

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Unable to load room state.";
}

function parseFeedError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Unable to load live feed.";
}

function ActiveRoomLoadingSkeleton() {
  return (
    <PageLoader title="Loading challenge..." subtitle="Syncing room timer, problems, and leaderboard.">
      <div className="space-y-4">
        <SkeletonBlock className="h-24 w-full rounded-xl" />
        <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <SkeletonText lines={2} />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <SkeletonBlock key={`problem-skeleton-${index}`} className="h-20 w-full rounded-xl" />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <SkeletonText lines={2} />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <SkeletonRow key={`leaderboard-skeleton-${index}`} columns={4} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageLoader>
  );
}

export default function ActiveRoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomCode = (params.code || "").toUpperCase();
  const { accessToken, authLoading, me, profileLoading, user } = useAuth();

  const [state, setState] = useState<RoomStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const originalTitleRef = useRef<string | null>(null);
  const [feedItems, setFeedItems] = useState<RoomFeedEvent[]>([]);
  const [feedCursor, setFeedCursor] = useState<string | null>(null);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [chatMessage, setChatMessage] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const [rightPaneTab, setRightPaneTab] = useState<"feed" | "leaderboard">("feed");
  const feedCursorRef = useRef<string | null>(null);
  const feedContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (authLoading || profileLoading) return;
    if (!user || !me) return;
    if (requiresOnboarding(me)) {
      router.replace("/getting-started");
    }
  }, [authLoading, me, profileLoading, router, user]);

  const fetchState = useCallback(async () => {
    if (!accessToken || !roomCode) return;

    try {
      const response = await getRoomState(roomCode, accessToken);
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
  }, [accessToken, roomCode, router]);

  useEffect(() => {
    if (!accessToken) {
      setLoading(false);
      return;
    }

    void fetchState();
    const timer = setInterval(() => {
      void fetchState();
    }, STATE_POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [accessToken, fetchState]);

  const solvedSet = useMemo(() => new Set(state?.my_solved_slugs ?? []), [state?.my_solved_slugs]);
  const canManuallySolve = Boolean(state?.my_participant_id);

  useEffect(() => {
    feedCursorRef.current = feedCursor;
  }, [feedCursor]);

  const countdown = useMemo(() => {
    if (!state?.room.ends_at) return "00:00:00";
    const virtualServerNow = new Date(nowMs + serverOffsetMs).toISOString();
    return formatCountdown(state.room.ends_at, virtualServerNow);
  }, [nowMs, serverOffsetMs, state?.room.ends_at]);

  useEffect(() => {
    if (!state?.room) return;
    if (originalTitleRef.current === null) {
      originalTitleRef.current = document.title;
    }
    return () => {
      if (originalTitleRef.current !== null) {
        document.title = originalTitleRef.current;
      }
    };
  }, [state?.room]);

  useEffect(() => {
    if (!state?.room) return;
    const roomLabel = state.room.room_title || `Room ${roomCode}`;
    const label = countdown === "00:00:00" ? "Ending" : `${countdown} left`;
    document.title = `${label} · ${roomLabel}`;
  }, [countdown, roomCode, state?.room]);

  const appendFeedEvents = useCallback((incoming: RoomFeedEvent[]) => {
    if (!incoming.length) return;
    setFeedError(null);
    setFeedItems((prev) => {
      const seen = new Set(prev.map((entry) => entry.id));
      const merged = [...prev];
      for (const event of incoming) {
        if (seen.has(event.id)) continue;
        merged.push(event);
        seen.add(event.id);
      }
      merged.sort((a, b) => {
        if (a.created_at === b.created_at) return a.id.localeCompare(b.id);
        return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
      });
      return merged.slice(-200);
    });

    const lastEvent = incoming[incoming.length - 1];
    setFeedCursor(`${lastEvent.created_at}|${lastEvent.id}`);
  }, []);

  useEffect(() => {
    const container = feedContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [feedItems.length]);

  const loadFeed = useCallback(async () => {
    if (!accessToken || !roomCode || !canManuallySolve || state?.room.status !== "active") return;
    setFeedLoading(true);
    setFeedError(null);
    try {
      const response = await getRoomFeed(roomCode, accessToken, { limit: 50 });
      setFeedItems(response.items);
      setFeedCursor(response.next_cursor);
    } catch (err) {
      setFeedError(parseFeedError(err));
    } finally {
      setFeedLoading(false);
    }
  }, [accessToken, roomCode, canManuallySolve, state?.room.status]);

  useEffect(() => {
    void loadFeed();
  }, [loadFeed]);

  useEffect(() => {
    if (!accessToken || !roomCode || !canManuallySolve || state?.room.status !== "active") return;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) return;
      try {
        const response = await getRoomFeed(roomCode, accessToken, {
          limit: 50,
          cursor: feedCursorRef.current ?? undefined,
        });
        if (response.items.length) {
          appendFeedEvents(response.items);
        }
      } catch (err) {
        if (!cancelled) setFeedError(parseFeedError(err));
      }
    };

    void poll();
    const interval = setInterval(() => void poll(), FEED_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [
    accessToken,
    roomCode,
    canManuallySolve,
    state?.room.status,
    appendFeedEvents,
  ]);

  async function handleToggle(problem: ProblemPublic) {
    if (!accessToken || !state || !canManuallySolve) return;

    const isSolved = solvedSet.has(problem.title_slug);

    try {
      setPendingSlug(problem.title_slug);
      await toggleManualSolve(
        roomCode,
        accessToken,
        {
          problem_slug: problem.title_slug,
          solved: !isSolved,
        },
      );
      await fetchState();
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setPendingSlug(null);
    }
  }

  async function handleSendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !roomCode || !canManuallySolve) return;
    const trimmed = chatMessage.trim();
    if (!trimmed) return;

    setSendingMessage(true);
    setFeedError(null);
    try {
      const response = await sendRoomMessage(
        roomCode,
        { content: trimmed },
        accessToken,
      );
      appendFeedEvents([response]);
      setChatMessage("");
    } catch (err) {
      setFeedError(parseFeedError(err));
    } finally {
      setSendingMessage(false);
    }
  }

  async function handleShareRoom() {
    if (!state?.room) return;

    setShareCopied(false);
    try {
      await copyRoomShareMessage({
        roomCode,
        roomTitle: state.room.room_title,
        status: state.room.status,
        scheduledStartAt: state.room.scheduled_start_at,
        startsAt: state.room.starts_at,
        endsAt: state.room.ends_at,
        durationMinutes: state.room.duration_minutes,
        easyCount: state.room.easy_count,
        mediumCount: state.room.medium_count,
        hardCount: state.room.hard_count,
        problemSource: state.room.problem_source,
        strictCheck: state.room.strict_check,
        hasPasscode: state.room.has_passcode,
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
          Please sign in to access this room. Go back to{" "}
          <Link href="/" className="font-semibold underline">
            home page
          </Link>
          .
        </div>
      </main>
    );
  }

  if (loading && !state) {
    return <ActiveRoomLoadingSkeleton />;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-6 px-4 py-8 md:px-8">
      <header className="rounded-2xl border border-cyan-300/20 bg-slate-900/65 p-6 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm uppercase tracking-wide text-cyan-200">Challenge Live</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
              {state?.room.room_title}
            </h1>
            <p className="mt-1 font-mono text-xs uppercase tracking-wide text-slate-300">
              {roomCode}
            </p>
          </div>

          <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-2 text-center">
            <p className="text-xs uppercase tracking-wide text-emerald-200">Time Left</p>
            <p className="font-mono text-2xl font-semibold text-emerald-100">{countdown}</p>
          </div>
          <ShareCopyButton copied={shareCopied} onClick={() => void handleShareRoom()} />
        </div>
        <p className="mt-2 text-xs text-cyan-200/90">
          Source:{" "}
          {state?.room.problem_source ? formatProblemSource(state.room.problem_source) : "Random"}
        </p>
        <p className="mt-1 text-xs text-cyan-200/90">
          Strict checking: {state?.room.strict_check ? "On" : "Off"}
        </p>
        <p className="mt-1 text-xs text-cyan-200/90">
          Exclude pre-solved: {state?.room.exclude_pre_solved ? "On" : "Off"}
        </p>
      </header>

      {!canManuallySolve ? (
        <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          You are not a participant in this room, so manual solve actions are disabled.
        </div>
      ) : null}

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
                      <h3 className="text-lg font-semibold text-slate-100">{problem.title}</h3>
                      <p className="mt-1 font-mono text-xs text-slate-400">{problem.title_slug}</p>
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
                        disabled={!canManuallySolve || pendingSlug === problem.title_slug}
                        className={`rounded-lg px-3 py-2 text-sm font-semibold transition disabled:opacity-60 ${
                          isSolved
                            ? "bg-emerald-400 text-slate-900 hover:bg-emerald-300"
                            : "bg-slate-700 text-slate-100 hover:bg-slate-600"
                        }`}
                      >
                        {pendingSlug === problem.title_slug ? (
                          <span className="inline-flex items-center gap-2">
                            <InlineSpinner className="h-4 w-4" label="Saving solve state" />
                            Saving...
                          </span>
                        ) : isSolved ? (
                          "Solved"
                        ) : (
                          "Mark Solved"
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </SectionCard>

        <div className="space-y-6">
          <div className="inline-flex w-full rounded-2xl border border-slate-700/60 bg-slate-950/40 p-1 text-sm">
            <button
              type="button"
              onClick={() => setRightPaneTab("feed")}
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                rightPaneTab === "feed"
                  ? "bg-emerald-400 text-slate-900"
                  : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              Live Feed
            </button>
            <button
              type="button"
              onClick={() => setRightPaneTab("leaderboard")}
              className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                rightPaneTab === "leaderboard"
                  ? "bg-emerald-400 text-slate-900"
                  : "text-slate-300 hover:bg-slate-800/60"
              }`}
            >
              Leaderboard
            </button>
          </div>

          {rightPaneTab === "feed" ? (
            <SectionCard title="Live Feed" subtitle="Chat with your room and see live updates.">
              <div className="space-y-3">
                <div
                  ref={feedContainerRef}
                  className="site-scrollbar max-h-[360px] space-y-3 overflow-y-auto pr-1"
                >
                  {feedLoading ? (
                    <p className="text-sm text-slate-400">Loading live feed...</p>
                  ) : feedItems.length ? (
                    feedItems.map((event) => {
                      const isChat = event.event_type === "chat";
                      let body = "";
                      if (event.event_type === "solve") {
                        body = `solved ${event.problem_slug ?? "a problem"}`;
                      } else if (event.event_type === "join") {
                        body = "joined the room";
                      } else if (event.event_type === "leave") {
                        body = "left the room";
                      } else {
                        body = event.message ?? "";
                      }

                      return (
                        <article
                          key={event.id}
                          className="rounded-lg border border-slate-700/60 bg-slate-950/45 px-3 py-2 text-sm"
                        >
                          <div className="flex items-start gap-2">
                            <AvatarBadge
                              name={event.actor_username}
                              avatarUrl={event.actor_avatar_url}
                              size="sm"
                            />
                            <div className="min-w-0">
                              <p className="text-xs text-slate-400">
                                {prettyDateTime(event.event_at)}
                              </p>
                              <p className="text-slate-100">
                                <span className="font-semibold text-cyan-200">
                                  @{event.actor_username}
                                </span>{" "}
                                {isChat ? (
                                  <span className="text-slate-100">{body}</span>
                                ) : (
                                  <span className="text-slate-300">
                                    {body}
                                  </span>
                                )}
                                {event.event_type === "solve" && event.source ? (
                                  <span className="ml-2 rounded bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-200">
                                    {event.source}
                                  </span>
                                ) : null}
                              </p>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <p className="text-sm text-slate-400">
                      No live activity yet. Be the first to say hi.
                    </p>
                  )}
                </div>

                {feedError ? (
                  <div className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
                    {feedError}
                  </div>
                ) : null}

                <form onSubmit={handleSendMessage} className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={chatMessage}
                    onChange={(e) => setChatMessage(e.target.value)}
                    disabled={!canManuallySolve || sendingMessage}
                    placeholder={canManuallySolve ? "Send a message..." : "Join the room to chat"}
                    className="w-full rounded-lg border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 outline-none ring-emerald-300/70 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-70"
                  />
                  <button
                    type="submit"
                    disabled={!canManuallySolve || sendingMessage || !chatMessage.trim()}
                    className="rounded-lg bg-emerald-400 px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {sendingMessage ? "Sending..." : "Send"}
                  </button>
                </form>
              </div>
            </SectionCard>
          ) : (
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
                          <AvatarBadge name={entry.leetcode_username} avatarUrl={entry.avatar_url} size="sm" />
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono font-medium text-slate-100">
                                @{entry.leetcode_username}
                              </span>
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
          )}
        </div>
      </section>
    </main>
  );
}
