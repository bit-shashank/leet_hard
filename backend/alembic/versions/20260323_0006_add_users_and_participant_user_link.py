"""add users table and participant user linkage

Revision ID: 20260323_0006
Revises: 20260323_0005
Create Date: 2026-03-23 22:05:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260323_0006'
down_revision: Union[str, None] = '20260323_0005'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'users',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=True),
        sa.Column('display_name', sa.String(length=120), nullable=True),
        sa.Column('avatar_url', sa.Text(), nullable=True),
        sa.Column('primary_leetcode_username', sa.String(length=50), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_users_email', 'users', ['email'], unique=False)

    op.add_column('participants', sa.Column('user_id', sa.String(length=36), nullable=True))
    op.create_index('ix_participants_user_id', 'participants', ['user_id'], unique=False)
    op.create_foreign_key(
        'fk_participants_user_id_users',
        'participants',
        'users',
        ['user_id'],
        ['id'],
        ondelete='SET NULL',
    )
    op.create_unique_constraint('uq_participant_room_user', 'participants', ['room_id', 'user_id'])


def downgrade() -> None:
    op.drop_constraint('uq_participant_room_user', 'participants', type_='unique')
    op.drop_constraint('fk_participants_user_id_users', 'participants', type_='foreignkey')
    op.drop_index('ix_participants_user_id', table_name='participants')
    op.drop_column('participants', 'user_id')

    op.drop_index('ix_users_email', table_name='users')
    op.drop_table('users')
