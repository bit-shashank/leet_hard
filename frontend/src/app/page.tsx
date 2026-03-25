"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/auth-provider";
import { AvatarBadge } from "@/components/avatar-badge";
import { DateTimeInput, NumberStepperInput } from "@/components/input-controls";
import { InlineSpinner, SkeletonBlock, SkeletonText } from "@/components/loading";
import { ShareCopyButton } from "@/components/share-copy-button";
import {
  ApiError,
  createRoom,
  getDashboard,
  getDiscoverRooms,
  joinRoom,
} from "@/lib/api";
import {
  savePendingJoinRoomCode,
  takeFlashNotice,
  takePendingJoinError,
  takePendingJoinRoomCode,
} from "@/lib/auth-intent";
import { prettyDateTime } from "@/lib/format";
import { requiresOnboarding } from "@/lib/onboarding";
import { copyRoomShareMessage } from "@/lib/share-room";
import type { DashboardResponse, DiscoverRoomResponse, ProblemSource } from "@/lib/types";

const POLL_INTERVAL_MS = 5000;

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Please try again.";
}

function requiresGettingStarted(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  if (error.status !== 400 && error.status !== 403) return false;
  const normalized = error.message.toLowerCase();
  return (
    normalized.includes("complete getting started verification") ||
    normalized.includes("before creating or joining rooms") ||
    normalized.includes("primary leetcode username")
  );
}

function roomStatusClass(status: DiscoverRoomResponse["status"] | "saved") {
  if (status === "active") {
    return "border-emerald-300/40 bg-emerald-500/15 text-emerald-100";
  }
  if (status === "lobby") {
    return "border-cyan-300/40 bg-cyan-500/15 text-cyan-100";
  }
  if (status === "saved") {
    return "border-amber-300/40 bg-amber-500/15 text-amber-100";
  }
  return "border-slate-500/40 bg-slate-600/20 text-slate-200";
}

