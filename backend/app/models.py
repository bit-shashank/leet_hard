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


class Room(Base):
    __tablename__ = 'rooms'

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    room_code: Mapped[str] = mapped_column(String(12), unique=True, index=True)
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
    duration_minutes: Mapped[int] = mapped_column(Integer, default=60)
    starts_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    host_participant_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
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


class Participant(Base):
    __tablename__ = 'participants'
    __table_args__ = (
        UniqueConstraint('room_id', 'nickname', name='uq_participant_room_nickname'),
        UniqueConstraint('room_id', 'leetcode_username', name='uq_participant_room_username'),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    room_id: Mapped[str] = mapped_column(
        String(36), ForeignKey('rooms.id', ondelete='CASCADE'), index=True
    )
    nickname: Mapped[str] = mapped_column(String(50))
    leetcode_username: Mapped[str] = mapped_column(String(50))
    avatar_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    avatar_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), index=True)
    is_host: Mapped[bool] = mapped_column(Boolean, default=False)
    joined_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    room: Mapped['Room'] = relationship(back_populates='participants')
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
