"""add exclude_pre_solved toggle to rooms

Revision ID: 20260325_0008
Revises: 20260324_0007
Create Date: 2026-03-25 08:40:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260325_0008'
down_revision: Union[str, None] = '20260324_0007'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'rooms',
        sa.Column('exclude_pre_solved', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.execute('UPDATE rooms SET exclude_pre_solved = false WHERE exclude_pre_solved IS NULL')

    bind = op.get_bind()
    if bind.dialect.name != 'sqlite':
        op.alter_column('rooms', 'exclude_pre_solved', server_default=None)


def downgrade() -> None:
    op.drop_column('rooms', 'exclude_pre_solved')

