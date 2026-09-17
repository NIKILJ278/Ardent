"""Google Ads and Google Analytics 4.

Both authenticate with a Google OAuth client and a refresh token, which a
business can generate once for its own account (Google's OAuth Playground with
its own client ID works). Google Ads additionally needs the developer token from
the Ads API Center and the customer ID being reported on; an account managed
through a manager (MCC) account also needs that manager's ID as the login
customer.

The previous version called Google Ads API v16, long sunset, without the
required developer-token header, and appended duplicate rows on every sync. It
also wrote GA4's YYYYMMDD dates straight into a date column.
"""
from datetime import date, datetime, timedelta, timezone
from urllib.parse import urlencode

from flask import current_app

from app.extensions import db
from app.services import http
from app.services.ads_writer import upsert_ad_day
from app.services.base_connector import BaseConnector

TOKEN_URL = "https://oauth2.googleapis.com/token"


def _digits(value):
    return "".join(ch for ch in str(value or "") if ch.isdigit())


class _GoogleAuth(BaseConnector):
    """Shared OAuth: the redirect flow and the refresh-token exchange."""

    SCOPE = ""

    def get_authorize_url(self, state: str) -> str:
        params = {
            "client_id": current_app.config["GOOGLE_CLIENT_ID"],
            "redirect_uri": current_app.config["GOOGLE_REDIRECT_URI"],
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
            "scope": self.SCOPE,
            "state": state,
        }
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

    def exchange_code_for_token(self, code: str) -> dict:
        resp = http.request("POST", TOKEN_URL, platform="Google", data={
            "client_id": current_app.config["GOOGLE_CLIENT_ID"],
            "client_secret": current_app.config["GOOGLE_CLIENT_SECRET"],
            "redirect_uri": current_app.config["GOOGLE_REDIRECT_URI"],
            "code": code,
            "grant_type": "authorization_code",
        })
        data = http.json_of(resp, "Google")
        self.connection.access_token = data.get("access_token")
        self.connection.refresh_token = data.get("refresh_token")
        self.connection.status = "connected"
        return data

    def _client(self):
        c = self.credentials
        return (c.get("client_id") or current_app.config.get("GOOGLE_CLIENT_ID"),
                c.get("client_secret") or current_app.config.get("GOOGLE_CLIENT_SECRET"))

    def _access_token(self):
        c = self.credentials
        expires = c.get("_access_expires")
        if c.get("_access_token") and expires and datetime.fromisoformat(expires) > datetime.now(timezone.utc):
            return c["_access_token"]
        client_id, client_secret = self._client()
        refresh = c.get("refresh_token") or self.connection.refresh_token
        if not (client_id and client_secret and refresh):
            raise http.ConnectorAuthError("Enter the Google OAuth client ID, client secret and refresh token")
        resp = http.request("POST", TOKEN_URL, platform="Google", auth_statuses=(400, 401, 403), data={
            "client_id": client_id, "client_secret": client_secret,
            "refresh_token": refresh, "grant_type": "refresh_token",
        })
        body = http.json_of(resp, "Google")
        token = body.get("access_token")
        if not token:
            raise http.ConnectorAuthError("Google did not issue an access token for this refresh token")
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(body.get("expires_in", 3600)) - 60)
        self.remember(_access_token=token, _access_expires=expires_at.isoformat())
        return token


