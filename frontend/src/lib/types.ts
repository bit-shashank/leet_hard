export type RoomStatus = "lobby" | "active" | "ended";
export type ProblemSource =
  | "random"
  | "neetcode_150"
  | "neetcode_250"
  | "blind_75"
  | "striver_sde_sheet";

export type RoomPublic = {
  id: string;
  room_code: string;
  status: RoomStatus;
  problem_source: ProblemSource;
  problem_count: number;
  easy_count: number;
  medium_count: number;
  hard_count: number;
  duration_minutes: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  has_passcode: boolean;
  sync_warning: string | null;
};

export type ParticipantPublic = {
  id: string;
  nickname: string;
  leetcode_username: string;
  avatar_url: string | null;
  is_host: boolean;
  joined_at: string;
};

export type ProblemPublic = {
  title_slug: string;
  title: string;
  frontend_id: string | null;
  url: string;
  difficulty: string;
  sort_order: number;
};

export type LeaderboardEntry = {
  rank: number;
  participant_id: string;
  nickname: string;
  leetcode_username: string;
  avatar_url: string | null;
  is_host: boolean;
  solved_count: number;
  last_solved_at: string | null;
};

export type RoomStateResponse = {
  room: RoomPublic;
  participants: ParticipantPublic[];
  problems: ProblemPublic[];
  leaderboard: LeaderboardEntry[];
  my_participant_id: string | null;
  my_solved_slugs: string[];
  server_time: string;
};

export type CreateRoomRequest = {
  host_nickname: string;
  host_leetcode_username: string;
  settings: {
    problem_count?: number;
    problem_source: ProblemSource;
    easy_count: number;
    medium_count: number;
    hard_count: number;
    duration_minutes: number;
    passcode?: string;
  };
};

export type JoinRoomRequest = {
  nickname: string;
  leetcode_username: string;
  passcode?: string;
};

export type CreateRoomResponse = {
  room: RoomPublic;
  participant: ParticipantPublic;
  participant_token: string;
};

export type JoinRoomResponse = {
  room: RoomPublic;
  participant: ParticipantPublic;
  participant_token: string;
};

export type HistoryEvent = {
  participant_id: string;
  participant_nickname: string;
  problem_slug: string;
  event_type: "marked_solved" | "unmarked" | "auto_detected";
  source: "auto" | "manual";
  event_at: string;
};

export type HistoryResponse = {
  room: RoomPublic;
  problems: ProblemPublic[];
  leaderboard: LeaderboardEntry[];
  events: HistoryEvent[];
};

export type DiscoverRoomResponse = {
  room_code: string;
  status: RoomStatus;
  problem_source: ProblemSource;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  has_passcode: boolean;
  easy_count: number;
  medium_count: number;
  hard_count: number;
  participant_count: number;
  host_nickname: string | null;
  host_leetcode_username: string | null;
  host_avatar_url: string | null;
  joinable: boolean;
};
