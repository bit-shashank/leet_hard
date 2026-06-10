from datetime import datetime, timezone
import re
from typing import List, Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models import (
    ProblemSource,
    RoomFeedEventType,
    RoomStatus,
    SolveEventType,
    SolveSource,
    UserAccountStatus,
    UserRole,
)


CUSTOM_PROBLEM_SLUG_RE = re.compile(r'^[a-z0-9][a-z0-9-]{0,254}$')


def _extract_problem_slug(value: str) -> str:
    cleaned = value.strip()
    if '/problems/' in cleaned:
        cleaned = cleaned.split('/problems/', 1)[1]
    cleaned = cleaned.strip().strip('/')
    cleaned = cleaned.split('?', 1)[0].split('#', 1)[0].split('/', 1)[0].lower()
    if not CUSTOM_PROBLEM_SLUG_RE.fullmatch(cleaned):
        raise ValueError('Problem must be a LeetCode slug or problem URL')
    return cleaned


def _title_from_slug(slug: str) -> str:
    return ' '.join(part.capitalize() for part in slug.split('-') if part) or slug


class CustomProblemInput(BaseModel):
    title_slug: str = Field(min_length=1, max_length=255)
    title: Optional[str] = Field(default=None, max_length=255)
    frontend_id: Optional[str] = Field(default=None, max_length=50)
    url: Optional[str] = Field(default=None, max_length=500)
    difficulty: str = 'Medium'

    @field_validator('title_slug')
    @classmethod
    def normalize_title_slug(cls, value: str) -> str:
        return _extract_problem_slug(value)

    @field_validator('title', 'frontend_id', 'url', mode='before')
    @classmethod
    def normalize_optional_text(cls, value: Optional[object]) -> Optional[str]:
        if value is None:
            return None
        if not isinstance(value, str):
            raise ValueError('Value must be text')
        cleaned = value.strip()
        return cleaned or None

    @field_validator('difficulty', mode='before')
    @classmethod
    def normalize_difficulty(cls, value: Optional[object]) -> str:
        if value is None:
            return 'Medium'
        if not isinstance(value, str):
            raise ValueError('Difficulty must be text')
        cleaned = value.strip().lower()
        difficulty_by_value = {
            'easy': 'Easy',
            'medium': 'Medium',
            'hard': 'Hard',
        }
        if cleaned not in difficulty_by_value:
            raise ValueError('Difficulty must be Easy, Medium, or Hard')
        return difficulty_by_value[cleaned]

    @model_validator(mode='after')
    def populate_defaults(self):
        self.title = self.title or _title_from_slug(self.title_slug)
        self.url = self.url or f'https://leetcode.com/problems/{self.title_slug}/'
        return self


