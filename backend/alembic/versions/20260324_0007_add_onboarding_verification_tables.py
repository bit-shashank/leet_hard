"""add onboarding verification fields and challenge table

Revision ID: 20260324_0007
Revises: 20260323_0006
Create Date: 2026-03-24 11:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '20260324_0007'
down_revision: Union[str, None] = '20260323_0006'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


challenge_status_enum = sa.Enum(
    'issued',
    'verified',
    'expired',
    name='verification_challenge_status',
)

pg_challenge_status_enum = postgresql.ENUM(
    'issued',
    'verified',
    'expired',
    name='verification_challenge_status',
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != 'sqlite':
        op.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_type
                WHERE typname = 'verification_challenge_status'
              ) THEN
                CREATE TYPE verification_challenge_status AS ENUM ('issued', 'verified', 'expired');
              END IF;
            END
            $$;
            """
        )

    op.add_column(
        'users',
        sa.Column('leetcode_verified_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        'users',
        sa.Column('leetcode_username_locked', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.add_column(
        'users',
        sa.Column('onboarding_completed_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        'leetcode_verification_challenges',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('user_id', sa.String(length=36), nullable=False),
        sa.Column('leetcode_username', sa.String(length=50), nullable=False),
        sa.Column('problem_slug', sa.String(length=255), nullable=False, server_default='fizz-buzz'),
        sa.Column('problem_title', sa.String(length=255), nullable=False, server_default='Fizz Buzz'),
        sa.Column('reference_code', sa.Text(), nullable=True),
        sa.Column(
            'status',
            pg_challenge_status_enum if bind.dialect.name != 'sqlite' else challenge_status_enum,
            nullable=False,
            server_default='issued',
        ),
        sa.Column('issued_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(
        'ix_leetcode_verification_challenges_user_id',
        'leetcode_verification_challenges',
        ['user_id'],
        unique=False,
    )
    op.create_index(
        'ix_leetcode_verification_challenges_leetcode_username',
        'leetcode_verification_challenges',
        ['leetcode_username'],
        unique=False,
    )
    op.create_index(
        'ix_leetcode_verification_challenges_status',
        'leetcode_verification_challenges',
        ['status'],
        unique=False,
    )

    if bind.dialect.name != 'sqlite':
        op.alter_column('users', 'leetcode_username_locked', server_default=None)


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_index(
        'ix_leetcode_verification_challenges_status',
        table_name='leetcode_verification_challenges',
    )
    op.drop_index(
        'ix_leetcode_verification_challenges_leetcode_username',
        table_name='leetcode_verification_challenges',
    )
    op.drop_index(
        'ix_leetcode_verification_challenges_user_id',
        table_name='leetcode_verification_challenges',
    )
    op.drop_table('leetcode_verification_challenges')

    op.drop_column('users', 'onboarding_completed_at')
    op.drop_column('users', 'leetcode_username_locked')
    op.drop_column('users', 'leetcode_verified_at')

    if bind.dialect.name != 'sqlite':
        op.execute('DROP TYPE IF EXISTS verification_challenge_status')
