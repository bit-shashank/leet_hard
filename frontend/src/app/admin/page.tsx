"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/auth-provider";
import { InlineSpinner, PageLoader } from "@/components/loading";
import {
  ApiError,
  deleteAdminFeaturedRoom,
  listAdminFeaturedRooms,
  listAdminLogs,
  listAdminRooms,
  listAdminUsers,
  updateAdminRoom,
  updateAdminUser,
  upsertAdminFeaturedRoom,
} from "@/lib/api";
import { prettyDateTime } from "@/lib/format";
import type {
  AdminActionLogItem,
  AdminFeaturedRoomItem,
  AdminRoomItem,
  AdminUserItem,
  RoomStatus,
  UserAccountStatus,
  UserRole,
} from "@/lib/types";

const ROOM_STATUS_VALUES: RoomStatus[] = ["lobby", "active", "ended"];
const USER_ROLE_VALUES: UserRole[] = ["user", "admin"];
const ACCOUNT_STATUS_VALUES: UserAccountStatus[] = ["active", "restricted"];

type AdminTab = "featured" | "rooms" | "users" | "logs";

type RoomDraft = {
  room_title: string;
  status: RoomStatus;
  scheduled_start_at: string;
  is_joinable: boolean;
  featured_enabled: boolean;
  featured_priority: number;
};

type UserDraft = {
  role: UserRole;
  account_status: UserAccountStatus;
};

type FeaturedFormState = {
  room_code: string;
  priority: number;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
};

type LocalDateTimeParts = {
  date: string;
  time: string;
};

function parseApiError(error: unknown) {
  if (error instanceof ApiError) return error.message;
  return "Request failed. Please try again.";
}

