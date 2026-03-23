from datetime import datetime, timezone
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from app.models import ProblemSource, RoomStatus, SolveEventType, SolveSource


class RoomSettingsInput(BaseModel):
    problem_count: Optional[int] = Field(default=None, ge=3, le=10)
    problem_source: ProblemSource = ProblemSource.RANDOM
    easy_count: int = Field(default=0, ge=0, le=10)
    medium_count: int = Field(default=4, ge=0, le=10)
    hard_count: int = Field(default=0, ge=0, le=10)
    strict_check: bool = False
    duration_minutes: int = Field(default=60, ge=15, le=180)
    start_at: datetime
    passcode: Optional[str] = Field(default=None, min_length=4, max_length=32)

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


class CreateRoomRequest(BaseModel):
    room_title: str = Field(min_length=3, max_length=80)
    host_leetcode_username: str = Field(min_length=1, max_length=40)
    settings: RoomSettingsInput

    @field_validator('room_title')
    @classmethod
    def normalize_room_title(cls, value: str) -> str:
        return value.strip()


class JoinRoomRequest(BaseModel):
    leetcode_username: str = Field(min_length=1, max_length=40)
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
    strict_check: bool
    duration_minutes: int
    scheduled_start_at: datetime
    starts_at: Optional[datetime]
    ends_at: Optional[datetime]
    created_at: datetime
    has_passcode: bool
    sync_warning: Optional[str]


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


class RoomStateResponse(BaseModel):
    room: RoomPublic
    participants: List[ParticipantPublic]
    problems: List[ProblemPublic]
    leaderboard: List[LeaderboardEntry]
    my_participant_id: Optional[str]
    my_solved_slugs: List[str]
    server_time: datetime


class CreateRoomResponse(BaseModel):
    room: RoomPublic
    participant: ParticipantPublic
    participant_token: str


class JoinRoomResponse(BaseModel):
    room: RoomPublic
    participant: ParticipantPublic
    participant_token: str


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


class HistoryEvent(BaseModel):
    participant_id: str
    participant_leetcode_username: str
    problem_slug: str
    event_type: SolveEventType
    source: SolveSource
    event_at: datetime


class HistoryResponse(BaseModel):
    room: RoomPublic
    problems: List[ProblemPublic]
    leaderboard: List[LeaderboardEntry]
    events: List[HistoryEvent]
