"""Bring an existing database up to the current models.

There are no migration files in this project; tables are created with
`db.create_all()`, which creates missing tables but never touches existing
ones. A column added to a model would therefore be missing from any database
created before it, and the first query against it would fail.

This adds such columns, and only such columns. It never drops, renames or
retypes anything, so it cannot lose data. New columns are added as nullable,
which is what every column added this way is designed to be.
"""
from sqlalchemy import inspect, text

from app.extensions import db


def missing_columns():
    """(table, column) pairs the models declare but the database lacks."""
    inspector = inspect(db.engine)
    existing_tables = set(inspector.get_table_names())
    missing = []
    for table in db.metadata.sorted_tables:
        if table.name not in existing_tables:
            continue  # create_all() handles whole tables
        present = {c["name"] for c in inspector.get_columns(table.name)}
        for column in table.columns:
            if column.name not in present:
                missing.append((table, column))
    return missing


def upgrade():
    """Create missing tables, then add missing columns. Safe to run repeatedly."""
    db.create_all()
    added = []
    for table, column in missing_columns():
        ddl_type = column.type.compile(dialect=db.engine.dialect)
        # Quoted, because reserved words appear as column names in the wild.
        db.session.execute(text(
            f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {ddl_type}'
        ))
        if column.index:
            # SQLAlchemy's own naming, so a later create_all() recognises it.
            db.session.execute(text(
                f'CREATE INDEX IF NOT EXISTS "ix_{table.name}_{column.name}" '
                f'ON "{table.name}" ("{column.name}")'
            ))
        added.append(f"{table.name}.{column.name}")
    if added:
        db.session.commit()
    return added
