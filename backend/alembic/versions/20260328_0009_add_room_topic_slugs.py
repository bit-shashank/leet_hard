"""add topic slugs to rooms

Revision ID: 20260328_0009
Revises: 20260325_0008
Create Date: 2026-03-28 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = '20260328_0009'
down_revision: Union[str, None] = '20260325_0008'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'rooms',
        sa.Column('topic_slugs', sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.execute("UPDATE rooms SET topic_slugs = '[]' WHERE topic_slugs IS NULL")

    bind = op.get_bind()
    if bind.dialect.name != 'sqlite':
        op.alter_column('rooms', 'topic_slugs', server_default=None)


def downgrade() -> None:
    op.drop_column('rooms', 'topic_slugs')