class GoogleAdsConnector(_GoogleAuth):
    platform_name = "google_ads"
    SCOPE = "https://www.googleapis.com/auth/adwords"

    def _customer(self):
        cid = _digits(self.credentials.get("customer_id") or self.connection.external_account_id)
        if len(cid) != 10:
            raise http.ConnectorError("Enter the 10-digit Google Ads customer ID, for example 123-456-7890")
        return cid

    def _search(self, query):
        c = self.credentials
        token = c.get("developer_token")
        if not token:
            raise http.ConnectorAuthError("Enter the Google Ads developer token")
        headers = {"Authorization": f"Bearer {self._access_token()}", "developer-token": token}
        login = _digits(c.get("login_customer_id"))
        if login:
            headers["login-customer-id"] = login
        version = current_app.config.get("GOOGLE_ADS_API_VERSION", "v25")
        url = f"https://googleads.googleapis.com/{version}/customers/{self._customer()}/googleAds:search"
        body = {"query": query}
        while True:
            page = http.json_of(http.request("POST", url, platform="Google Ads", json=body, headers=headers),
                                "Google Ads")
            yield from page.get("results") or []
            if not page.get("nextPageToken"):
                return
            body = {"query": query, "pageToken": page["nextPageToken"]}

    def test_connection(self):
        rows = list(self._search("SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer"))
        customer = (rows[0] if rows else {}).get("customer") or {}
        name = customer.get("descriptiveName") or self._customer()
        return {"account_id": self._customer(), "display_name": f"Google Ads · {name}",
                "currency": customer.get("currencyCode")}

    def sync(self, since=None):
        start = self.window_start(since).date()
        end = date.today()
        query = (
            "SELECT campaign.id, campaign.name, segments.date, metrics.cost_micros, "
            "metrics.impressions, metrics.clicks, metrics.ctr, metrics.conversions, "
            "metrics.conversions_value FROM campaign "
            f"WHERE segments.date BETWEEN '{start.isoformat()}' AND '{end.isoformat()}'"
        )
        rows = 0
        for row in self._search(query):
            m = row.get("metrics") or {}
            campaign = row.get("campaign") or {}
            # Money is in micros; int64 fields arrive as strings over REST.
            upsert_ad_day(
                self.connection.brand_id, "google_ads",
                campaign_id=campaign.get("id"),
                day=date.fromisoformat((row.get("segments") or {})["date"]),
                campaign_name=campaign.get("name"),
                spend=int(m.get("costMicros") or 0) / 1_000_000,
                impressions=int(m.get("impressions") or 0),
                clicks=int(m.get("clicks") or 0),
                purchases=int(round(float(m.get("conversions") or 0))),
                attributed_revenue=float(m.get("conversionsValue") or 0),
                ctr=float(m.get("ctr") or 0) * 100,
            )
            rows += 1
        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "campaign_days": rows,
                "records_synced": rows, "incremental": since is not None}


class GA4Connector(_GoogleAuth):
    platform_name = "ga4"
    SCOPE = "https://www.googleapis.com/auth/analytics.readonly"

    def _property(self):
        pid = _digits(self.credentials.get("property_id") or self.connection.external_account_id)
        if not pid:
            raise http.ConnectorError("Enter the GA4 property ID (numbers only)")
        return pid

    def _report(self, body):
        url = f"https://analyticsdata.googleapis.com/v1beta/properties/{self._property()}:runReport"
        resp = http.request("POST", url, platform="Google Analytics", json=body,
                            headers={"Authorization": f"Bearer {self._access_token()}"})
        return http.json_of(resp, "Google Analytics")

    def test_connection(self):
        today = date.today().isoformat()
        self._report({"dateRanges": [{"startDate": today, "endDate": today}],
                      "metrics": [{"name": "sessions"}], "limit": 1})
        return {"account_id": self._property(), "display_name": f"GA4 · property {self._property()}"}

    def sync(self, since=None):
        start = self.window_start(since).date()
        end = date.today()
        rows, offset, limit = 0, 0, 10000
        while True:
            body = self._report({
                "dateRanges": [{"startDate": start.isoformat(), "endDate": end.isoformat()}],
                "dimensions": [{"name": "sessionDefaultChannelGroup"}, {"name": "date"}],
                "metrics": [{"name": "sessions"}, {"name": "purchaseRevenue"}, {"name": "ecommercePurchases"}],
                "limit": limit, "offset": offset,
            })
            batch = body.get("rows") or []
            for row in batch:
                dims = [d.get("value") for d in row.get("dimensionValues") or []]
                mets = [m.get("value") for m in row.get("metricValues") or []]
                channel = dims[0] if dims else "unknown"
                # GA4 dates are YYYYMMDD.
                day = datetime.strptime(dims[1], "%Y%m%d").date()
                upsert_ad_day(
                    self.connection.brand_id, "ga4",
                    campaign_id=f"channel:{channel}", day=day, campaign_name=channel,
                    sessions=int(float(mets[0] or 0)) if mets else 0,
                    attributed_revenue=float(mets[1] or 0) if len(mets) > 1 else 0.0,
                    purchases=int(float(mets[2] or 0)) if len(mets) > 2 else 0,
                )
                rows += 1
            db.session.commit()
            offset += len(batch)
            if not batch or offset >= int(body.get("rowCount") or 0):
                break
        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "channel_days": rows,
                "records_synced": rows, "incremental": since is not None}


# Kept so existing imports keep working.
GoogleConnector = GoogleAdsConnector
