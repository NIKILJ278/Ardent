# usage:
#   python manage.py init-db          create any missing tables and columns
#   python manage.py reset-db --yes   drop every table and start empty
#
# There is no demo seed. Every figure in Ardent comes from a connected source.
import sys
from app import create_app
from app.extensions import db


def init_db():
    app = create_app()
    from app.schema import upgrade

    with app.app_context():
        added = upgrade()
        print("Tables created." + (f" Added columns: {', '.join(added)}" if added else ""))


def reset_db(confirmed):
    if not confirmed:
        print("This deletes every user, brand, connection and order.")
        print("Back up instance/brandstack.db first, then run: python manage.py reset-db --yes")
        sys.exit(1)
    app = create_app()
    with app.app_context():
        db.drop_all()
        db.create_all()
        print("Database reset. It is empty; create your account in the dashboard.")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else None
    if cmd == "init-db":
        init_db()
    elif cmd == "reset-db":
        reset_db("--yes" in sys.argv[2:])
    else:
        print("usage: python manage.py [init-db | reset-db --yes]")
