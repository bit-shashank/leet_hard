"""add custom problems to rooms

Revision ID: 20260401_0013
Revises: 20260331_0012
Create Date: 2026-04-01 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260401_0013'
down_revision: Union[str, None] = '20260331_0012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('rooms', sa.Column('custom_problems', sa.JSON(), nullable=True))
    op.execute("UPDATE rooms SET custom_problems = '[]' WHERE custom_problems IS NULL")


def downgrade() -> None:
    op.drop_column('rooms', 'custom_problems')
