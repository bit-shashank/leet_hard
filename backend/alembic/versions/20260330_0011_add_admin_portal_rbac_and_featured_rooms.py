"""add admin portal rbac and featured rooms

Revision ID: 20260330_0011
Revises: 20260328_0010
Create Date: 2026-03-30 00:00:00.000000

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '20260330_0011'
down_revision: Union[str, None] = '20260328_0010'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


user_role_enum = sa.Enum(
    'user',
    'admin',
    name='user_role',
    native_enum=False,
)

user_account_status_enum = sa.Enum(
    'active',
    'restricted',
    name='user_account_status',
    native_enum=False,
)


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('role', user_role_enum, nullable=False, server_default='user'),
    )
    op.create_index('ix_users_role', 'users', ['role'], unique=False)

    op.add_column(
        'users',
        sa.Column(
            'account_status',
            user_account_status_enum,
            nullable=False,
            server_default='active',
        ),
    )
    op.create_index('ix_users_account_status', 'users', ['account_status'], unique=False)

    op.add_column(
        'rooms',
        sa.Column('is_joinable', sa.Boolean(), nullable=False, server_default=sa.text('true')),
    )

    op.create_table(
        'featured_rooms',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('room_id', sa.String(length=36), nullable=False),
        sa.Column('priority', sa.Integer(), nullable=False, server_default='100'),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_by', sa.String(length=36), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['created_by'], ['users.id'], ondelete='SET NULL'),
        sa.ForeignKeyConstraint(['room_id'], ['rooms.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('room_id', name='uq_featured_room_room_id'),
    )
    op.create_index('ix_featured_rooms_room_id', 'featured_rooms', ['room_id'], unique=False)
    op.create_index('ix_featured_rooms_priority', 'featured_rooms', ['priority'], unique=False)
    op.create_index('ix_featured_rooms_is_active', 'featured_rooms', ['is_active'], unique=False)
    op.create_index('ix_featured_rooms_created_by', 'featured_rooms', ['created_by'], unique=False)

    op.create_table(
        'admin_action_logs',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('actor_user_id', sa.String(length=36), nullable=True),
        sa.Column('action', sa.String(length=80), nullable=False),
        sa.Column('resource_type', sa.String(length=80), nullable=False),
        sa.Column('resource_id', sa.String(length=80), nullable=True),
        sa.Column('details', sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('CURRENT_TIMESTAMP')),
        sa.ForeignKeyConstraint(['actor_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_admin_action_logs_actor_user_id', 'admin_action_logs', ['actor_user_id'], unique=False)
    op.create_index('ix_admin_action_logs_action', 'admin_action_logs', ['action'], unique=False)
    op.create_index('ix_admin_action_logs_resource_type', 'admin_action_logs', ['resource_type'], unique=False)
    op.create_index('ix_admin_action_logs_resource_id', 'admin_action_logs', ['resource_id'], unique=False)
    op.create_index('ix_admin_action_logs_created_at', 'admin_action_logs', ['created_at'], unique=False)

    op.alter_column('users', 'role', server_default=None)
    op.alter_column('users', 'account_status', server_default=None)
    op.alter_column('rooms', 'is_joinable', server_default=None)


def downgrade() -> None:
    op.drop_index('ix_admin_action_logs_created_at', table_name='admin_action_logs')
    op.drop_index('ix_admin_action_logs_resource_id', table_name='admin_action_logs')
    op.drop_index('ix_admin_action_logs_resource_type', table_name='admin_action_logs')
    op.drop_index('ix_admin_action_logs_action', table_name='admin_action_logs')
    op.drop_index('ix_admin_action_logs_actor_user_id', table_name='admin_action_logs')
    op.drop_table('admin_action_logs')

    op.drop_index('ix_featured_rooms_created_by', table_name='featured_rooms')
    op.drop_index('ix_featured_rooms_is_active', table_name='featured_rooms')
    op.drop_index('ix_featured_rooms_priority', table_name='featured_rooms')
    op.drop_index('ix_featured_rooms_room_id', table_name='featured_rooms')
    op.drop_table('featured_rooms')

    op.drop_column('rooms', 'is_joinable')

    op.drop_index('ix_users_account_status', table_name='users')
    op.drop_column('users', 'account_status')

    op.drop_index('ix_users_role', table_name='users')
    op.drop_column('users', 'role')
