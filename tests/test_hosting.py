"""Serving the built dashboard from the API server.

Runs against a throwaway dist folder, never the real build, and an in-memory
database, so it touches neither.

    python tests/test_hosting.py
"""
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

os.environ.update({
    "SECRET_KEY": "test-secret-key",
    "JWT_SECRET_KEY": "test-jwt-secret-that-is-long-enough-for-hs256",
    "DATABASE_URL": "sqlite:///:memory:",
    "CREDENTIALS_KEY": "test-credentials-key-also-long-enough",
})

from app import create_app  # noqa: E402

INDEX = "<!doctype html><title>ardent-index</title>"
ASSET = "console.log('asset')"
SECRET_FILE = "TOP-SECRET-SERVER-FILE"


class Hosting(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dist = os.path.join(self.tmp.name, "dist")
        os.makedirs(os.path.join(self.dist, "assets"))
        with open(os.path.join(self.dist, "index.html"), "w") as f:
            f.write(INDEX)
        with open(os.path.join(self.dist, "assets", "app.js"), "w") as f:
            f.write(ASSET)
        # A file next to dist that must never be reachable through it.
        with open(os.path.join(self.tmp.name, "secret.txt"), "w") as f:
            f.write(SECRET_FILE)
        self._old = os.environ.get("FRONTEND_DIST")

    def tearDown(self):
        if self._old is None:
            os.environ.pop("FRONTEND_DIST", None)
        else:
            os.environ["FRONTEND_DIST"] = self._old
        self.tmp.cleanup()

    def client(self, serve=True):
        if serve:
            os.environ["FRONTEND_DIST"] = self.dist
        else:
            os.environ.pop("FRONTEND_DIST", None)
        return create_app("testing").test_client()

    def test_it_is_off_unless_asked_for(self):
        c = self.client(serve=False)
        self.assertEqual(c.get("/").status_code, 404)
        self.assertEqual(c.get("/health").status_code, 200)

    def test_a_dist_folder_without_an_index_is_ignored_rather_than_half_served(self):
        os.remove(os.path.join(self.dist, "index.html"))
        self.assertEqual(self.client().get("/").status_code, 404)

    def test_serves_the_page_and_its_assets(self):
        c = self.client()
        self.assertIn(b"ardent-index", c.get("/").data)
        self.assertEqual(c.get("/assets/app.js").data.decode(), ASSET)

    def test_client_side_routes_fall_back_to_the_page(self):
        c = self.client()
        for route in ("/sales", "/sources", "/overview", "/watchlist/anything/deep"):
            r = c.get(route)
            self.assertEqual(r.status_code, 200, route)
            self.assertIn(b"ardent-index", r.data, route)

    def test_an_unclaimed_api_path_is_a_json_404_not_the_page(self):
        r = self.client().get("/api/does-not-exist")
        self.assertEqual(r.status_code, 404)
        self.assertEqual(r.content_type, "application/json")
        self.assertNotIn(b"ardent-index", r.data)

    def test_real_api_routes_still_win_over_the_page(self):
        c = self.client()
        self.assertEqual(c.get("/health").get_json()["status"], "ok")
        # Auth still guards data: no token, no data — and no page either.
        r = c.get("/api/brands")
        self.assertEqual(r.status_code, 401)
        self.assertNotIn(b"ardent-index", r.data)

    def test_no_path_can_reach_a_file_outside_dist(self):
        c = self.client()
        attempts = [
            "/../secret.txt", "/%2e%2e/secret.txt", "/..%2fsecret.txt",
            "/assets/../../secret.txt", "/assets/%2e%2e/%2e%2e/secret.txt",
            "/....//secret.txt", "/%2e%2e%2f%2e%2e%2fsecret.txt",
        ]
        for path in attempts:
            r = c.get(path)
            self.assertNotIn(SECRET_FILE.encode(), r.data, path)

    def test_the_debugger_is_not_mounted_in_production(self):
        app = create_app("production")
        self.assertFalse(app.debug)
        rules = {r.rule for r in app.url_map.iter_rules()}
        self.assertNotIn("/console", rules)


if __name__ == "__main__":
    unittest.main(verbosity=2)
