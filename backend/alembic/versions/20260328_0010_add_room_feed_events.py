"""add room feed events

Revision ID: 20260328_0010
Revises: 20260328_0009
Create Date: 2026-03-28 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260328_0010'
down_revision: Union[str, None] = '20260328_0009'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'room_feed_events',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('room_id', sa.String(length=36), nullable=False),
        sa.Column('participant_id', sa.String(length=36), nullable=True),
        sa.Column(
            'event_type',
            sa.Enum('chat', 'solve', 'join', 'leave', name='room_feed_event_type'),
            nullable=False,
        ),
        sa.Column('message', sa.Text(), nullable=True),
        sa.Column('problem_slug', sa.String(length=255), nullable=True),
        sa.Column(
            'source',
            sa.Enum('auto', 'manual', name='room_feed_event_source'),
            nullable=True,
        ),
        sa.Column('actor_username', sa.String(length=50), nullable=False),
        sa.Column('actor_avatar_url', sa.Text(), nullable=True),
        sa.Column('event_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['participant_id'], ['participants.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_room_feed_events_room_id', 'room_feed_events', ['room_id'])
    op.create_index('ix_room_feed_events_participant_id', 'room_feed_events', ['participant_id'])
    op.create_index('ix_room_feed_events_problem_slug', 'room_feed_events', ['problem_slug'])
    op.create_index('ix_room_feed_events_event_at', 'room_feed_events', ['event_at'])


def downgrade() -> None:
    op.drop_index('ix_room_feed_events_event_at', table_name='room_feed_events')
    op.drop_index('ix_room_feed_events_problem_slug', table_name='room_feed_events')
    op.drop_index('ix_room_feed_events_participant_id', table_name='room_feed_events')
    op.drop_index('ix_room_feed_events_room_id', table_name='room_feed_events')
    op.drop_table('room_feed_events')
    op.execute('DROP TYPE IF EXISTS room_feed_event_type')
    op.execute('DROP TYPE IF EXISTS room_feed_event_source')
