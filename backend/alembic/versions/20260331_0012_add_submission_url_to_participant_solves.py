"""add submission url to participant solves

Revision ID: 20260331_0012
Revises: 20260330_0011
Create Date: 2026-03-31 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260331_0012'
down_revision: Union[str, None] = '20260330_0011'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('participant_solves', sa.Column('submission_url', sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column('participant_solves', 'submission_url')
