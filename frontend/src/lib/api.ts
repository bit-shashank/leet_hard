import type {
  CreateRoomRequest,
  CreateRoomResponse,
  DiscoverRoomResponse,
  HistoryResponse,
  JoinRoomRequest,
  JoinRoomResponse,
  RoomStateResponse,
} from "@/lib/types";

const API_BASE =
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
    token?: string | null;
  },
): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: opts?.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(opts?.token ? { Authorization: `Bearer ${opts.token}` } : {}),
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

  return (await response.json()) as T;
}

export function createRoom(payload: CreateRoomRequest) {
  return request<CreateRoomResponse>("/api/v1/rooms", {
    method: "POST",
    body: payload,
  });
}

export function getDiscoverRooms(statuses = "lobby,active") {
  const query = new URLSearchParams({ statuses });
  return request<DiscoverRoomResponse[]>(`/api/v1/rooms/discover?${query.toString()}`);
}

export function joinRoom(roomCode: string, payload: JoinRoomRequest) {
  return request<JoinRoomResponse>(`/api/v1/rooms/${roomCode}/join`, {
    method: "POST",
    body: payload,
  });
}

export function startRoom(roomCode: string, token: string) {
  return request<{ room: RoomStateResponse["room"] }>(
    `/api/v1/rooms/${roomCode}/start`,
    {
      method: "POST",
      token,
    },
  );
}

export function getRoomState(roomCode: string, token?: string | null) {
  return request<RoomStateResponse>(`/api/v1/rooms/${roomCode}/state`, {
    token,
  });
}

export function toggleManualSolve(
  roomCode: string,
  token: string,
  payload: { problem_slug: string; solved: boolean },
) {
  return request<{ ok: boolean }>(`/api/v1/rooms/${roomCode}/solves/manual`, {
    method: "POST",
    token,
    body: payload,
  });
}

export function getRoomHistory(roomCode: string) {
  return request<HistoryResponse>(`/api/v1/rooms/${roomCode}/history`);
}
