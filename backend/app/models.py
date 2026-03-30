from datetime import datetime, timezone
from enum import Enum
from typing import List, Optional
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class RoomStatus(str, Enum):
    LOBBY = 'lobby'
    ACTIVE = 'active'
    ENDED = 'ended'


class ProblemSource(str, Enum):
    RANDOM = 'random'
    NEETCODE_150 = 'neetcode_150'
    NEETCODE_250 = 'neetcode_250'
    BLIND_75 = 'blind_75'
    STRIVER_A2Z_SHEET = 'striver_a2z_sheet'
    STRIVER_SDE_SHEET = 'striver_sde_sheet'


class SolveSource(str, Enum):
    AUTO = 'auto'
    MANUAL = 'manual'


class SolveEventType(str, Enum):
    MARKED_SOLVED = 'marked_solved'
    UNMARKED = 'unmarked'
    AUTO_DETECTED = 'auto_detected'


class RoomFeedEventType(str, Enum):
    CHAT = 'chat'
    SOLVE = 'solve'
    JOIN = 'join'
    LEAVE = 'leave'


class UserRole(str, Enum):
    USER = 'user'
    ADMIN = 'admin'


class UserAccountStatus(str, Enum):
    ACTIVE = 'active'
    RESTRICTED = 'restricted'


class VerificationChallengeStatus(str, Enum):
    ISSUED = 'issued'
    VERIFIED = 'verified'
    EXPIRED = 'expired'


class Room(Base):
    __tablename__ = 'rooms'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    room_code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
    room_title: Mapped[str] = mapped_column(String(120), default='Untitled Room')
    status: Mapped[RoomStatus] = mapped_column(
        SAEnum(RoomStatus, name='room_status'), default=RoomStatus.LOBBY, index=True
    )
    passcode_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    problem_source: Mapped[ProblemSource] = mapped_column(
        SAEnum(
            ProblemSource,
            name='problem_source',
            native_enum=False,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            validate_strings=True,
        ),
        default=ProblemSource.RANDOM,
    )
    problem_count: Mapped[int] = mapped_column(Integer, default=4)
    easy_count: Mapped[int] = mapped_column(Integer, default=0)
    medium_count: Mapped[int] = mapped_column(Integer, default=4)
    hard_count: Mapped[int] = mapped_column(Integer, default=0)
    exclude_pre_solved: Mapped[bool] = mapped_column(Boolean, default=False)
    strict_check: Mapped[bool] = mapped_column(Boolean, default=False)
    duration_minutes: Mapped[int] = mapped_column(Integer, default=60)
    scheduled_start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    starts_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    host_participant_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    topic_slugs: Mapped[list[str]] = mapped_column(JSON, default=list)
    is_joinable: Mapped[bool] = mapped_column(Boolean, default=True)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sync_warning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    participants: Mapped[List['Participant']] = relationship(
        back_populates='room', cascade='all, delete-orphan'
    )
    problems: Mapped[List['RoomProblem']] = relationship(
        back_populates='room', cascade='all, delete-orphan'
    )
    solve_events: Mapped[List['SolveEvent']] = relationship(
        back_populates='room', cascade='all, delete-orphan'
    )
    featured_room: Mapped[Optional['FeaturedRoom']] = relationship(
        back_populates='room',
        cascade='all, delete-orphan',
        uselist=False,
    )


class User(Base):
    __tablename__ = 'users'

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True, index=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    primary_leetcode_username: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    role: Mapped[UserRole] = mapped_column(
        SAEnum(
            UserRole,
            name='user_role',
            native_enum=False,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            validate_strings=True,
        ),
        default=UserRole.USER,
        index=True,
    )
    account_status: Mapped[UserAccountStatus] = mapped_column(
        SAEnum(
            UserAccountStatus,
            name='user_account_status',
            native_enum=False,
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            validate_strings=True,
        ),
        default=UserAccountStatus.ACTIVE,
        index=True,
    )
    leetcode_verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    leetcode_username_locked: Mapped[bool] = mapped_column(Boolean, default=False)
    onboarding_completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    participants: Mapped[List['Participant']] = relationship(back_populates='user')
    verification_challenges: Mapped[List['LeetCodeVerificationChallenge']] = relationship(
        back_populates='user',
        cascade='all, delete-orphan',
    )
    admin_action_logs: Mapped[List['AdminActionLog']] = relationship(back_populates='actor')


class Participant(Base):
    __tablename__ = 'participants'
    __table_args__ = (
        UniqueConstraint('room_id', 'nickname', name='uq_participant_room_nickname'),
        UniqueConstraint('room_id', 'leetcode_username', name='uq_participant_room_username'),
        UniqueConstraint('room_id', 'user_id', name='uq_participant_room_user'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    room_id: Mapped[str] = mapped_column(
        String(36), ForeignKey('rooms.id', ondelete='CASCADE'), index=True
    )
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey('users.id', ondelete='SET NULL'), index=True, nullable=True
    )
    nickname: Mapped[str] = mapped_column(String(50))
    leetcode_username: Mapped[str] = mapped_column(String(50))
    avatar_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    avatar_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), index=True)
    is_host: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    room: Mapped['Room'] = relationship(back_populates='participants')
    user: Mapped[Optional['User']] = relationship(back_populates='participants')
    solves: Mapped[List['ParticipantSolve']] = relationship(
        back_populates='participant', cascade='all, delete-orphan'
    )


