"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { AvatarBadge } from "@/components/avatar-badge";
import { DateTimeInput, NumberStepperInput } from "@/components/input-controls";
import { InlineSpinner, PageLoader, SkeletonBlock, SkeletonRow, SkeletonText } from "@/components/loading";
import { ShareCopyButton } from "@/components/share-copy-button";
import { SectionCard } from "@/components/section-card";
import { ApiError, getRoomState, leaveRoom, updateRoomSettings } from "@/lib/api";
import { saveFlashNotice } from "@/lib/auth-intent";
import { formatCountdown, prettyDateTime } from "@/lib/format";
import { requiresOnboarding } from "@/lib/onboarding";
import { formatProblemSource } from "@/lib/problem-source";
import { copyRoomShareMessage } from "@/lib/share-room";
import type { ProblemSource, RoomStateResponse } from "@/lib/types";

const POLL_INTERVAL_MS = 5000;

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Unable to load room state.";
}

function toLocalDateTimeValue(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hours = String(value.getHours()).padStart(2, "0");
  const minutes = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function LobbyLoadingSkeleton() {
  return (
    <PageLoader title="Loading lobby..." subtitle="Fetching room details and participants.">
      <div className="space-y-4">
        <SkeletonBlock className="h-24 w-full rounded-xl" />
        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <SkeletonText lines={2} />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <SkeletonRow key={`lobby-participant-skeleton-${index}`} columns={3} />
              ))}
            </div>
          </div>
          <div className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
            <SkeletonText lines={2} />
            <div className="mt-4 space-y-3">
              {Array.from({ length: 5 }).map((_, index) => (
                <SkeletonBlock key={`lobby-setting-skeleton-${index}`} className="h-9 w-full rounded-lg" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </PageLoader>
  );
}

export default function LobbyPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const roomCode = (params.code || "").toUpperCase();
  const { accessToken, authLoading, me, profileLoading, user } = useAuth();

  const [state, setState] = useState<RoomStateResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);
  const [serverOffsetMs, setServerOffsetMs] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [formLoadedForRoom, setFormLoadedForRoom] = useState<string | null>(null);

  const [roomTitle, setRoomTitle] = useState("");
  const [problemSource, setProblemSource] = useState<ProblemSource>("random");
  const [easyCount, setEasyCount] = useState(0);
  const [mediumCount, setMediumCount] = useState(4);
  const [hardCount, setHardCount] = useState(0);
  const [excludePreSolved, setExcludePreSolved] = useState(false);
  const [strictCheck, setStrictCheck] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [startAtLocal, setStartAtLocal] = useState("");
  const [passcode, setPasscode] = useState("");

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
    if (!roomCode || !accessToken) return;

    try {
      const response = await getRoomState(roomCode, accessToken);
      setState(response);
      setServerOffsetMs(new Date(response.server_time).getTime() - Date.now());
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
  }, [accessToken, roomCode, router]);

  useEffect(() => {
    if (!accessToken) {
      setLoading(false);
      return;
    }

    void fetchState();
    const timer = setInterval(() => {
      void fetchState();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [accessToken, fetchState]);

  useEffect(() => {
    if (!state?.room) return;
    if (formLoadedForRoom === state.room.id) return;

    setRoomTitle(state.room.room_title);
    setProblemSource(state.room.problem_source);
    setEasyCount(state.room.easy_count);
    setMediumCount(state.room.medium_count);
    setHardCount(state.room.hard_count);
    setExcludePreSolved(state.room.exclude_pre_solved);
    setStrictCheck(state.room.strict_check);
    setDurationMinutes(state.room.duration_minutes);
    setStartAtLocal(toLocalDateTimeValue(new Date(state.room.scheduled_start_at)));
    setPasscode("");
    setFormLoadedForRoom(state.room.id);
  }, [formLoadedForRoom, state]);

  const meParticipant = useMemo(
    () => state?.participants.find((participant) => participant.id === state.my_participant_id),
    [state],
  );
  const isHost = Boolean(meParticipant?.is_host);

  const totalProblems = useMemo(
    () => easyCount + mediumCount + hardCount,
    [easyCount, mediumCount, hardCount],
  );
  const validTotal = totalProblems >= 3 && totalProblems <= 10;

  const scheduledCountdown = useMemo(() => {
    if (!state?.room.scheduled_start_at) return "00:00:00";
    const virtualServerNow = new Date(nowMs + serverOffsetMs).toISOString();
    return formatCountdown(state.room.scheduled_start_at, virtualServerNow);
  }, [nowMs, serverOffsetMs, state?.room.scheduled_start_at]);

  async function handleSaveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !state) return;

    if (!validTotal) {
      setError("Total problems must be between 3 and 10.");
      return;
    }

    const parsedStartAt = new Date(startAtLocal);
    if (Number.isNaN(parsedStartAt.getTime())) {
      setError("Please provide a valid start time.");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await updateRoomSettings(
        roomCode,
        accessToken,
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
            ...(passcode.trim() ? { passcode: passcode.trim() } : {}),
          },
        },
      );
      setState((prev) => (prev ? { ...prev, room: response.room } : prev));
      setRoomTitle(response.room.room_title);
      setProblemSource(response.room.problem_source);
      setEasyCount(response.room.easy_count);
      setMediumCount(response.room.medium_count);
      setHardCount(response.room.hard_count);
      setExcludePreSolved(response.room.exclude_pre_solved);
      setStrictCheck(response.room.strict_check);
      setDurationMinutes(response.room.duration_minutes);
      setStartAtLocal(toLocalDateTimeValue(new Date(response.room.scheduled_start_at)));
      setPasscode("");
      setFormLoadedForRoom(response.room.id);
      await fetchState();
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setSaving(false);
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

  async function handleLeaveRoom() {
    if (!accessToken || !state?.my_participant_id || isHost || leaving) return;

    const confirmed = window.confirm(
      "Leave this room? You can rejoin later if the room is still in lobby.",
    );
    if (!confirmed) return;

    setLeaving(true);
    setError(null);
    try {
      await leaveRoom(roomCode, accessToken);
      saveFlashNotice(`You left room ${roomCode}.`);
      router.replace("/");
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setLeaving(false);
    }
  }

  if (authLoading) {
    return <PageLoader title="Checking session..." subtitle="Verifying your account access." />;
  }

  if (!user || !accessToken) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-6 text-amber-100">
          Please sign in to access rooms. Return to{" "}
          <Link href="/" className="font-semibold underline">
            home page
          </Link>
          .
        </div>
      </main>
    );
  }

  if (loading && !state) {
    return <LobbyLoadingSkeleton />;
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl space-y-6 px-4 py-8 md:px-8">
      <header className="rounded-2xl border border-cyan-300/20 bg-slate-900/65 p-6 backdrop-blur">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm uppercase tracking-wide text-cyan-200">Room Lobby</p>
            <h1 className="text-3xl font-semibold tracking-tight text-slate-50">
              {state?.room.room_title}
            </h1>
            <p className="mt-1 font-mono text-xs uppercase tracking-wide text-slate-300">
              {roomCode}
            </p>
          </div>
          <div className="flex w-full flex-col gap-2 lg:w-auto lg:min-w-[220px] lg:items-center">
            <div className="flex items-center gap-2 self-end lg:self-center">
              <Link
                href="/"
                className="rounded-lg border border-slate-500/60 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-800"
              >
                Back Home
              </Link>
              {state?.my_participant_id && !isHost ? (
                <button
                  type="button"
                  disabled={leaving}
                  onClick={() => void handleLeaveRoom()}
                  className="rounded-lg border border-rose-300/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {leaving ? "Leaving..." : "Leave Room"}
                </button>
              ) : null}
              <ShareCopyButton
                copied={shareCopied}
                onClick={() => void handleShareRoom()}
                className="h-10 w-10"
              />
            </div>
            <div className="self-end rounded-xl border border-cyan-300/30 bg-cyan-500/10 px-4 py-2 text-center lg:self-center">
              <p className="text-xs uppercase tracking-wide text-cyan-200">Auto Starts In</p>
              <p className="font-mono text-2xl font-semibold text-cyan-100">{scheduledCountdown}</p>
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-cyan-200/90">Signed in as @{me?.primary_leetcode_username}</p>
      </header>

      {!state?.my_participant_id ? (
        <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          You are authenticated but not a participant in this room. Join from the home page with
          room code.
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <section className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
        <SectionCard title="Participants" subtitle="Everyone joins with LeetCode username.">
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
                        name={participant.leetcode_username}
                        avatarUrl={participant.avatar_url}
                        size="sm"
                      />
                      <div>
                        <span className="font-mono font-medium text-slate-100">
                          @{participant.leetcode_username}
                        </span>
                        {participant.id === state.my_participant_id ? (
                          <span className="ml-2 rounded bg-cyan-500/20 px-2 py-0.5 text-xs text-cyan-200">
                            You
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>{participant.is_host ? "Host" : "Player"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>

        <SectionCard
          title="Room Settings"
          subtitle="Host can edit settings until scheduled start time."
        >
          {isHost ? (
            <form className="space-y-3 text-sm text-slate-200" onSubmit={handleSaveSettings}>
              <label className="block">
                Room Title
                <input
                  required
                  minLength={3}
                  maxLength={80}
                  value={roomTitle}
                  onChange={(e) => setRoomTitle(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                />
              </label>
              <label className="block">
                Scheduled Start
                <DateTimeInput
                  required
                  value={startAtLocal}
                  onChange={setStartAtLocal}
                  ariaLabel="scheduled start"
                  wrapperClassName="mt-1"
                  inputClassName="w-full rounded-lg border border-slate-600/70 bg-slate-950/70 px-3 py-2 pr-12 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                />
              </label>
              <label className="block">
                Problem Source
                <select
                  value={problemSource}
                  onChange={(e) => setProblemSource(e.target.value as ProblemSource)}
                  className="mt-1 w-full rounded-lg border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                >
                  <option value="random">Random (all LeetCode)</option>
                  <option value="neetcode_150">NeetCode 150</option>
                  <option value="neetcode_250">NeetCode 250</option>
                  <option value="blind_75">Blind 75</option>
                  <option value="striver_a2z_sheet">Striver A2Z Sheet</option>
                  <option value="striver_sde_sheet">Striver SDE Sheet</option>
                </select>
              </label>
              <div className="grid grid-cols-3 gap-2">
                <label className="block">
                  Easy
                  <NumberStepperInput
                    min={0}
                    max={10}
                    value={easyCount}
                    onChange={setEasyCount}
                    ariaLabel="easy problem count"
                    wrapperClassName="mt-1"
                    inputClassName="w-full rounded-lg border border-slate-600/70 bg-slate-950/70 px-3 py-2 pr-12 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                  />
                </label>
                <label className="block">
                  Medium
                  <NumberStepperInput
                    min={0}
                    max={10}
                    value={mediumCount}
                    onChange={setMediumCount}
                    ariaLabel="medium problem count"
                    wrapperClassName="mt-1"
                    inputClassName="w-full rounded-lg border border-slate-600/70 bg-slate-950/70 px-3 py-2 pr-12 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                  />
                </label>
                <label className="block">
                  Hard
                  <NumberStepperInput
                    min={0}
                    max={10}
                    value={hardCount}
                    onChange={setHardCount}
                    ariaLabel="hard problem count"
                    wrapperClassName="mt-1"
                    inputClassName="w-full rounded-lg border border-slate-600/70 bg-slate-950/70 px-3 py-2 pr-12 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                  />
                </label>
              </div>
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
                Total problems: {totalProblems} (allowed 3 to 10)
              </div>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
                <span>Exclude pre-solved problems</span>
                <input
                  type="checkbox"
                  checked={excludePreSolved}
                  onChange={(e) => setExcludePreSolved(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-500 bg-slate-950 text-cyan-300 focus:ring-cyan-400"
                />
              </label>
              <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
                <span>Strict checking</span>
                <input
                  type="checkbox"
                  checked={strictCheck}
                  onChange={(e) => setStrictCheck(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-500 bg-slate-950 text-cyan-300 focus:ring-cyan-400"
                />
              </label>
              <label className="block">
                Duration (minutes)
                <NumberStepperInput
                  min={15}
                  max={180}
                  value={durationMinutes}
                  onChange={setDurationMinutes}
                  ariaLabel="duration in minutes"
                  wrapperClassName="mt-1"
                  inputClassName="w-full rounded-lg border border-slate-600/70 bg-slate-950/70 px-3 py-2 pr-12 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                />
              </label>
              <label className="block">
                New Passcode (optional)
                <input
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  minLength={4}
                  maxLength={32}
                  className="mt-1 w-full rounded-lg border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                  placeholder={
                    state?.room.has_passcode
                      ? "Leave blank to keep existing passcode"
                      : "Set room passcode"
                  }
                />
              </label>
              <button
                type="submit"
                disabled={saving || !validTotal}
                className="w-full rounded-xl bg-cyan-400 px-4 py-2 font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {saving ? (
                  <span className="inline-flex items-center gap-2">
                    <InlineSpinner className="h-4 w-4" label="Saving room settings" />
                    Saving...
                  </span>
                ) : (
                  "Save Settings"
                )}
              </button>
            </form>
          ) : (
            <div className="space-y-3 text-sm text-slate-200">
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
                Start: {prettyDateTime(state?.room.scheduled_start_at ?? null)}
              </div>
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
                Source:{" "}
                {state?.room.problem_source ? formatProblemSource(state.room.problem_source) : "-"}
              </div>
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
                Mix: E{state?.room.easy_count ?? 0} / M{state?.room.medium_count ?? 0} / H
                {state?.room.hard_count ?? 0}
              </div>
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
                Timer: {state?.room.duration_minutes ?? "-"} minutes
              </div>
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
                Exclude pre-solved: {state?.room.exclude_pre_solved ? "On" : "Off"}
              </div>
              <div className="rounded-lg border border-slate-700/60 bg-slate-950/40 px-3 py-2">
                Strict checking: {state?.room.strict_check ? "On" : "Off"}
              </div>
            </div>
          )}
        </SectionCard>
      </section>
    </main>
  );
}
