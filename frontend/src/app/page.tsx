"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ApiError, createRoom, getDiscoverRooms, joinRoom } from "@/lib/api";
import { prettyDateTime } from "@/lib/format";
import { clearRoomToken, listSavedRoomCodes, saveRoomToken } from "@/lib/tokens";
import type { DiscoverRoomResponse, ProblemSource } from "@/lib/types";
import { AvatarBadge } from "@/components/avatar-badge";

const POLL_INTERVAL_MS = 5000;

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Please try again.";
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
    return `Ends ${prettyDateTime(room.ends_at)}`;
  }
  if (room.starts_at) {
    return `Starts ${prettyDateTime(room.starts_at)}`;
  }
  return `Created ${prettyDateTime(room.created_at)}`;
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

export default function HomePage() {
  const router = useRouter();

  const [createLoading, setCreateLoading] = useState(false);
  const [joinLoading, setJoinLoading] = useState(false);
  const [discoverLoading, setDiscoverLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [hostNickname, setHostNickname] = useState("");
  const [hostLeet, setHostLeet] = useState("");
  const [problemSource, setProblemSource] = useState<ProblemSource>("random");
  const [easyCount, setEasyCount] = useState(0);
  const [mediumCount, setMediumCount] = useState(4);
  const [hardCount, setHardCount] = useState(0);
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [createPasscode, setCreatePasscode] = useState("");

  const [roomCode, setRoomCode] = useState("");
  const [joinNickname, setJoinNickname] = useState("");
  const [joinLeet, setJoinLeet] = useState("");
  const [joinPasscode, setJoinPasscode] = useState("");

  const [discoverRooms, setDiscoverRooms] = useState<DiscoverRoomResponse[]>([]);
  const [savedRoomCodes, setSavedRoomCodes] = useState<string[]>([]);
  const joinSectionRef = useRef<HTMLElement | null>(null);
  const roomCodeInputRef = useRef<HTMLInputElement | null>(null);

  const totalProblems = useMemo(
    () => easyCount + mediumCount + hardCount,
    [easyCount, mediumCount, hardCount],
  );
  const validTotal = totalProblems >= 3 && totalProblems <= 10;
  const discoverByCode = useMemo(
    () => new Map(discoverRooms.map((room) => [room.room_code.toUpperCase(), room])),
    [discoverRooms],
  );
  const joinedRooms = useMemo(
    () =>
      savedRoomCodes.map((savedRoomCode) => ({
        roomCode: savedRoomCode,
        room: discoverByCode.get(savedRoomCode) ?? null,
      })),
    [savedRoomCodes, discoverByCode],
  );

  const fetchDiscoverRooms = useCallback(async () => {
    try {
      const rooms = await getDiscoverRooms();
      setDiscoverRooms(rooms);
    } catch {
      // Room discovery should never block core create/join flows.
      setDiscoverRooms([]);
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  useEffect(() => {
    setSavedRoomCodes(listSavedRoomCodes());
  }, []);

  useEffect(() => {
    void fetchDiscoverRooms();
    const timer = setInterval(() => {
      void fetchDiscoverRooms();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [fetchDiscoverRooms]);

  function addSavedRoomCode(roomCodeToAdd: string) {
    const normalizedCode = roomCodeToAdd.toUpperCase();
    setSavedRoomCodes((current) => {
      if (current.includes(normalizedCode)) return current;
      return [...current, normalizedCode].sort();
    });
  }

  async function handleCreateRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!validTotal) {
      setError("Total problems must be between 3 and 10.");
      return;
    }

    setCreateLoading(true);
    setError(null);

    try {
      const response = await createRoom({
        host_nickname: hostNickname.trim(),
        host_leetcode_username: hostLeet.trim(),
        settings: {
          problem_source: problemSource,
          easy_count: easyCount,
          medium_count: mediumCount,
          hard_count: hardCount,
          duration_minutes: durationMinutes,
          ...(createPasscode.trim() ? { passcode: createPasscode.trim() } : {}),
        },
      });

      saveRoomToken(response.room.room_code, response.participant_token);
      addSavedRoomCode(response.room.room_code);
      router.push(`/room/${response.room.room_code}/lobby`);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleJoinRoom(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setJoinLoading(true);
    setError(null);

    try {
      const normalizedCode = roomCode.trim().toUpperCase();
      const response = await joinRoom(normalizedCode, {
        nickname: joinNickname.trim(),
        leetcode_username: joinLeet.trim(),
        ...(joinPasscode.trim() ? { passcode: joinPasscode.trim() } : {}),
      });

      saveRoomToken(response.room.room_code, response.participant_token);
      addSavedRoomCode(response.room.room_code);
      router.push(`/room/${response.room.room_code}/lobby`);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setJoinLoading(false);
    }
  }

  function prefillJoinRoom(code: string) {
    setRoomCode(code.toUpperCase());
    joinSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    window.setTimeout(() => roomCodeInputRef.current?.focus(), 150);
  }

  function openSavedRoom(code: string) {
    router.push(`/room/${code.toUpperCase()}/lobby`);
  }

  function forgetSavedRoom(code: string) {
    clearRoomToken(code);
    setSavedRoomCodes((current) => current.filter((roomCode) => roomCode !== code.toUpperCase()));
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-4 py-10 md:px-8">
      <header className="mb-8 rounded-2xl border border-cyan-300/20 bg-slate-900/65 p-6 shadow-lg shadow-cyan-950/20 backdrop-blur md:p-8">
        <p className="mb-2 inline-flex rounded-full border border-cyan-300/30 bg-cyan-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-200">
          LeetCode Room Race
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-50 md:text-4xl">
          Discover live rooms, join quickly, or create your own coding race
        </h1>
        <p className="mt-3 max-w-3xl text-sm text-slate-300 md:text-base">
          Build custom challenge rooms, invite by code, and race with a live leaderboard.
        </p>
      </header>

      {error ? (
        <div className="mb-6 rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}

      <section className="mb-6 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Joined Rooms</h2>
            <p className="mt-1 text-sm text-slate-300">
              Rooms saved in this browser for one-click resume.
            </p>
          </div>
        </div>

        {joinedRooms.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {joinedRooms.map(({ roomCode: savedRoomCode, room }) => (
              <article
                key={savedRoomCode}
                className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Room</p>
                    <h3 className="font-mono text-lg font-semibold tracking-wider text-slate-100">
                      {savedRoomCode}
                    </h3>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${roomStatusClass(room?.status ?? "saved")}`}
                  >
                    {room?.status ?? "saved"}
                  </span>
                </div>

                <p className="mt-2 text-xs text-slate-400">
                  {room
                    ? roomTimingText(room)
                    : "Not currently discoverable. It may be ended or private."}
                </p>

                {room ? (
                  <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-300">
                    <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-1.5">
                      E {room.easy_count} · M {room.medium_count} · H {room.hard_count}
                    </div>
                    <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-1.5">
                      {room.participant_count} participants
                    </div>
                    <div className="col-span-2 rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-1.5">
                      Source: {formatProblemSource(room.problem_source)}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-1.5 text-xs text-slate-300">
                    Saved in local browser storage.
                  </div>
                )}

                <div className="mt-4 flex items-center justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => openSavedRoom(savedRoomCode)}
                    className="rounded-lg bg-cyan-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300"
                  >
                    Open Room
                  </button>
                  <button
                    type="button"
                    onClick={() => forgetSavedRoom(savedRoomCode)}
                    className="rounded-lg border border-rose-400/50 px-3 py-1.5 text-sm font-semibold text-rose-200 transition hover:bg-rose-500/15"
                  >
                    Forget
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-300">No joined rooms saved in this browser yet.</p>
        )}
      </section>

      <section className="mb-6 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold text-slate-100">Active & Lobby Rooms</h2>
            <p className="mt-1 text-sm text-slate-300">
              Join running rooms instantly or hop into open lobbies.
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
          <p className="text-sm text-slate-300">Loading rooms...</p>
        ) : discoverRooms.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {discoverRooms.map((room) => (
              <article
                key={room.room_code}
                className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-400">Room</p>
                    <h3 className="font-mono text-lg font-semibold tracking-wider text-slate-100">
                      {room.room_code}
                    </h3>
                  </div>
                  <span
                    className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${roomStatusClass(room.status)}`}
                  >
                    {room.status}
                  </span>
                </div>

                <p className="mt-2 text-xs text-slate-400">{roomTimingText(room)}</p>

                <div className="mt-3 flex items-center gap-2 text-sm text-slate-200">
                  <AvatarBadge
                    name={room.host_nickname || "Host"}
                    avatarUrl={room.host_avatar_url}
                    size="sm"
                  />
                  <div>
                    <p className="font-medium text-slate-100">
                      {room.host_nickname || "Unknown Host"}
                    </p>
                    <p className="font-mono text-xs text-slate-400">
                      @{room.host_leetcode_username || "unknown"}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-300">
                  <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-1.5">
                    E {room.easy_count} · M {room.medium_count} · H {room.hard_count}
                  </div>
                  <div className="rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-1.5">
                    {room.participant_count} participants
                  </div>
                  <div className="col-span-2 rounded-lg border border-slate-700/60 bg-slate-900/40 px-2 py-1.5">
                    Source: {formatProblemSource(room.problem_source)}
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between gap-3">
                  <span className="text-xs text-slate-400">
                    {room.has_passcode ? "Passcode required" : "Open room"}
                  </span>
                  <button
                    type="button"
                    disabled={!room.joinable}
                    onClick={() => prefillJoinRoom(room.room_code)}
                    className="rounded-lg bg-emerald-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Join
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-300">No lobby or active rooms right now.</p>
        )}
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <article className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur">
          <h2 className="text-xl font-semibold text-slate-100">Create Room</h2>
          <p className="mt-1 text-sm text-slate-300">
            Configure difficulty mix, set a timer, and launch your race.
          </p>

          <form className="mt-5 space-y-4" onSubmit={handleCreateRoom}>
            <label className="block text-sm text-slate-200">
              Host Nickname
              <input
                required
                value={hostNickname}
                onChange={(e) => setHostNickname(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
              />
            </label>

            <label className="block text-sm text-slate-200">
              Host LeetCode Username
              <input
                required
                value={hostLeet}
                onChange={(e) => setHostLeet(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
              />
            </label>

            <div className="grid grid-cols-3 gap-3">
              <label className="col-span-3 block text-sm text-slate-200">
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
                  <option value="striver_sde_sheet">Striver SDE Sheet</option>
                </select>
              </label>

              <label className="block text-sm text-slate-200">
                Easy
                <input
                  type="number"
                  min={0}
                  max={10}
                  required
                  value={easyCount}
                  onChange={(e) => setEasyCount(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                />
              </label>
              <label className="block text-sm text-slate-200">
                Medium
                <input
                  type="number"
                  min={0}
                  max={10}
                  required
                  value={mediumCount}
                  onChange={(e) => setMediumCount(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                />
              </label>
              <label className="block text-sm text-slate-200">
                Hard
                <input
                  type="number"
                  min={0}
                  max={10}
                  required
                  value={hardCount}
                  onChange={(e) => setHardCount(Number(e.target.value))}
                  className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
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

            <label className="block text-sm text-slate-200">
              Duration (minutes)
              <input
                type="number"
                min={15}
                max={180}
                required
                value={durationMinutes}
                onChange={(e) => setDurationMinutes(Number(e.target.value))}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
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
              {createLoading ? "Creating..." : "Create & Enter Lobby"}
            </button>
          </form>
        </article>

        <article
          ref={joinSectionRef}
          className="rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6 shadow-xl shadow-slate-950/40 backdrop-blur"
        >
          <h2 className="text-xl font-semibold text-slate-100">Join Room</h2>
          <p className="mt-1 text-sm text-slate-300">
            Enter your details and jump straight into the room.
          </p>

          <form className="mt-5 space-y-4" onSubmit={handleJoinRoom}>
            <label className="block text-sm text-slate-200">
              Room Code
              <input
                ref={roomCodeInputRef}
                required
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 uppercase tracking-wider text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
                placeholder="ABC123"
              />
            </label>

            <label className="block text-sm text-slate-200">
              Nickname
              <input
                required
                value={joinNickname}
                onChange={(e) => setJoinNickname(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
              />
            </label>

            <label className="block text-sm text-slate-200">
              LeetCode Username
              <input
                required
                value={joinLeet}
                onChange={(e) => setJoinLeet(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
              />
            </label>

            <label className="block text-sm text-slate-200">
              Passcode (if required)
              <input
                value={joinPasscode}
                onChange={(e) => setJoinPasscode(e.target.value)}
                className="mt-1 w-full rounded-xl border border-slate-600/70 bg-slate-950/70 px-3 py-2 text-slate-100 outline-none ring-cyan-400/60 transition focus:ring-2"
              />
            </label>

            <button
              type="submit"
              disabled={joinLoading}
              className="w-full rounded-xl bg-emerald-400 px-4 py-2 font-semibold text-slate-900 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {joinLoading ? "Joining..." : "Join Room"}
            </button>
          </form>
        </article>
      </section>
    </main>
  );
}