function roomTimingText(room: DiscoverRoomResponse) {
  if (room.status === "active") {
    if (!room.ends_at) return "Live now";
    return `Live now · ends ${relativeTimeText(room.ends_at)}`;
  }
  return `Starts ${relativeTimeText(room.scheduled_start_at)}`;
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

function parseRoomCodeInput(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const plainCode = trimmed.toUpperCase();
  if (/^[A-Z0-9]{4,12}$/.test(plainCode)) return plainCode;

  const patternMatch = trimmed.match(/(?:join|room)\/([a-z0-9]+)/i);
  if (patternMatch?.[1]) return patternMatch[1].toUpperCase();

  try {
    const parsed = new URL(trimmed);
    const segments = parsed.pathname.split("/").filter(Boolean);
    const joinIndex = segments.findIndex((segment) => segment.toLowerCase() === "join");
    if (joinIndex >= 0 && segments[joinIndex + 1]) {
      return segments[joinIndex + 1].toUpperCase();
    }
    const roomIndex = segments.findIndex((segment) => segment.toLowerCase() === "room");
    if (roomIndex >= 0 && segments[roomIndex + 1]) {
      return segments[roomIndex + 1].toUpperCase();
    }
  } catch {
    // no-op
  }

  return null;
}

function isPasscodeError(error: unknown) {
  if (!(error instanceof ApiError)) return false;
  return error.message.toLowerCase().includes("passcode");
}

function joinButtonLabel({
  user,
  alreadyJoined,
  isJoining,
  room,
}: {
  user: unknown;
  alreadyJoined: boolean;
  isJoining: boolean;
  room: DiscoverRoomResponse;
}) {
  if (!user) return "Sign in";
  if (alreadyJoined) return "Joined";
  if (isJoining) return "Joining...";
  if (room.status === "ended") return "Ended";
  if (!room.joinable) return "Full";
  return "Join";
}

function toLocalDateTimeValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function defaultStartAtLocal() {
  const value = new Date(Date.now() + 5 * 60 * 1000);
  value.setSeconds(0, 0);
  return toLocalDateTimeValue(value);
}

function roomHref(roomCode: string, roomStatus: DiscoverRoomResponse["status"] | "ended") {
  const normalized = roomCode.toUpperCase();
  if (roomStatus === "active") return `/room/${normalized}`;
  if (roomStatus === "ended") return `/room/${normalized}/history`;
  return `/room/${normalized}/lobby`;
}

function DiscoverRoomSkeletonCard() {
  return (
    <article className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <SkeletonBlock className="h-5 w-3/5" />
          <SkeletonBlock className="mt-2 h-3 w-24" />
        </div>
        <SkeletonBlock className="h-6 w-20 rounded-full" />
      </div>
      <SkeletonBlock className="mt-3 h-3 w-2/3" />
      <div className="mt-3 flex items-center gap-2">
        <SkeletonBlock className="h-8 w-8 rounded-full" />
        <SkeletonBlock className="h-3 w-32" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <SkeletonBlock className="h-7 w-full rounded-lg" />
        <SkeletonBlock className="h-7 w-full rounded-lg" />
        <SkeletonBlock className="col-span-2 h-7 w-full rounded-lg" />
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <SkeletonBlock className="h-3 w-28" />
        <SkeletonBlock className="h-8 w-20 rounded-lg" />
      </div>
    </article>
  );
}

function RecentRoomSkeletonCard() {
  return (
    <article className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <SkeletonBlock className="h-5 w-3/5" />
          <SkeletonBlock className="mt-2 h-3 w-24" />
        </div>
        <SkeletonBlock className="h-6 w-16 rounded-full" />
      </div>
      <SkeletonText className="mt-3" lines={2} />
      <SkeletonBlock className="mt-4 h-8 w-24 rounded-lg" />
    </article>
  );
}

export default function HomePage() {
  const router = useRouter();
  const { accessToken, authLoading, me, profileLoading, signInWithGoogle, user } = useAuth();

  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);
  const [showJoinPasscode, setShowJoinPasscode] = useState(false);

  const [roomTitle, setRoomTitle] = useState("");
  const [problemSource, setProblemSource] = useState<ProblemSource>("random");
  const [easyCount, setEasyCount] = useState(0);
  const [mediumCount, setMediumCount] = useState(4);
  const [hardCount, setHardCount] = useState(0);
  const [excludePreSolved, setExcludePreSolved] = useState(false);
  const [strictCheck, setStrictCheck] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [startAtLocal, setStartAtLocal] = useState(defaultStartAtLocal);
  const [createPasscode, setCreatePasscode] = useState("");

  const [roomCode, setRoomCode] = useState("");
  const [joinPasscode, setJoinPasscode] = useState("");

  const [discoverRooms, setDiscoverRooms] = useState<DiscoverRoomResponse[]>([]);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [copiedRoomCode, setCopiedRoomCode] = useState<string | null>(null);
  const [joiningRoomCode, setJoiningRoomCode] = useState<string | null>(null);

  const joinSectionRef = useRef<HTMLElement | null>(null);
  const createSectionRef = useRef<HTMLElement | null>(null);
  const totalProblems = useMemo(
    () => easyCount + mediumCount + hardCount,
    [easyCount, mediumCount, hardCount],
  );
  const validTotal = totalProblems >= 3 && totalProblems <= 10;

  const recentRoomCodeSet = useMemo(
    () => new Set((dashboard?.recent_rooms || []).map((room) => room.room_code.toUpperCase())),
    [dashboard?.recent_rooms],
  );
  const discoverByCode = useMemo(
    () => new Map(discoverRooms.map((room) => [room.room_code.toUpperCase(), room])),
    [discoverRooms],
  );
  const activeRoomCount = useMemo(
    () => discoverRooms.filter((room) => room.status === "active").length,
    [discoverRooms],
  );
  const startingSoonCount = useMemo(() => {
    const now = Date.now();
    const oneHourMs = 60 * 60 * 1000;
    return discoverRooms.filter((room) => {
      if (room.status !== "lobby") return false;
      const startsAtMs = new Date(room.scheduled_start_at).getTime();
      return Number.isFinite(startsAtMs) && startsAtMs >= now && startsAtMs - now <= oneHourMs;
    }).length;
  }, [discoverRooms]);
  const liveParticipantCount = useMemo(
    () => discoverRooms.reduce((count, room) => count + room.participant_count, 0),
    [discoverRooms],
  );
  const showStatsBlock = discoverLoading || activeRoomCount + startingSoonCount + liveParticipantCount > 0;

  const onboardingRequired = requiresOnboarding(me);

  useEffect(() => {
    if (authLoading || profileLoading || !user) return;
    if (onboardingRequired) {
      router.replace("/getting-started");
    }
  }, [authLoading, onboardingRequired, profileLoading, router, user]);

  useEffect(() => {
    const flashNotice = takeFlashNotice();
    if (flashNotice) {
      setResumeNotice(flashNotice);
    }

    const pendingJoinError = takePendingJoinError();
    if (pendingJoinError) {
      setError(pendingJoinError);
    }
  }, []);

  const fetchDiscoverRooms = useCallback(async () => {
    try {
      const rooms = await getDiscoverRooms("lobby,active", {
        accessToken: accessToken ?? undefined,
        limit: 12,
      });
      setDiscoverRooms(rooms);
    } catch {
      setDiscoverRooms([]);
    } finally {
      setDiscoverLoading(false);
    }
  }, [accessToken]);

  const fetchDashboardData = useCallback(async () => {
    if (!accessToken || onboardingRequired) {
      setDashboard(null);
      setDashboardLoading(false);
      return;
    }

    setDashboardLoading(true);
    try {
      const response = await getDashboard(accessToken);
      setDashboard(response);
    } catch {
      setDashboard(null);
    } finally {
      setDashboardLoading(false);
    }
  }, [accessToken, onboardingRequired]);

  useEffect(() => {
    void fetchDiscoverRooms();
    const timer = setInterval(() => {
      void fetchDiscoverRooms();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [fetchDiscoverRooms]);

  useEffect(() => {
    void fetchDashboardData();
  }, [fetchDashboardData]);

  useEffect(() => {
    if (!user || !accessToken || profileLoading || onboardingRequired) return;

    const pendingRoomCode = takePendingJoinRoomCode();
    if (!pendingRoomCode) return;

    setRoomCode(pendingRoomCode);
    setShowJoinPasscode(false);
    setResumeNotice(`Resumed join flow for room ${pendingRoomCode}.`);
    joinSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [accessToken, onboardingRequired, profileLoading, user]);

  async function triggerSignIn(pendingRoomCode?: string) {
    if (pendingRoomCode) {
      savePendingJoinRoomCode(pendingRoomCode);
    }

    setError(null);
    try {
      await signInWithGoogle();
    } catch {
      setError("Unable to start Google sign in. Please try again.");
    }
  }

  function routeAfterJoin(roomCodeValue: string, status: "lobby" | "active" | "ended") {
    if (status === "active") {
      router.push(`/room/${roomCodeValue}`);
      return;
    }
    if (status === "ended") {
      router.push(`/room/${roomCodeValue}/history`);
      return;
    }
    router.push(`/room/${roomCodeValue}/lobby`);
  }

  async function attemptDirectJoin(
    normalizedCode: string,
    opts?: { passcode?: string; onPasscodeRequired?: () => void },
  ) {
    if (!accessToken) return;
    const payload = opts?.passcode ? { passcode: opts.passcode } : {};

    try {
      const response = await joinRoom(normalizedCode, payload, accessToken);
      await fetchDashboardData();
      routeAfterJoin(response.room.room_code, response.room.status);
      return;
    } catch (err) {
      if (requiresGettingStarted(err)) {
        savePendingJoinRoomCode(normalizedCode);
        router.push("/getting-started");
        return;
      }
      if (!opts?.passcode && isPasscodeError(err)) {
        opts?.onPasscodeRequired?.();
        return;
      }
      throw err;
    }
  }

  async function handleCreateCta() {
    if (!user || !accessToken) {
      await triggerSignIn();
      return;
    }
    if (onboardingRequired) {
      router.push("/getting-started");
      return;
    }
    createSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validTotal) {
      setError("Total problems must be between 3 and 10.");
      return;
    }

    if (!user || !accessToken) {
      await triggerSignIn();
      return;
    }

    if (onboardingRequired) {
      router.push("/getting-started");
      return;
    }

    setCreateLoading(true);
    setError(null);

    try {
      const parsedStartAt = new Date(startAtLocal);
      if (Number.isNaN(parsedStartAt.getTime())) {
        setError("Please provide a valid start time.");
        setCreateLoading(false);
        return;
      }

      const response = await createRoom(
        {
          room_title: roomTitle.trim(),
          settings: {
            problem_source: problemSource,
            easy_count: easyCount,
            medium_count: mediumCount,
            hard_count: hardCount,
            exclude_pre_solved: excludePreSolved,
            strict_check: strictCheck,
            duration_minutes: durationMinutes,
            start_at: parsedStartAt.toISOString(),
            ...(createPasscode.trim() ? { passcode: createPasscode.trim() } : {}),
          },
        },
        accessToken,
      );

      router.push(`/room/${response.room.room_code}/lobby`);
    } catch (err) {
      if (requiresGettingStarted(err)) {
        router.push("/getting-started");
        return;
      }
      setError(parseApiError(err));
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalizedCode = parseRoomCodeInput(roomCode);

    if (!normalizedCode) {
      setError("Enter a valid room code or invite link.");
      return;
    }

    if (!user || !accessToken) {
      await triggerSignIn(normalizedCode);
      return;
    }

    if (onboardingRequired) {
      savePendingJoinRoomCode(normalizedCode);
      router.push("/getting-started");
      return;
    }

    setRoomCode(normalizedCode);
    setJoinLoading(true);
    setError(null);

    try {
      const knownRoom = discoverByCode.get(normalizedCode);
      const trimmedPasscode = joinPasscode.trim();

      if (knownRoom?.has_passcode && !trimmedPasscode) {
        setShowJoinPasscode(true);
        setResumeNotice(`Room ${normalizedCode} requires a passcode to join.`);
        setError(null);
        return;
      }

      await attemptDirectJoin(normalizedCode, {
        ...(trimmedPasscode ? { passcode: trimmedPasscode } : {}),
        onPasscodeRequired: () => {
          setShowJoinPasscode(true);
          setResumeNotice(`Room ${normalizedCode} requires a passcode to join.`);
        },
      });
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleRoomCardJoin(room: DiscoverRoomResponse, alreadyJoined: boolean) {
    const normalizedCode = room.room_code.toUpperCase();
    if (alreadyJoined && user) return;
    if (!room.joinable && user) return;
    if (joiningRoomCode === normalizedCode) return;

    if (!user || !accessToken) {
      await triggerSignIn(room.room_code);
      return;
    }

    if (onboardingRequired) {
      savePendingJoinRoomCode(room.room_code);
      router.push("/getting-started");
      return;
    }

    if (room.has_passcode) {
      setRoomCode(room.room_code);
      setShowJoinPasscode(true);
      setJoinPasscode("");
      setResumeNotice(`Room ${room.room_code} selected. Complete join details below.`);
      joinSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    setJoiningRoomCode(normalizedCode);
    setJoinLoading(true);
    setError(null);
    try {
      await attemptDirectJoin(normalizedCode, {
        onPasscodeRequired: () => {
          setRoomCode(normalizedCode);
          setShowJoinPasscode(true);
          setResumeNotice(`Room ${normalizedCode} now requires a passcode to join.`);
          joinSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      });
    } catch (err) {
      setRoomCode(normalizedCode);
      setShowJoinPasscode(true);
      setError(parseApiError(err));
      setResumeNotice(`Room ${normalizedCode} selected. Complete join details below.`);
      joinSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    } finally {
      setJoinLoading(false);
      setJoiningRoomCode(null);
    }
  }

  async function handleShareDiscoverRoom(room: DiscoverRoomResponse) {
    try {
      await copyRoomShareMessage({
        roomCode: room.room_code,
        roomTitle: room.room_title,
        status: room.status,
        scheduledStartAt: room.scheduled_start_at,
        startsAt: room.starts_at,
        endsAt: room.ends_at,
        easyCount: room.easy_count,
        mediumCount: room.medium_count,
        hardCount: room.hard_count,
        problemSource: room.problem_source,
        hasPasscode: room.has_passcode,
      });
      setCopiedRoomCode(room.room_code.toUpperCase());
      window.setTimeout(() => setCopiedRoomCode(null), 1600);
    } catch {
      setError("Could not copy room invite. Please try again.");
    }
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-10 md:px-8">
      <header
        ref={joinSectionRef}
        className="mb-6 rounded-2xl border border-cyan-300/20 bg-slate-900/65 p-6 shadow-lg shadow-cyan-950/20 backdrop-blur md:p-8"
      >
        <p className="mb-2 inline-flex rounded-full border border-cyan-300/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-200">
          LeetRace
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-50 md:text-4xl">
          Solve problems faster than your friends, live.
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-300 md:text-base">
          Real-time coding races with live leaderboards. Join instantly with a room code or invite link.
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleJoinRoom}>
          <label className="block text-sm text-slate-100">
            Room Code or Invite Link
            <div className="mt-1 flex flex-col gap-2 sm:flex-row">
              <input
                required
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value)}
                className="w-full rounded-xl border border-emerald-200/40 bg-slate-950/75 px-3 py-2 text-slate-100 outline-none ring-emerald-300/70 transition focus:ring-2"
                placeholder="ABC123 or https://your-domain.com/join/ABC123"
              />
              <button
                type="submit"
                disabled={joinLoading}
                className="h-[42px] whitespace-nowrap rounded-xl bg-emerald-400 px-4 font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {joinLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <InlineSpinner className="h-4 w-4" label="Joining room" />
                    Joining...
                  </span>
                ) : (
                  "Join Room"
                )}
              </button>
            </div>
          </label>
          <button
            type="button"
            onClick={() => setShowJoinPasscode((value) => !value)}
            className="text-xs font-medium text-emerald-100 underline decoration-dotted underline-offset-4 transition hover:text-white"
          >
            {showJoinPasscode ? "Hide passcode field" : "Room has passcode? Add it"}
          </button>
          {showJoinPasscode ? (
            <label className="block text-sm text-slate-100">
              Passcode
              <input
                value={joinPasscode}
                onChange={(e) => setJoinPasscode(e.target.value)}
                className="mt-1 w-full rounded-xl border border-emerald-200/40 bg-slate-950/75 px-3 py-2 text-slate-100 outline-none ring-emerald-300/70 transition focus:ring-2"
                placeholder="Enter room passcode"
              />
            </label>
          ) : null}
        </form>

        <div className="mt-5 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => void handleCreateCta()}
            className="rounded-lg border border-cyan-300/60 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-500/10"
          >
            Create your own room
          </button>
        </div>
      </header>

      {error ? (
        <div className="mb-4 rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}
      {resumeNotice ? (
        <div className="mb-4 rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-3 text-sm text-cyan-100">
          {resumeNotice}
        </div>
      ) : null}

      <section className="mb-6 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
        <h2 className="text-xl font-semibold text-slate-100">How LeetRace Works</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <article className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">1. Create</p>
            <p className="mt-2 text-sm text-slate-200">Pick source, difficulty mix, and schedule.</p>
          </article>
          <article className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">2. Share</p>
            <p className="mt-2 text-sm text-slate-200">Send one invite link in WhatsApp, Slack, or Discord.</p>
          </article>
          <article className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-cyan-200">3. Race</p>
            <p className="mt-2 text-sm text-slate-200">Compete live with timer + leaderboard updates.</p>
          </article>
        </div>
      </section>

      <section className="mb-6 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Top Rooms</h2>
            <p className="mt-1 text-sm text-slate-300">
              Active first, then closest upcoming starts.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void fetchDiscoverRooms()}
            className="rounded-lg border border-slate-500/60 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
          >
            Refresh
          </button>
        </div>

        {discoverLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <DiscoverRoomSkeletonCard key={`discover-room-skeleton-${index}`} />
            ))}
          </div>
        ) : discoverRooms.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {discoverRooms.map((room) => {
              const alreadyJoined = user ? recentRoomCodeSet.has(room.room_code.toUpperCase()) : false;
              const isJoiningThisRoom = joiningRoomCode === room.room_code.toUpperCase();
              const joinDisabled = user
                ? alreadyJoined || isJoiningThisRoom || room.status === "ended" || !room.joinable
                : false;
              const label = joinButtonLabel({
                user,
                alreadyJoined,
                isJoining: isJoiningThisRoom,
                room,
              });
              return (
                <article
                  key={room.room_code}
                  className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-lg font-semibold tracking-tight text-slate-100">
                        {room.room_title}
                      </h3>
                      <p className="mt-1 font-mono text-xs uppercase tracking-wide text-slate-400">
                        {room.room_code}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${roomStatusClass(room.status)}`}
                      >
                        {room.status}
                      </span>
                      <ShareCopyButton
                        copied={copiedRoomCode === room.room_code.toUpperCase()}
                        onClick={() => void handleShareDiscoverRoom(room)}
                        className="h-8 w-8"
                      />
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-1.5">
                      {roomTimingText(room)}
                    </div>
                    <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-1.5">
                      {room.participant_count} participants
                    </div>
                    <div className="col-span-2 rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-1.5">
                      Format: Easy {room.easy_count} • Medium {room.medium_count} • Hard {room.hard_count}
                    </div>
                  </div>

                  <div className="mt-3 flex items-center gap-2 text-sm text-slate-200">
                    <AvatarBadge
                      name={room.host_leetcode_username || "Host"}
                      avatarUrl={room.host_avatar_url}
                      size="sm"
                    />
                    <div>
                      <p className="font-medium text-slate-100">
                        Host @{room.host_leetcode_username || "unknown"}
                      </p>
                      <p className="text-xs text-slate-400">{prettyDateTime(room.scheduled_start_at)}</p>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3">
                    <span className="text-xs text-slate-400">
                      {alreadyJoined
                        ? "You already joined this room."
                        : room.has_passcode
                          ? "Passcode protected room."
                          : "Open room, quick entry."}
                    </span>
                    <button
                      type="button"
                      disabled={joinDisabled}
                      onClick={() => void handleRoomCardJoin(room, alreadyJoined)}
                      className="rounded-lg bg-emerald-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {label}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-300">No lobby or active rooms right now.</p>
        )}
      </section>

      {user && !onboardingRequired ? (
        <section className="mb-6 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-slate-100">Resume My Rooms</h2>
              <p className="mt-1 text-sm text-slate-300">
                Quick-jump links from your authenticated room history.
              </p>
            </div>
          </div>

          {dashboardLoading ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, index) => (
                <RecentRoomSkeletonCard key={`recent-room-skeleton-${index}`} />
              ))}
            </div>
          ) : dashboard?.recent_rooms.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {dashboard.recent_rooms.map((room) => {
                const discover = discoverByCode.get(room.room_code.toUpperCase());
                const status = discover?.status || room.status;
                return (
                  <article
                    key={`${room.room_code}-${room.joined_at}`}
                    className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-lg font-semibold tracking-tight text-slate-100">
                          {room.room_title}
                        </h3>
                        <p className="mt-1 font-mono text-xs uppercase tracking-wide text-slate-400">
                          {room.room_code}
                        </p>
                      </div>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${roomStatusClass(status)}`}
                      >
                        {status}
                      </span>
                    </div>

                    <div className="mt-3 space-y-1 text-xs text-slate-300">
                      <p>Joined: {prettyDateTime(room.joined_at)}</p>
                      <p>
                        My Stats: {room.my_solved_count} solved
                        {room.my_rank ? ` · rank #${room.my_rank}` : ""}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => router.push(roomHref(room.room_code, status))}
                      className="mt-4 rounded-lg bg-cyan-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300"
                    >
                      Open Room
                    </button>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-300">No joined rooms yet.</p>
          )}
        </section>
      ) : null}

      <section
        ref={createSectionRef}
        className="mb-6 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur"
      >
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Create Room</h2>
            <p className="mt-1 text-sm text-slate-300">
              Configure your race format, timer, and schedule. Then share one link and start competing.
            </p>
          </div>
        </div>

        <form className="space-y-4" onSubmit={handleCreateRoom}>
            <label className="block text-sm text-slate-200">
              Room Title
              <input
                required
                value={roomTitle}
                onChange={(e) => setRoomTitle(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                placeholder="Sunday Mock Race"
              />
            </label>

            <label className="block text-sm text-slate-200">
              Problem Source
              <select
                value={problemSource}
                onChange={(e) => setProblemSource(e.target.value as ProblemSource)}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
              >
                <option value="random">Random (all LeetCode)</option>
                <option value="neetcode_150">NeetCode 150</option>
                <option value="neetcode_250">NeetCode 250</option>
                <option value="blind_75">Blind 75</option>
                <option value="striver_a2z_sheet">Striver A2Z Sheet</option>
                <option value="striver_sde_sheet">Striver SDE Sheet</option>
              </select>
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="block text-sm text-slate-200">
                Easy
                <NumberStepperInput
                  min={0}
                  max={10}
                  required
                  value={easyCount}
                  onChange={setEasyCount}
                  ariaLabel="easy problem count"
                  wrapperClassName="mt-1"
                  inputClassName="w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 pr-12 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                />
              </label>
              <label className="block text-sm text-slate-200">
                Medium
                <NumberStepperInput
                  min={0}
                  max={10}
                  required
                  value={mediumCount}
                  onChange={setMediumCount}
                  ariaLabel="medium problem count"
                  wrapperClassName="mt-1"
                  inputClassName="w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 pr-12 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                />
              </label>
              <label className="block text-sm text-slate-200">
                Hard
                <NumberStepperInput
                  min={0}
                  max={10}
                  required
                  value={hardCount}
                  onChange={setHardCount}
                  ariaLabel="hard problem count"
                  wrapperClassName="mt-1"
                  inputClassName="w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 pr-12 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                />
              </label>
            </div>

            <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
              <p>
                Total Problems: <span className="font-semibold text-cyan-200">{totalProblems}</span>
              </p>
              <p className={`mt-1 text-xs ${validTotal ? "text-emerald-200" : "text-rose-200"}`}>
                Allowed range: 3 to 10
              </p>
            </div>

            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
              <div>
                <p className="font-medium text-slate-100">Exclude Pre-Solved</p>
                <p className="text-xs text-slate-400">
                  Prefer problems not solved by room members before start.
                </p>
              </div>
              <input
                type="checkbox"
                checked={excludePreSolved}
                onChange={(e) => setExcludePreSolved(e.target.checked)}
                className="h-4 w-4 rounded border-slate-500 bg-slate-950 text-cyan-300 focus:ring-cyan-400"
              />
            </label>

            <label className="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-sm text-slate-200">
              <div>
                <p className="font-medium text-slate-100">Strict Checking</p>
                <p className="text-xs text-slate-400">
                  Verify accepted submission before manual mark solved.
                </p>
              </div>
              <input
                type="checkbox"
                checked={strictCheck}
                onChange={(e) => setStrictCheck(e.target.checked)}
                className="h-4 w-4 rounded border-slate-500 bg-slate-950 text-cyan-300 focus:ring-cyan-400"
              />
            </label>

            <label className="block text-sm text-slate-200">
              Duration (minutes)
              <NumberStepperInput
                min={15}
                max={180}
                required
                value={durationMinutes}
                onChange={setDurationMinutes}
                ariaLabel="duration in minutes"
                wrapperClassName="mt-1"
                inputClassName="w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 pr-12 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
              />
            </label>

            <label className="block text-sm text-slate-200">
              Scheduled Start Time
              <DateTimeInput
                required
                value={startAtLocal}
                onChange={setStartAtLocal}
                ariaLabel="scheduled start time"
                wrapperClassName="mt-1"
                inputClassName="w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 pr-12 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
              />
            </label>

            <label className="block text-sm text-slate-200">
              Optional Passcode
              <input
                value={createPasscode}
                onChange={(e) => setCreatePasscode(e.target.value)}
                minLength={4}
                maxLength={32}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                placeholder="Set a room passcode"
              />
            </label>

          <button
            type="submit"
            disabled={createLoading || !validTotal}
            className="w-full rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {createLoading ? (
              <span className="inline-flex items-center gap-2">
                <InlineSpinner className="h-4 w-4" label="Creating room" />
                Creating...
              </span>
            ) : !user ? (
              "Sign in to Create"
            ) : (
              "Create & Enter Lobby"
            )}
          </button>
        </form>
      </section>

      {showStatsBlock ? (
        <section className="mb-2 grid gap-3 md:grid-cols-3">
          {discoverLoading ? (
            <>
              <SkeletonBlock className="h-20 rounded-xl" />
              <SkeletonBlock className="h-20 rounded-xl" />
              <SkeletonBlock className="h-20 rounded-xl" />
            </>
          ) : (
            <>
              <article className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Live Competition</p>
                <p className="mt-2 text-2xl font-semibold text-slate-100">
                  {liveParticipantCount} players competing now
                </p>
              </article>
              <article className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Rooms In Progress</p>
                <p className="mt-2 text-2xl font-semibold text-slate-100">{activeRoomCount} active rooms</p>
              </article>
              <article className="rounded-xl border border-slate-700/60 bg-slate-900/60 p-4">
                <p className="text-xs uppercase tracking-wide text-slate-400">Starting Soon</p>
                <p className="mt-2 text-2xl font-semibold text-slate-100">{startingSoonCount} races in 1 hour</p>
              </article>
            </>
          )}
        </section>
      ) : null}

    </main>
  );
}
