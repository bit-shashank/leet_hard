"""normalize problem_source enum values

Revision ID: 20260321_0003
Revises: 20260321_0002
Create Date: 2026-03-21 19:40:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260321_0003'
down_revision: Union[str, None] = '20260321_0002'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("UPDATE rooms SET problem_source = LOWER(problem_source) WHERE problem_source IS NOT NULL")
    op.alter_column('rooms', 'problem_source', server_default='random', existing_type=sa.String(length=40))


def downgrade() -> None:
    op.execute("UPDATE rooms SET problem_source = UPPER(problem_source) WHERE problem_source IS NOT NULL")
    op.alter_column('rooms', 'problem_source', server_default='RANDOM', existing_type=sa.String(length=40))

