"""Run Ardent as a production server: waitress, debug off, one origin.

Everything that differs from local development is set through the environment
of THIS process only — `.env` is never edited. FLASK_ENV=production is what
turns debug off; the Werkzeug debugger must never be reachable from the
internet, because it executes arbitrary Python.

    python serve.py                (reads PORT, PUBLIC_URL)
"""
import os
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
sys.path.insert(0, ROOT)

from dotenv import load_dotenv  # noqa: E402

# Real environment variables win over .env (load_dotenv does not override).
os.environ["FLASK_ENV"] = "production"
os.environ.setdefault("FRONTEND_DIST", os.path.join(ROOT, "frontend", "dist"))
public = os.environ.get("PUBLIC_URL", "").rstrip("/")
if public:
    # Where Shopify sends the browser back to, and where the post-install
    # redirect lands. Both must be the public address, not localhost.
    os.environ["FRONTEND_URL"] = public
    os.environ["SHOPIFY_REDIRECT_URI"] = f"{public}/api/connectors/shopify/callback"
load_dotenv()

from waitress import serve  # noqa: E402

from app import create_app  # noqa: E402

app = create_app("production")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5050"))
    # Loopback only: the tunnel (or a reverse proxy) is the one public door.
    print(f"Ardent serving on http://127.0.0.1:{port}  debug={app.debug}  public={public or '-'}", flush=True)
    serve(app, host="127.0.0.1", port=port, threads=8, url_scheme="https" if public else "http")
