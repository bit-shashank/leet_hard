export type RoomStatus = "lobby" | "active" | "ended";
export type SolveSource = "auto" | "manual";
export type ProblemSource =
  | "random"
  | "neetcode_150"
  | "neetcode_250"
  | "blind_75"
  | "striver_a2z_sheet"
  | "striver_sde_sheet";

export type RoomPublic = {
  id: string;
  room_code: string;
  room_title: string;
  status: RoomStatus;
  problem_source: ProblemSource;
  problem_count: number;
  easy_count: number;
  medium_count: number;
  hard_count: number;
  exclude_pre_solved: boolean;
  strict_check: boolean;
  duration_minutes: number;
  scheduled_start_at: string;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  has_passcode: boolean;
  sync_warning: string | null;
  topic_slugs: string[];
};

export type ParticipantPublic = {
  id: string;
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

export type RoomLiveRoomPublic = {
  status: RoomStatus;
  starts_at: string | null;
  ends_at: string | null;
  duration_minutes: number;
  sync_warning: string | null;
};

export type RoomLiveState = {
  room: RoomLiveRoomPublic;
  leaderboard: LeaderboardEntry[];
  my_solved_slugs: string[];
  server_time: string;
};

export type CreateRoomRequest = {
  room_title: string;
  settings: {
    problem_count?: number;
    problem_source: ProblemSource;
    easy_count: number;
    medium_count: number;
    hard_count: number;
    exclude_pre_solved: boolean;
    strict_check: boolean;
    duration_minutes: number;
    start_at: string;
    passcode?: string;
    topic_slugs?: string[];
  };
};

export type JoinRoomRequest = {
  passcode?: string;
};

export type CreateRoomResponse = {
  room: RoomPublic;
  participant: ParticipantPublic;
};

export type JoinRoomResponse = {
  room: RoomPublic;
  participant: ParticipantPublic;
};

export type HistoryEvent = {
  participant_id: string;
  participant_leetcode_username: string;
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
  room_title: string;
  status: RoomStatus;
  problem_source: ProblemSource;
  scheduled_start_at: string;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  has_passcode: boolean;
  easy_count: number;
  medium_count: number;
  hard_count: number;
  participant_count: number;
  host_leetcode_username: string | null;
  host_avatar_url: string | null;
  joinable: boolean;
};

export type TopicInfo = {
  slug: string;
  name: string;
  count: number;
};

export type UpdateRoomSettingsRequest = {
  room_title: string;
  settings: CreateRoomRequest["settings"];
};

export type UpdateRoomSettingsResponse = {
  room: RoomPublic;
};

export type ChatMessageInput = {
  content: string;
};

export type RoomFeedEventType = "chat" | "solve" | "join" | "leave";

export type RoomFeedEvent = {
  id: string;
  event_type: RoomFeedEventType;
  message?: string | null;
  problem_slug?: string | null;
  source?: SolveSource | null;
  actor_username: string;
  actor_avatar_url: string | null;
  event_at: string;
  created_at: string;
};

export type RoomFeedResponse = {
  items: RoomFeedEvent[];
  next_cursor: string | null;
};

export type MeResponse = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  primary_leetcode_username: string | null;
  leetcode_verified: boolean;
  leetcode_locked: boolean;
  onboarding_required: boolean;
  onboarding_completed_at: string | null;
  profile_complete: boolean;
};

export type UpdateMeRequest = {
  display_name?: string | null;
  primary_leetcode_username?: string | null;
};

export type DashboardRoomItem = {
  room_code: string;
  room_title: string;
  status: RoomStatus;
  joined_at: string;
  my_rank: number | null;
  my_solved_count: number;
  starts_at: string | null;
  ends_at: string | null;
};

export type DashboardResponse = {
  rooms_created: number;
  rooms_joined: number;
  wins: number;
  total_solves: number;
  avg_rank: number | null;
  recent_rooms: DashboardRoomItem[];
};

export type OnboardingStartRequest = {
  leetcode_username: string;
};

export type OnboardingStartResponse = {
  verification_mode: "soft" | "strict";
  profile_preview_username: string;
  profile_preview_avatar_url: string | null;
  profile_preview_url: string | null;
  instructions: string;
  problem_slug: string | null;
  problem_title: string | null;
  reference_code: string | null;
  issued_at: string | null;
  expires_at: string | null;
};

export type OnboardingVerifyRequest = {
  confirm_ownership?: boolean;
};

export type OnboardingVerifyResponse = {
  verified: boolean;
  verified_at: string;
  me: MeResponse;
};
