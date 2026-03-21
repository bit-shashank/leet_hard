"""add difficulty mix and avatar columns

Revision ID: 20260321_0001
Revises:
Create Date: 2026-03-21 14:10:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260321_0001'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'rooms',
        sa.Column('easy_count', sa.Integer(), nullable=True, server_default=sa.text('0')),
    )
    op.add_column(
        'rooms',
        sa.Column('medium_count', sa.Integer(), nullable=True, server_default=sa.text('4')),
    )
    op.add_column(
        'rooms',
        sa.Column('hard_count', sa.Integer(), nullable=True, server_default=sa.text('0')),
    )

    op.execute('UPDATE rooms SET easy_count = 0')
    op.execute('UPDATE rooms SET hard_count = 0')
    op.execute('UPDATE rooms SET medium_count = COALESCE(problem_count, 4)')

    bind = op.get_bind()
    if bind.dialect.name != 'sqlite':
        op.alter_column('rooms', 'easy_count', nullable=False, server_default=sa.text('0'))
        op.alter_column('rooms', 'medium_count', nullable=False, server_default=sa.text('4'))
        op.alter_column('rooms', 'hard_count', nullable=False, server_default=sa.text('0'))

    op.add_column('participants', sa.Column('avatar_url', sa.Text(), nullable=True))
    op.add_column(
        'participants', sa.Column('avatar_synced_at', sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column('participants', 'avatar_synced_at')
    op.drop_column('participants', 'avatar_url')

    op.drop_column('rooms', 'hard_count')
    op.drop_column('rooms', 'medium_count')
    op.drop_column('rooms', 'easy_count')
