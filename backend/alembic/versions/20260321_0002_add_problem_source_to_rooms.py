"""add problem source to rooms

Revision ID: 20260321_0002
Revises: 20260321_0001
Create Date: 2026-03-21 16:50:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260321_0002'
down_revision: Union[str, None] = '20260321_0001'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'rooms',
        sa.Column('problem_source', sa.String(length=40), nullable=False, server_default='random'),
    )


def downgrade() -> None:
    op.drop_column('rooms', 'problem_source')