class RoomSettingsInput(BaseModel):
    problem_count: Optional[int] = Field(default=None, ge=3, le=10)
    problem_source: ProblemSource = ProblemSource.RANDOM
    custom_problems: List[CustomProblemInput] = Field(default_factory=list)
    easy_count: int = Field(default=0, ge=0, le=10)
    medium_count: int = Field(default=4, ge=0, le=10)
    hard_count: int = Field(default=0, ge=0, le=10)
    exclude_pre_solved: bool = False
    strict_check: bool = False
    duration_minutes: int = Field(default=60, ge=15, le=180)
    start_at: datetime
    passcode: Optional[str] = Field(default=None, min_length=4, max_length=32)
    topic_slugs: List[str] = Field(default_factory=list)

    @model_validator(mode='before')
    @classmethod
    def apply_problem_count_backcompat(cls, value):
        if not isinstance(value, dict):
            return value

        has_problem_count = 'problem_count' in value and value.get('problem_count') is not None
        has_difficulty_mix = any(key in value for key in ('easy_count', 'medium_count', 'hard_count'))
        if has_problem_count and not has_difficulty_mix:
            return {
                **value,
                'easy_count': 0,
                'medium_count': value.get('problem_count', 4),
                'hard_count': 0,
            }
        return value

    @model_validator(mode='after')
    def validate_total_problem_count(self):
        if self.problem_source == ProblemSource.CUSTOM:
            if len(self.custom_problems) < 3 or len(self.custom_problems) > 10:
                raise ValueError('Custom rooms must include between 3 and 10 problems')

            seen: set[str] = set()
            for problem in self.custom_problems:
                if problem.title_slug in seen:
                    raise ValueError(f'Duplicate custom problem: {problem.title_slug}')
                seen.add(problem.title_slug)

            self.problem_count = len(self.custom_problems)
            self.easy_count = sum(1 for problem in self.custom_problems if problem.difficulty == 'Easy')
            self.medium_count = sum(1 for problem in self.custom_problems if problem.difficulty == 'Medium')
            self.hard_count = sum(1 for problem in self.custom_problems if problem.difficulty == 'Hard')
            self.topic_slugs = []
            self.exclude_pre_solved = False
            return self

        self.custom_problems = []
        total = self.easy_count + self.medium_count + self.hard_count
        if total < 3 or total > 10:
            raise ValueError('Total problems must be between 3 and 10')

        self.problem_count = total
        return self

    @field_validator('start_at')
    @classmethod
    def normalize_start_at(cls, value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    @field_validator('topic_slugs', mode='before')
    @classmethod
    def normalize_topic_slugs(cls, value: Optional[object]) -> List[str]:
        if value is None:
            return []
        if not isinstance(value, list):
            raise ValueError('topic_slugs must be a list')
        normalized: list[str] = []
        seen: set[str] = set()
        for raw in value:
            if not isinstance(raw, str):
                continue
            cleaned = raw.strip().lower()
            if not cleaned or cleaned in seen:
                continue
            normalized.append(cleaned)
            seen.add(cleaned)
        return normalized


class CreateRoomRequest(BaseModel):
    room_title: str = Field(min_length=3, max_length=80)
    settings: RoomSettingsInput

    @field_validator('room_title')
    @classmethod
    def normalize_room_title(cls, value: str) -> str:
        return value.strip()


class JoinRoomRequest(BaseModel):
    passcode: Optional[str] = Field(default=None, min_length=4, max_length=32)


class ParticipantPublic(BaseModel):
    id: str
    leetcode_username: str
    avatar_url: Optional[str]
    is_host: bool
    joined_at: datetime


class ProblemPublic(BaseModel):
    title_slug: str
    title: str
    frontend_id: Optional[str]
    url: str
    difficulty: str
    sort_order: int


class CustomProblemPublic(BaseModel):
    title_slug: str
    title: str
    frontend_id: Optional[str]
    url: str
    difficulty: str


class RoomPublic(BaseModel):
    id: str
    room_code: str
    room_title: str
    status: RoomStatus
    problem_source: ProblemSource
    problem_count: int
    easy_count: int
    medium_count: int
    hard_count: int
    exclude_pre_solved: bool
    strict_check: bool
    duration_minutes: int
    scheduled_start_at: datetime
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    created_at: datetime
    has_passcode: bool
    sync_warning: Optional[str]
    topic_slugs: List[str]
    is_joinable: bool


class LeaderboardEntry(BaseModel):
    rank: int
    participant_id: str
    leetcode_username: str
    avatar_url: Optional[str]
    is_host: bool
    solved_count: int
    last_solved_at: Optional[datetime]


class DiscoverRoomResponse(BaseModel):
    room_code: str
    room_title: str
    status: RoomStatus
    problem_source: ProblemSource
    scheduled_start_at: datetime
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    created_at: datetime
    has_passcode: bool
    easy_count: int
    medium_count: int
    hard_count: int
    participant_count: int
    host_leetcode_username: Optional[str]
    host_avatar_url: Optional[str]
    joinable: bool
    is_featured: bool = False
    featured_priority: Optional[int] = None
    featured_until: Optional[datetime] = None


class TopicInfo(BaseModel):
    slug: str
    name: str
    count: int


class RoomStateResponse(BaseModel):
    room: RoomPublic
    participants: List[ParticipantPublic]
    problems: List[ProblemPublic]
    host_custom_problems: List[CustomProblemPublic] = Field(default_factory=list)
    leaderboard: List[LeaderboardEntry]
    my_participant_id: Optional[str]
    my_solved_slugs: List[str]
    server_time: datetime


class CreateRoomResponse(BaseModel):
    room: RoomPublic
    participant: ParticipantPublic


class JoinRoomResponse(BaseModel):
    room: RoomPublic
    participant: ParticipantPublic


class StartRoomResponse(BaseModel):
    room: RoomPublic


class UpdateRoomSettingsRequest(BaseModel):
    room_title: str = Field(min_length=3, max_length=80)
    settings: RoomSettingsInput

    @field_validator('room_title')
    @classmethod
    def normalize_room_title(cls, value: str) -> str:
        return value.strip()


class UpdateRoomSettingsResponse(BaseModel):
    room: RoomPublic


class ManualSolveRequest(BaseModel):
    problem_slug: str = Field(min_length=1, max_length=255)
    solved: bool

    @field_validator('problem_slug')
    @classmethod
    def normalize_problem_slug(cls, value: str) -> str:
        return value.strip()


class ManualSolveResponse(BaseModel):
    ok: bool


class ChatMessageInput(BaseModel):
    content: str = Field(min_length=1, max_length=300)

    @field_validator('content')
    @classmethod
    def normalize_content(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError('Message cannot be empty')
        return cleaned


class HistoryEvent(BaseModel):
    participant_id: str
    participant_leetcode_username: str
    problem_slug: str
    event_type: SolveEventType
    source: SolveSource
    event_at: datetime


class AcceptedSubmissionPublic(BaseModel):
    participant_id: str
    participant_leetcode_username: str
    problem_slug: str
    solved_at: datetime
    source: SolveSource
    submission_url: Optional[str]


class HistoryResponse(BaseModel):
    room: RoomPublic
    problems: List[ProblemPublic]
    leaderboard: List[LeaderboardEntry]
    events: List[HistoryEvent]
    accepted_submissions: List[AcceptedSubmissionPublic]


class RoomFeedEventPublic(BaseModel):
    id: str
    event_type: RoomFeedEventType
    message: Optional[str]
    problem_slug: Optional[str]
    source: Optional[SolveSource]
    actor_username: str
    actor_avatar_url: Optional[str]
    event_at: datetime
    created_at: datetime


class RoomFeedResponse(BaseModel):
    items: List[RoomFeedEventPublic]
    next_cursor: Optional[str]


class MeResponse(BaseModel):
    id: str
    email: Optional[str]
    display_name: Optional[str]
    avatar_url: Optional[str]
    primary_leetcode_username: Optional[str]
    leetcode_verified: bool
    leetcode_locked: bool
    onboarding_required: bool
    onboarding_completed_at: Optional[datetime]
    profile_complete: bool
    role: UserRole
    account_status: UserAccountStatus


class UpdateMeRequest(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=120)
    primary_leetcode_username: Optional[str] = Field(default=None, min_length=1, max_length=40)

    @field_validator('display_name')
    @classmethod
    def normalize_display_name(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        return cleaned or None

    @field_validator('primary_leetcode_username')
    @classmethod
    def normalize_leetcode_username(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        return cleaned or None


class DashboardRoomItem(BaseModel):
    room_code: str
    room_title: str
    status: RoomStatus
    joined_at: datetime
    my_rank: Optional[int]
    my_solved_count: int
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]


class DashboardResponse(BaseModel):
    rooms_created: int
    rooms_joined: int
    wins: int
    total_solves: int
    avg_rank: Optional[float]
    recent_rooms: List[DashboardRoomItem]


class RecentAcceptedSubmissionPublic(BaseModel):
    problem_slug: str
    problem_title: str
    problem_difficulty: Optional[str] = None
    submitted_at: datetime
    submission_url: Optional[str]
    problem_url: str


class OnboardingStartRequest(BaseModel):
    leetcode_username: str = Field(min_length=1, max_length=40)

    @field_validator('leetcode_username')
    @classmethod
    def normalize_leetcode_username(cls, value: str) -> str:
        return value.strip()


class OnboardingStartResponse(BaseModel):
    verification_mode: Literal['soft', 'strict']
    profile_preview_username: str
    profile_preview_avatar_url: Optional[str]
    profile_preview_url: Optional[str]
    instructions: str
    problem_slug: Optional[str] = None
    problem_title: Optional[str] = None
    reference_code: Optional[str] = None
    issued_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None


class OnboardingVerifyRequest(BaseModel):
    confirm_ownership: bool = False


class OnboardingVerifyResponse(BaseModel):
    verified: bool
    verified_at: datetime
    me: MeResponse


class AdminFeaturedRoomUpsertRequest(BaseModel):
    room_code: str = Field(min_length=4, max_length=12)
    priority: int = Field(default=100, ge=1, le=9999)
    starts_at: Optional[datetime] = None
    ends_at: Optional[datetime] = None
    is_active: bool = True

    @field_validator('room_code')
    @classmethod
    def normalize_room_code(cls, value: str) -> str:
        return value.strip().upper()

    @field_validator('starts_at', 'ends_at')
    @classmethod
    def normalize_time(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return value
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value

    @model_validator(mode='after')
    def validate_window(self):
        if self.starts_at and self.ends_at and self.ends_at <= self.starts_at:
            raise ValueError('ends_at must be after starts_at')
        return self


class AdminFeaturedRoomItem(BaseModel):
    room_code: str
    room_title: str
    room_status: RoomStatus
    scheduled_start_at: datetime
    priority: int
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    is_active: bool
    is_currently_featured: bool


class AdminRoomItem(BaseModel):
    room_code: str
    room_title: str
    status: RoomStatus
    scheduled_start_at: datetime
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    created_at: datetime
    participant_count: int
    is_joinable: bool
    is_featured: bool
    featured_priority: Optional[int]


class AdminRoomUpdateRequest(BaseModel):
    room_title: Optional[str] = Field(default=None, min_length=3, max_length=80)
    scheduled_start_at: Optional[datetime] = None
    status: Optional[RoomStatus] = None
    is_joinable: Optional[bool] = None

    @field_validator('room_title')
    @classmethod
    def normalize_room_title(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return value
        cleaned = value.strip()
        return cleaned or None

    @field_validator('scheduled_start_at')
    @classmethod
    def normalize_start_at(cls, value: Optional[datetime]) -> Optional[datetime]:
        if value is None:
            return value
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value


class AdminUserItem(BaseModel):
    id: str
    email: Optional[str]
    display_name: Optional[str]
    primary_leetcode_username: Optional[str]
    role: UserRole
    account_status: UserAccountStatus
    created_at: datetime
    updated_at: datetime


class AdminUserUpdateRequest(BaseModel):
    role: Optional[UserRole] = None
    account_status: Optional[UserAccountStatus] = None


class AdminActionLogItem(BaseModel):
    id: str
    actor_user_id: Optional[str]
    actor_email: Optional[str]
    action: str
    resource_type: str
    resource_id: Optional[str]
    details: dict
    created_at: datetime
