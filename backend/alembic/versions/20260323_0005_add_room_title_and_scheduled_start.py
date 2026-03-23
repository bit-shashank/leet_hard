"""add room title and scheduled start to rooms

Revision ID: 20260323_0005
Revises: 20260322_0004
Create Date: 2026-03-23 12:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260323_0005'
down_revision: Union[str, None] = '20260322_0004'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'rooms',
        sa.Column('room_title', sa.String(length=120), nullable=True, server_default='Untitled Room'),
    )
    op.add_column(
        'rooms',
        sa.Column('scheduled_start_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.execute(
        "UPDATE rooms SET room_title = COALESCE(NULLIF(room_title, ''), 'Room ' || room_code)"
    )
    op.execute(
        'UPDATE rooms '
        'SET scheduled_start_at = COALESCE(scheduled_start_at, starts_at, created_at, CURRENT_TIMESTAMP)'
    )

    bind = op.get_bind()
    if bind.dialect.name != 'sqlite':
        op.alter_column('rooms', 'room_title', nullable=False, server_default='Untitled Room')
        op.alter_column('rooms', 'scheduled_start_at', nullable=False)


def downgrade() -> None:
    op.drop_column('rooms', 'scheduled_start_at')
    op.drop_column('rooms', 'room_title')