class RoomProblem(Base):
    __tablename__ = 'room_problems'
    __table_args__ = (
        UniqueConstraint('room_id', 'title_slug', name='uq_room_problem_slug'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    room_id: Mapped[str] = mapped_column(
        String(36), ForeignKey('rooms.id', ondelete='CASCADE'), index=True
    )
    title_slug: Mapped[str] = mapped_column(String(255), index=True)
    title: Mapped[str] = mapped_column(String(255))
    frontend_id: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    url: Mapped[str] = mapped_column(String(500))
    difficulty: Mapped[str] = mapped_column(String(20), default='Medium')
    sort_order: Mapped[int] = mapped_column(Integer)

    room: Mapped['Room'] = relationship(back_populates='problems')


class ParticipantSolve(Base):
    __tablename__ = 'participant_solves'
    __table_args__ = (
        UniqueConstraint('room_id', 'participant_id', 'problem_slug', name='uq_room_participant_problem'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    room_id: Mapped[str] = mapped_column(
        String(36), ForeignKey('rooms.id', ondelete='CASCADE'), index=True
    )
    participant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey('participants.id', ondelete='CASCADE'), index=True
    )
    problem_slug: Mapped[str] = mapped_column(String(255), index=True)
    first_solved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    source: Mapped[SolveSource] = mapped_column(SAEnum(SolveSource, name='solve_source'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    participant: Mapped['Participant'] = relationship(back_populates='solves')


class SolveEvent(Base):
    __tablename__ = 'solve_events'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    room_id: Mapped[str] = mapped_column(
        String(36), ForeignKey('rooms.id', ondelete='CASCADE'), index=True
    )
    participant_id: Mapped[str] = mapped_column(
        String(36), ForeignKey('participants.id', ondelete='CASCADE'), index=True
    )
    problem_slug: Mapped[str] = mapped_column(String(255), index=True)
    event_type: Mapped[SolveEventType] = mapped_column(SAEnum(SolveEventType, name='solve_event_type'))
    source: Mapped[SolveSource] = mapped_column(SAEnum(SolveSource, name='solve_event_source'))
    event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    room: Mapped['Room'] = relationship(back_populates='solve_events')


class RoomFeedEvent(Base):
    __tablename__ = 'room_feed_events'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    room_id: Mapped[str] = mapped_column(
        String(36), ForeignKey('rooms.id', ondelete='CASCADE'), index=True
    )
    participant_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey('participants.id', ondelete='SET NULL'), index=True, nullable=True
    )
    event_type: Mapped[RoomFeedEventType] = mapped_column(
        SAEnum(
            RoomFeedEventType,
            name='room_feed_event_type',
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            validate_strings=True,
        )
    )
    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    problem_slug: Mapped[Optional[str]] = mapped_column(String(255), index=True, nullable=True)
    source: Mapped[Optional[SolveSource]] = mapped_column(
        SAEnum(
            SolveSource,
            name='room_feed_event_source',
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            validate_strings=True,
        ),
        nullable=True,
    )
    actor_username: Mapped[str] = mapped_column(String(50))
    actor_avatar_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    event_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class FeaturedRoom(Base):
    __tablename__ = 'featured_rooms'
    __table_args__ = (
        UniqueConstraint('room_id', name='uq_featured_room_room_id'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    room_id: Mapped[str] = mapped_column(
        String(36), ForeignKey('rooms.id', ondelete='CASCADE'), index=True
    )
    priority: Mapped[int] = mapped_column(Integer, default=100, index=True)
    starts_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, index=True)
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    room: Mapped['Room'] = relationship(back_populates='featured_room')


class AdminActionLog(Base):
    __tablename__ = 'admin_action_logs'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    actor_user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey('users.id', ondelete='SET NULL'), nullable=True, index=True
    )
    action: Mapped[str] = mapped_column(String(80), index=True)
    resource_type: Mapped[str] = mapped_column(String(80), index=True)
    resource_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    details: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    actor: Mapped[Optional['User']] = relationship(back_populates='admin_action_logs')


class LeetCodeVerificationChallenge(Base):
    __tablename__ = 'leetcode_verification_challenges'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey('users.id', ondelete='CASCADE'), index=True
    )
    leetcode_username: Mapped[str] = mapped_column(String(50), index=True)
    problem_slug: Mapped[str] = mapped_column(String(255), default='fizz-buzz')
    problem_title: Mapped[str] = mapped_column(String(255), default='Fizz Buzz')
    reference_code: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[VerificationChallengeStatus] = mapped_column(
        SAEnum(
            VerificationChallengeStatus,
            name='verification_challenge_status',
            values_callable=lambda enum_cls: [member.value for member in enum_cls],
            validate_strings=True,
        ),
        default=VerificationChallengeStatus.ISSUED,
        index=True,
    )
    issued_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    user: Mapped['User'] = relationship(back_populates='verification_challenges')
