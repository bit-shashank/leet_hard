"""add strict_check to rooms

Revision ID: 20260322_0004
Revises: 20260321_0003
Create Date: 2026-03-22 11:30:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260322_0004'
down_revision: Union[str, None] = '20260321_0003'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'rooms',
        sa.Column('strict_check', sa.Boolean(), nullable=True, server_default=sa.text('false')),
    )
    op.execute('UPDATE rooms SET strict_check = FALSE WHERE strict_check IS NULL')

    bind = op.get_bind()
    if bind.dialect.name != 'sqlite':
        op.alter_column('rooms', 'strict_check', nullable=False, server_default=sa.text('false'))


def downgrade() -> None:
    op.drop_column('rooms', 'strict_check')
