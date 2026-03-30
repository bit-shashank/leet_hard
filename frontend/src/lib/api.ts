import type {
  AdminActionLogItem,
  AdminFeaturedRoomItem,
  AdminFeaturedRoomUpsertRequest,
  AdminRoomItem,
  AdminRoomUpdateRequest,
  AdminUserItem,
  AdminUserUpdateRequest,
  CreateRoomRequest,
  CreateRoomResponse,
  ChatMessageInput,
  DashboardResponse,
  DiscoverRoomResponse,
  HistoryResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  MeResponse,
  OnboardingStartRequest,
  OnboardingStartResponse,
  OnboardingVerifyRequest,
  OnboardingVerifyResponse,
  RecentAcceptedSubmission,
  RoomStateResponse,
  RoomFeedEvent,
  RoomFeedResponse,
  TopicInfo,
  UpdateMeRequest,
  UpdateRoomSettingsRequest,
  UpdateRoomSettingsResponse,
} from "@/lib/types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ||
  "http://localhost:8000";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function request<T>(
  path: string,
  opts?: {
    method?: string;
    body?: unknown;
    accessToken?: string | null;
  },
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: opts?.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts?.accessToken ? { Authorization: `Bearer ${opts.accessToken}` } : {}),
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const payload = (await response.json()) as { detail?: string };
      if (payload.detail) detail = payload.detail;
    } catch {
      // no-op
    }
    throw new ApiError(detail, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function createRoom(payload: CreateRoomRequest, accessToken: string) {
  return request<CreateRoomResponse>("/api/v1/rooms", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function getDiscoverRooms(
  statuses = "lobby,active",
  opts?: { accessToken?: string | null; limit?: number },
) {
  const query = new URLSearchParams({
    statuses,
    limit: String(opts?.limit ?? 12),
  });
  return request<DiscoverRoomResponse[]>(`/api/v1/rooms/discover?${query.toString()}`, {
    accessToken: opts?.accessToken,
  });
}

export function getRoomTopics() {
  return request<TopicInfo[]>("/api/v1/rooms/topics");
}

export function joinRoom(roomCode: string, payload: JoinRoomRequest, accessToken: string) {
  return request<JoinRoomResponse>(`/api/v1/rooms/${roomCode}/join`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function leaveRoom(roomCode: string, accessToken: string) {
  return request<void>(`/api/v1/rooms/${roomCode}/leave`, {
    method: "DELETE",
    accessToken,
  });
}

export function startRoom(roomCode: string, accessToken: string) {
  return request<{ room: RoomStateResponse["room"] }>(
    `/api/v1/rooms/${roomCode}/start`,
    {
      method: "POST",
      accessToken,
    },
  );
}

export function updateRoomSettings(
  roomCode: string,
  accessToken: string,
  payload: UpdateRoomSettingsRequest,
) {
  return request<UpdateRoomSettingsResponse>(`/api/v1/rooms/${roomCode}/settings`, {
    method: "PATCH",
    accessToken,
    body: payload,
  });
}

export function getRoomState(roomCode: string, accessToken: string) {
  return request<RoomStateResponse>(`/api/v1/rooms/${roomCode}/state`, {
    accessToken,
  });
}

export function getRoomFeed(
  roomCode: string,
  accessToken: string,
  opts?: { cursor?: string | null; limit?: number },
) {
  const query = new URLSearchParams();
  if (opts?.cursor) query.set("cursor", opts.cursor);
  if (opts?.limit) query.set("limit", String(opts.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<RoomFeedResponse>(`/api/v1/rooms/${roomCode}/feed${suffix}`, {
    accessToken,
  });
}

export function sendRoomMessage(
  roomCode: string,
  payload: ChatMessageInput,
  accessToken: string,
) {
  return request<RoomFeedEvent>(`/api/v1/rooms/${roomCode}/messages`, {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function toggleManualSolve(
  roomCode: string,
  accessToken: string,
  payload: { problem_slug: string; solved: boolean },
) {
  return request<{ ok: boolean }>(`/api/v1/rooms/${roomCode}/solves/manual`, {
    method: "POST",
    accessToken,
    body: payload,
  });
}

export function getRoomHistory(roomCode: string, accessToken: string) {
  return request<HistoryResponse>(`/api/v1/rooms/${roomCode}/history`, {
    accessToken,
  });
}

export function getMe(accessToken: string) {
  return request<MeResponse>("/api/v1/me", {
    accessToken,
  });
}

export function updateMe(payload: UpdateMeRequest, accessToken: string) {
  return request<MeResponse>("/api/v1/me", {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function deleteMe(accessToken: string) {
  return request<void>("/api/v1/me", {
    method: "DELETE",
    accessToken,
  });
}

export function getDashboard(accessToken: string) {
  return request<DashboardResponse>("/api/v1/me/dashboard", {
    accessToken,
  });
}

export function getMySubmissions(accessToken: string, opts?: { limit?: number }) {
  const query = new URLSearchParams();
  if (opts?.limit) query.set("limit", String(opts.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<RecentAcceptedSubmission[]>(`/api/v1/me/submissions${suffix}`, {
    accessToken,
  });
}

export function startOnboarding(
  payload: OnboardingStartRequest,
  accessToken: string,
) {
  return request<OnboardingStartResponse>("/api/v1/me/onboarding/start", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function verifyOnboarding(
  accessToken: string,
  payload?: OnboardingVerifyRequest,
) {
  return request<OnboardingVerifyResponse>("/api/v1/me/onboarding/verify", {
    method: "POST",
    body: payload ?? {},
    accessToken,
  });
}

export function listAdminFeaturedRooms(
  accessToken: string,
  state: "all" | "active" | "scheduled" | "expired" = "all",
) {
  return request<AdminFeaturedRoomItem[]>(`/api/v1/admin/featured-rooms?state=${state}`, {
    accessToken,
  });
}

export function upsertAdminFeaturedRoom(
  accessToken: string,
  payload: AdminFeaturedRoomUpsertRequest,
) {
  return request<AdminFeaturedRoomItem>("/api/v1/admin/featured-rooms", {
    method: "POST",
    body: payload,
    accessToken,
  });
}

export function deleteAdminFeaturedRoom(accessToken: string, roomCode: string) {
  return request<void>(`/api/v1/admin/featured-rooms/${roomCode}`, {
    method: "DELETE",
    accessToken,
  });
}

export function listAdminRooms(
  accessToken: string,
  opts?: {
    statuses?: string;
    search?: string;
    created_from?: string;
    created_to?: string;
    limit?: number;
  },
) {
  const query = new URLSearchParams();
  if (opts?.statuses) query.set("statuses", opts.statuses);
  if (opts?.search) query.set("search", opts.search);
  if (opts?.created_from) query.set("created_from", opts.created_from);
  if (opts?.created_to) query.set("created_to", opts.created_to);
  if (opts?.limit) query.set("limit", String(opts.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<AdminRoomItem[]>(`/api/v1/admin/rooms${suffix}`, { accessToken });
}

export function updateAdminRoom(
  accessToken: string,
  roomCode: string,
  payload: AdminRoomUpdateRequest,
) {
  return request<AdminRoomItem>(`/api/v1/admin/rooms/${roomCode}`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function listAdminUsers(
  accessToken: string,
  opts?: {
    search?: string;
    role?: "user" | "admin";
    account_status?: "active" | "restricted";
    limit?: number;
  },
) {
  const query = new URLSearchParams();
  if (opts?.search) query.set("search", opts.search);
  if (opts?.role) query.set("role", opts.role);
  if (opts?.account_status) query.set("account_status", opts.account_status);
  if (opts?.limit) query.set("limit", String(opts.limit));
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<AdminUserItem[]>(`/api/v1/admin/users${suffix}`, { accessToken });
}

export function updateAdminUser(
  accessToken: string,
  userId: string,
  payload: AdminUserUpdateRequest,
) {
  return request<AdminUserItem>(`/api/v1/admin/users/${userId}`, {
    method: "PATCH",
    body: payload,
    accessToken,
  });
}

export function listAdminLogs(
  accessToken: string,
  opts?: {
    limit?: number;
    action?: string;
    resource_type?: string;
  },
) {
  const query = new URLSearchParams();
  if (opts?.limit) query.set("limit", String(opts.limit));
  if (opts?.action) query.set("action", opts.action);
  if (opts?.resource_type) query.set("resource_type", opts.resource_type);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<AdminActionLogItem[]>(`/api/v1/admin/logs${suffix}`, { accessToken });
}