function toLocalDateTimeInput(value: string | null) {
  if (!value) return "";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  const hours = String(parsed.getHours()).padStart(2, "0");
  const minutes = String(parsed.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function toIsoOrNull(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function splitLocalDateTime(value: string): LocalDateTimeParts {
  if (!value) return { date: "", time: "" };
  const [date = "", rawTime = ""] = value.split("T");
  const time = rawTime ? rawTime.slice(0, 5) : "";
  return { date, time };
}

function buildLocalDateTime(date: string, time: string) {
  if (!date) return "";
  const normalizedTime = time || "00:00";
  return `${date}T${normalizedTime}`;
}

type LocalDateTimeFieldProps = {
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  allowClear?: boolean;
};

function LocalDateTimeField({
  value,
  onChange,
  required = false,
  allowClear = false,
}: LocalDateTimeFieldProps) {
  const parts = splitLocalDateTime(value);

  return (
    <div className="mt-1 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          type="date"
          required={required}
          value={parts.date}
          onChange={(event) => onChange(buildLocalDateTime(event.target.value, parts.time))}
          className="w-full rounded-lg border border-slate-600/70 bg-white px-2 py-1.5 text-sm text-slate-900"
          style={{ colorScheme: "light" }}
        />
        <input
          type="time"
          required={required}
          value={parts.time}
          onChange={(event) => onChange(buildLocalDateTime(parts.date, event.target.value))}
          className="w-full rounded-lg border border-slate-600/70 bg-white px-2 py-1.5 text-sm text-slate-900"
          style={{ colorScheme: "light" }}
        />
      </div>
      {allowClear ? (
        <button
          type="button"
          onClick={() => onChange("")}
          className="rounded-lg border border-slate-500/60 px-2 py-1 text-xs text-slate-200 transition hover:bg-slate-800"
        >
          Clear
        </button>
      ) : null}
    </div>
  );
}

function roomHref(roomCode: string, roomStatus: RoomStatus) {
  const normalized = roomCode.toUpperCase();
  if (roomStatus === "active") return `/room/${normalized}`;
  if (roomStatus === "ended") return `/room/${normalized}/history`;
  return `/room/${normalized}/lobby`;
}

export default function AdminPage() {
  const { accessToken, authLoading, me, profileLoading, user } = useAuth();

  const [activeTab, setActiveTab] = useState<AdminTab>("featured");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [featuredStateFilter, setFeaturedStateFilter] = useState<"all" | "active" | "scheduled" | "expired">("all");
  const [featuredItems, setFeaturedItems] = useState<AdminFeaturedRoomItem[]>([]);
  const [featuredLoading, setFeaturedLoading] = useState(true);
  const [featuredSaving, setFeaturedSaving] = useState(false);
  const [featuredDeletingCode, setFeaturedDeletingCode] = useState<string | null>(null);
  const [featuredForm, setFeaturedForm] = useState<FeaturedFormState>({
    room_code: "",
    priority: 100,
    starts_at: "",
    ends_at: "",
    is_active: true,
  });

  const [roomSearch, setRoomSearch] = useState("");
  const [roomStatusSet, setRoomStatusSet] = useState<Set<RoomStatus>>(
    new Set<RoomStatus>(["lobby", "active", "ended"]),
  );
  const [rooms, setRooms] = useState<AdminRoomItem[]>([]);
  const [roomsLoading, setRoomsLoading] = useState(true);
  const [roomSavingCode, setRoomSavingCode] = useState<string | null>(null);
  const [roomDrafts, setRoomDrafts] = useState<Record<string, RoomDraft>>({});

  const [userSearch, setUserSearch] = useState("");
  const [userRoleFilter, setUserRoleFilter] = useState<"" | UserRole>("");
  const [userAccountFilter, setUserAccountFilter] = useState<"" | UserAccountStatus>("");
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userSavingId, setUserSavingId] = useState<string | null>(null);
  const [userDrafts, setUserDrafts] = useState<Record<string, UserDraft>>({});

  const [logs, setLogs] = useState<AdminActionLogItem[]>([]);
  const [logsLoading, setLogsLoading] = useState(true);

  const statusFilterCsv = useMemo(() => {
    const values = Array.from(roomStatusSet.values());
    return values.length ? values.join(",") : "lobby,active,ended";
  }, [roomStatusSet]);

  const loadFeatured = useCallback(async () => {
    if (!accessToken) return;
    setFeaturedLoading(true);
    try {
      const data = await listAdminFeaturedRooms(accessToken, featuredStateFilter);
      setFeaturedItems(data);
    } finally {
      setFeaturedLoading(false);
    }
  }, [accessToken, featuredStateFilter]);

  const loadRooms = useCallback(async () => {
    if (!accessToken) return;
    setRoomsLoading(true);
    try {
      const data = await listAdminRooms(accessToken, {
        statuses: statusFilterCsv,
        search: roomSearch.trim() || undefined,
        limit: 200,
      });
      setRooms(data);
      const drafts: Record<string, RoomDraft> = {};
      for (const room of data) {
        drafts[room.room_code] = {
          room_title: room.room_title,
          status: room.status,
          scheduled_start_at: toLocalDateTimeInput(room.scheduled_start_at),
          is_joinable: room.is_joinable,
          featured_enabled: room.is_featured || room.featured_priority != null,
          featured_priority: room.featured_priority ?? 100,
        };
      }
      setRoomDrafts(drafts);
    } finally {
      setRoomsLoading(false);
    }
  }, [accessToken, roomSearch, statusFilterCsv]);

  const loadUsers = useCallback(async () => {
    if (!accessToken) return;
    setUsersLoading(true);
    try {
      const data = await listAdminUsers(accessToken, {
        search: userSearch.trim() || undefined,
        role: userRoleFilter || undefined,
        account_status: userAccountFilter || undefined,
        limit: 200,
      });
      setUsers(data);
      const drafts: Record<string, UserDraft> = {};
      for (const account of data) {
        drafts[account.id] = {
          role: account.role,
          account_status: account.account_status,
        };
      }
      setUserDrafts(drafts);
    } finally {
      setUsersLoading(false);
    }
  }, [accessToken, userAccountFilter, userRoleFilter, userSearch]);

  const loadLogs = useCallback(async () => {
    if (!accessToken) return;
    setLogsLoading(true);
    try {
      const data = await listAdminLogs(accessToken, { limit: 100 });
      setLogs(data);
    } finally {
      setLogsLoading(false);
    }
  }, [accessToken]);

  const loadAll = useCallback(async () => {
    if (!accessToken) return;
    setError(null);
    try {
      await Promise.all([loadFeatured(), loadRooms(), loadUsers(), loadLogs()]);
    } catch (err) {
      setError(parseApiError(err));
    }
  }, [accessToken, loadFeatured, loadLogs, loadRooms, loadUsers]);

  useEffect(() => {
    if (!accessToken || me?.role !== "admin") return;
    void loadAll();
  }, [accessToken, loadAll, me?.role]);

  useEffect(() => {
    if (!accessToken || me?.role !== "admin") return;
    void loadFeatured();
  }, [accessToken, loadFeatured, me?.role]);

  async function handleUpsertFeatured(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) return;

    const roomCode = featuredForm.room_code.trim().toUpperCase();
    if (!roomCode) {
      setError("Room code is required.");
      return;
    }

    setFeaturedSaving(true);
    setError(null);
    setNotice(null);
    try {
      await upsertAdminFeaturedRoom(accessToken, {
        room_code: roomCode,
        priority: Math.max(1, featuredForm.priority),
        starts_at: toIsoOrNull(featuredForm.starts_at),
        ends_at: toIsoOrNull(featuredForm.ends_at),
        is_active: featuredForm.is_active,
      });
      setNotice(`Featured settings saved for ${roomCode}.`);
      await Promise.all([loadFeatured(), loadRooms(), loadLogs()]);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setFeaturedSaving(false);
    }
  }

  async function handleDeleteFeatured(roomCode: string) {
    if (!accessToken) return;
    setFeaturedDeletingCode(roomCode);
    setError(null);
    setNotice(null);
    try {
      await deleteAdminFeaturedRoom(accessToken, roomCode);
      setNotice(`Removed featured entry for ${roomCode}.`);
      await Promise.all([loadFeatured(), loadRooms(), loadLogs()]);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setFeaturedDeletingCode(null);
    }
  }

  async function handleSaveRoom(roomCode: string) {
    if (!accessToken) return;
    const draft = roomDrafts[roomCode];
    if (!draft) return;

    setRoomSavingCode(roomCode);
    setError(null);
    setNotice(null);
    try {
      await updateAdminRoom(accessToken, roomCode, {
        room_title: draft.room_title,
        status: draft.status,
        scheduled_start_at: toIsoOrNull(draft.scheduled_start_at),
        is_joinable: draft.is_joinable,
      });

      if (draft.featured_enabled) {
        await upsertAdminFeaturedRoom(accessToken, {
          room_code: roomCode,
          priority: Math.max(1, draft.featured_priority || 1),
          is_active: true,
        });
      } else {
        try {
          await deleteAdminFeaturedRoom(accessToken, roomCode);
        } catch (err) {
          // Ignore "not found" so rooms without featured rows can still save cleanly.
          if (!(err instanceof ApiError) || err.status !== 404) {
            throw err;
          }
        }
      }

      setNotice(`Saved room ${roomCode}.`);
      await Promise.all([loadRooms(), loadLogs()]);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setRoomSavingCode(null);
    }
  }

  async function handleSaveUser(userId: string) {
    if (!accessToken) return;
    const draft = userDrafts[userId];
    if (!draft) return;

    setUserSavingId(userId);
    setError(null);
    setNotice(null);
    try {
      await updateAdminUser(accessToken, userId, {
        role: draft.role,
        account_status: draft.account_status,
      });
      setNotice(`Saved user ${userId}.`);
      await Promise.all([loadUsers(), loadLogs()]);
    } catch (err) {
      setError(parseApiError(err));
    } finally {
      setUserSavingId(null);
    }
  }

  function toggleRoomStatusFilter(status: RoomStatus) {
    setRoomStatusSet((prev) => {
      const next = new Set(prev);
      if (next.has(status)) {
        next.delete(status);
      } else {
        next.add(status);
      }
      return next;
    });
  }

  if (authLoading || profileLoading) {
    return <PageLoader title="Loading admin portal..." subtitle="Checking access permissions." />;
  }

  if (!user || !accessToken) {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-amber-300/30 bg-amber-500/10 p-6 text-amber-100">
          Please sign in to access the admin portal.
        </div>
      </main>
    );
  }

  if (!me || me.role !== "admin") {
    return (
      <main className="mx-auto min-h-screen w-full max-w-3xl px-4 py-16 md:px-8">
        <div className="rounded-2xl border border-rose-300/30 bg-rose-500/10 p-6 text-rose-100">
          You do not have admin access.
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl space-y-6 px-4 py-8 md:px-8">
      <header className="rounded-2xl border border-fuchsia-300/20 bg-slate-900/65 p-6 backdrop-blur">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-50">Admin Portal</h1>
        <p className="mt-2 text-sm text-slate-300">
          Manage featured rooms, room moderation, user roles, and audit logs.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-rose-300/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-emerald-300/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-100">
          {notice}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {[
          { key: "featured" as const, label: "Featured Rooms" },
          { key: "rooms" as const, label: "Rooms" },
          { key: "users" as const, label: "Users" },
          { key: "logs" as const, label: "Logs" },
        ].map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              activeTab === tab.key
                ? "border-fuchsia-300/50 bg-fuchsia-500/15 text-fuchsia-100"
                : "border-slate-600/70 bg-slate-900/40 text-slate-300 hover:bg-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => void loadAll()}
          className="ml-auto rounded-lg border border-slate-500/60 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800"
        >
          Refresh All
        </button>
      </div>

      {activeTab === "featured" ? (
        <section className="space-y-4 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold text-slate-100">Featured Rooms</h2>
            <div className="flex items-center gap-2 text-sm">
              <span className="text-slate-300">Filter</span>
              <select
                value={featuredStateFilter}
                onChange={(event) => setFeaturedStateFilter(event.target.value as typeof featuredStateFilter)}
                className="rounded-lg border border-slate-600/70 bg-slate-950/70 px-2 py-1 text-slate-100"
              >
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="scheduled">Scheduled</option>
                <option value="expired">Expired</option>
              </select>
            </div>
          </div>

          <form className="grid gap-3 rounded-xl border border-slate-700/60 bg-slate-950/40 p-4 md:grid-cols-2 xl:grid-cols-5" onSubmit={handleUpsertFeatured}>
            <label className="text-xs text-slate-300">
              Room Code
              <input
                value={featuredForm.room_code}
                onChange={(event) =>
                  setFeaturedForm((prev) => ({ ...prev, room_code: event.target.value.toUpperCase() }))
                }
                className="mt-1 w-full rounded-lg border border-slate-600/70 bg-slate-950/80 px-2 py-1.5 text-sm text-slate-100"
                placeholder="ABCD12"
                required
              />
            </label>
            <label className="text-xs text-slate-300">
              Priority
              <input
                type="number"
                min={1}
                value={featuredForm.priority}
                onChange={(event) =>
                  setFeaturedForm((prev) => ({ ...prev, priority: Number(event.target.value || 1) }))
                }
                className="mt-1 w-full rounded-lg border border-slate-600/70 bg-slate-950/80 px-2 py-1.5 text-sm text-slate-100"
              />
            </label>
            <label className="text-xs text-slate-300">
              Starts At (optional)
              <LocalDateTimeField
                value={featuredForm.starts_at}
                onChange={(next) => setFeaturedForm((prev) => ({ ...prev, starts_at: next }))}
                allowClear
              />
            </label>
            <label className="text-xs text-slate-300">
              Ends At (optional)
              <LocalDateTimeField
                value={featuredForm.ends_at}
                onChange={(next) => setFeaturedForm((prev) => ({ ...prev, ends_at: next }))}
                allowClear
              />
            </label>
            <div className="flex items-end gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-300">
                <input
                  type="checkbox"
                  checked={featuredForm.is_active}
                  onChange={(event) =>
                    setFeaturedForm((prev) => ({ ...prev, is_active: event.target.checked }))
                  }
                />
                Active
              </label>
              <button
                type="submit"
                disabled={featuredSaving}
                className="rounded-lg bg-fuchsia-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {featuredSaving ? (
                  <span className="inline-flex items-center gap-2">
                    <InlineSpinner className="h-3.5 w-3.5" label="Saving featured room" />
                    Saving...
                  </span>
                ) : (
                  "Save"
                )}
              </button>
            </div>
          </form>

          {featuredLoading ? (
            <p className="text-sm text-slate-300">Loading featured rooms...</p>
          ) : featuredItems.length ? (
            <div className="space-y-3">
              {featuredItems.map((item) => (
                <article
                  key={`${item.room_code}-${item.starts_at || "none"}-${item.ends_at || "none"}`}
                  className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs uppercase text-slate-400">{item.room_code}</p>
                      <h3 className="text-lg font-semibold text-slate-100">{item.room_title}</h3>
                      <p className="mt-1 text-xs text-slate-300">
                        Status: {item.room_status} · Priority: {item.priority}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Window: {item.starts_at ? prettyDateTime(item.starts_at) : "Immediate"} to{" "}
                        {item.ends_at ? prettyDateTime(item.ends_at) : "No expiry"}
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        Current: {item.is_currently_featured ? "Featured" : "Not active in window"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleDeleteFeatured(item.room_code)}
                      disabled={featuredDeletingCode === item.room_code}
                      className="rounded-lg border border-rose-300/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-100 transition hover:bg-rose-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {featuredDeletingCode === item.room_code ? "Removing..." : "Remove"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-300">No featured room entries for this filter.</p>
          )}
        </section>
      ) : null}

      {activeTab === "rooms" ? (
        <section className="space-y-4 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold text-slate-100">Rooms Manager</h2>
            <input
              value={roomSearch}
              onChange={(event) => setRoomSearch(event.target.value)}
              placeholder="Search code/title"
              className="rounded-lg border border-slate-600/70 bg-slate-950/70 px-3 py-1.5 text-sm text-slate-100"
            />
            <button
              type="button"
              onClick={() => void loadRooms()}
              className="rounded-lg border border-slate-500/60 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800"
            >
              Search
            </button>
            <div className="ml-auto flex flex-wrap gap-2 text-xs">
              {ROOM_STATUS_VALUES.map((statusValue) => (
                <label
                  key={statusValue}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-600/70 bg-slate-950/40 px-2 py-1 text-slate-300"
                >
                  <input
                    type="checkbox"
                    checked={roomStatusSet.has(statusValue)}
                    onChange={() => toggleRoomStatusFilter(statusValue)}
                  />
                  {statusValue}
                </label>
              ))}
            </div>
          </div>

          {roomsLoading ? (
            <p className="text-sm text-slate-300">Loading rooms...</p>
          ) : rooms.length ? (
            <div className="space-y-3">
              {rooms.map((room) => {
                const draft = roomDrafts[room.room_code];
                if (!draft) return null;
                const saving = roomSavingCode === room.room_code;
                return (
                  <article key={room.room_code} className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
                    <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-mono text-xs uppercase text-slate-400">{room.room_code}</p>
                        <p className="text-xs text-slate-400">
                          Participants: {room.participant_count} · Created {prettyDateTime(room.created_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {room.is_featured ? (
                          <span className="rounded-full border border-amber-300/30 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold uppercase text-amber-100">
                            Featured #{room.featured_priority ?? "?"}
                          </span>
                        ) : null}
                        <Link
                          href={roomHref(room.room_code, draft.status)}
                          className="rounded-lg border border-cyan-300/30 px-2 py-1 text-xs text-cyan-200 transition hover:bg-cyan-500/10"
                        >
                          Open
                        </Link>
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                      <label className="text-xs text-slate-300 xl:col-span-2">
                        Title
                        <input
                          value={draft.room_title}
                          onChange={(event) =>
                            setRoomDrafts((prev) => ({
                              ...prev,
                              [room.room_code]: { ...prev[room.room_code], room_title: event.target.value },
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-slate-600/70 bg-slate-950/80 px-2 py-1.5 text-sm text-slate-100"
                        />
                      </label>

                      <label className="text-xs text-slate-300">
                        Status
                        <select
                          value={draft.status}
                          onChange={(event) =>
                            setRoomDrafts((prev) => ({
                              ...prev,
                              [room.room_code]: {
                                ...prev[room.room_code],
                                status: event.target.value as RoomStatus,
                              },
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-slate-600/70 bg-slate-950/80 px-2 py-1.5 text-sm text-slate-100"
                        >
                          {ROOM_STATUS_VALUES.map((value) => (
                            <option key={value} value={value}>
                              {value}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="text-xs text-slate-300">
                        Scheduled Start
                        <LocalDateTimeField
                          value={draft.scheduled_start_at}
                          onChange={(next) =>
                            setRoomDrafts((prev) => ({
                              ...prev,
                              [room.room_code]: {
                                ...prev[room.room_code],
                                scheduled_start_at: next,
                              },
                            }))
                          }
                          required
                        />
                      </label>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-4">
                        <label className="inline-flex items-center gap-2 text-sm text-slate-200">
                          <input
                            type="checkbox"
                            checked={draft.is_joinable}
                            onChange={(event) =>
                              setRoomDrafts((prev) => ({
                                ...prev,
                                [room.room_code]: {
                                  ...prev[room.room_code],
                                  is_joinable: event.target.checked,
                                },
                              }))
                            }
                          />
                          Joinable
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm text-amber-100">
                          <input
                            type="checkbox"
                            checked={draft.featured_enabled}
                            onChange={(event) =>
                              setRoomDrafts((prev) => ({
                                ...prev,
                                [room.room_code]: {
                                  ...prev[room.room_code],
                                  featured_enabled: event.target.checked,
                                },
                              }))
                            }
                          />
                          Featured
                        </label>
                        <label className="inline-flex items-center gap-2 text-sm text-slate-300">
                          Priority
                          <input
                            type="number"
                            min={1}
                            value={draft.featured_priority}
                            disabled={!draft.featured_enabled}
                            onChange={(event) =>
                              setRoomDrafts((prev) => ({
                                ...prev,
                                [room.room_code]: {
                                  ...prev[room.room_code],
                                  featured_priority: Number(event.target.value || 1),
                                },
                              }))
                            }
                            className="w-20 rounded-lg border border-slate-600/70 bg-slate-950/80 px-2 py-1 text-sm text-slate-100 disabled:opacity-50"
                          />
                        </label>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleSaveRoom(room.room_code)}
                        disabled={saving}
                        className="rounded-lg bg-cyan-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saving ? "Saving..." : "Save Room"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-300">No rooms matched your filters.</p>
          )}
        </section>
      ) : null}

      {activeTab === "users" ? (
        <section className="space-y-4 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-semibold text-slate-100">Users Manager</h2>
            <input
              value={userSearch}
              onChange={(event) => setUserSearch(event.target.value)}
              placeholder="Search email, name, username"
              className="rounded-lg border border-slate-600/70 bg-slate-950/70 px-3 py-1.5 text-sm text-slate-100"
            />
            <select
              value={userRoleFilter}
              onChange={(event) => setUserRoleFilter(event.target.value as "" | UserRole)}
              className="rounded-lg border border-slate-600/70 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="">All roles</option>
              {USER_ROLE_VALUES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <select
              value={userAccountFilter}
              onChange={(event) =>
                setUserAccountFilter(event.target.value as "" | UserAccountStatus)
              }
              className="rounded-lg border border-slate-600/70 bg-slate-950/70 px-2 py-1.5 text-sm text-slate-100"
            >
              <option value="">All account states</option>
              {ACCOUNT_STATUS_VALUES.map((statusValue) => (
                <option key={statusValue} value={statusValue}>
                  {statusValue}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void loadUsers()}
              className="rounded-lg border border-slate-500/60 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800"
            >
              Search
            </button>
          </div>

          {usersLoading ? (
            <p className="text-sm text-slate-300">Loading users...</p>
          ) : users.length ? (
            <div className="space-y-3">
              {users.map((account) => {
                const draft = userDrafts[account.id];
                if (!draft) return null;
                const saving = userSavingId === account.id;
                return (
                  <article key={account.id} className="rounded-xl border border-slate-700/60 bg-slate-950/40 p-4">
                    <div className="mb-2">
                      <p className="text-sm font-semibold text-slate-100">{account.display_name || "(No name)"}</p>
                      <p className="text-xs text-slate-400">{account.email || "No email"}</p>
                      <p className="font-mono text-xs text-slate-500">{account.id}</p>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="text-xs text-slate-300">
                        <p>LeetCode</p>
                        <p className="mt-1 text-sm text-slate-100">
                          {account.primary_leetcode_username || "Not set"}
                        </p>
                      </div>
                      <label className="text-xs text-slate-300">
                        Role
                        <select
                          value={draft.role}
                          onChange={(event) =>
                            setUserDrafts((prev) => ({
                              ...prev,
                              [account.id]: {
                                ...prev[account.id],
                                role: event.target.value as UserRole,
                              },
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-slate-600/70 bg-slate-950/80 px-2 py-1.5 text-sm text-slate-100"
                        >
                          {USER_ROLE_VALUES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="text-xs text-slate-300">
                        Account Status
                        <select
                          value={draft.account_status}
                          onChange={(event) =>
                            setUserDrafts((prev) => ({
                              ...prev,
                              [account.id]: {
                                ...prev[account.id],
                                account_status: event.target.value as UserAccountStatus,
                              },
                            }))
                          }
                          className="mt-1 w-full rounded-lg border border-slate-600/70 bg-slate-950/80 px-2 py-1.5 text-sm text-slate-100"
                        >
                          {ACCOUNT_STATUS_VALUES.map((statusValue) => (
                            <option key={statusValue} value={statusValue}>
                              {statusValue}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="mt-3 flex justify-end">
                      <button
                        type="button"
                        onClick={() => void handleSaveUser(account.id)}
                        disabled={saving}
                        className="rounded-lg bg-cyan-400 px-3 py-1.5 text-sm font-semibold text-slate-900 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {saving ? "Saving..." : "Save User"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-slate-300">No users matched your filters.</p>
          )}
        </section>
      ) : null}

      {activeTab === "logs" ? (
        <section className="space-y-4 rounded-2xl border border-slate-700/50 bg-slate-900/70 p-6">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-xl font-semibold text-slate-100">Admin Action Logs</h2>
            <button
              type="button"
              onClick={() => void loadLogs()}
              className="rounded-lg border border-slate-500/60 px-3 py-1.5 text-sm text-slate-200 transition hover:bg-slate-800"
            >
              Refresh Logs
            </button>
          </div>

          {logsLoading ? (
            <p className="text-sm text-slate-300">Loading logs...</p>
          ) : logs.length ? (
            <div className="space-y-2">
              {logs.map((entry) => (
                <article key={entry.id} className="rounded-lg border border-slate-700/60 bg-slate-950/40 p-3">
                  <p className="text-xs text-slate-400">{prettyDateTime(entry.created_at)}</p>
                  <p className="text-sm text-slate-100">
                    <span className="font-semibold">{entry.action}</span> on {entry.resource_type}
                    {entry.resource_id ? ` (${entry.resource_id})` : ""}
                  </p>
                  <p className="text-xs text-slate-400">
                    Actor: {entry.actor_email || entry.actor_user_id || "unknown"}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-300">No admin logs yet.</p>
          )}
        </section>
      ) : null}
    </main>
  );
}
