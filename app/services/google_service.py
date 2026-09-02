from datetime import datetime, timezone, date, timedelta
from urllib.parse import urlencode
import requests
from flask import current_app
from app.extensions import db
from app.models import AdSpendRecord
from app.services.base_connector import BaseConnector


class GoogleConnector(BaseConnector):
    # google_ads and ga4 both go through Google's OAuth2, connection.platform
    # tells sync() which one it's dealing with
    platform_name = "google"

    def get_authorize_url(self, state: str) -> str:
        scopes = (
            "https://www.googleapis.com/auth/adwords"
            if self.connection.platform == "google_ads"
            else "https://www.googleapis.com/auth/analytics.readonly"
        )
        params = {
            "client_id": current_app.config["GOOGLE_CLIENT_ID"],
            "redirect_uri": current_app.config["GOOGLE_REDIRECT_URI"],
            "response_type": "code",
            "access_type": "offline",
            "prompt": "consent",
            "scope": scopes,
            "state": state,
        }
        return f"https://accounts.google.com/o/oauth2/v2/auth?{urlencode(params)}"

    def exchange_code_for_token(self, code: str) -> dict:
        resp = requests.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": current_app.config["GOOGLE_CLIENT_ID"],
                "client_secret": current_app.config["GOOGLE_CLIENT_SECRET"],
                "redirect_uri": current_app.config["GOOGLE_REDIRECT_URI"],
                "code": code,
                "grant_type": "authorization_code",
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        self.connection.access_token = data.get("access_token")
        self.connection.refresh_token = data.get("refresh_token")
        self.connection.status = "connected"
        db.session.commit()
        return data

    def sync(self, since: date = None) -> dict:
        if self.connection.platform == "google_ads":
            return self._sync_google_ads(since)
        return self._sync_ga4(since)

    # -- Google Ads: campaign spend/conversions --
    def _sync_google_ads(self, since):
        # should really use the google-ads python client instead of raw REST here
        # and GAQL queries against the Google Ads API. Sketched here as a REST call
        # for structural clarity.
        since = since or (date.today() - timedelta(days=30))
        customer_id = self.connection.external_account_id
        headers = {"Authorization": f"Bearer {self.connection.access_token}"}
        query = f"""
            SELECT campaign.name, metrics.cost_micros, metrics.impressions,
                   metrics.clicks, metrics.conversions, metrics.conversions_value,
                   segments.date
            FROM campaign
            WHERE segments.date BETWEEN '{since}' AND '{date.today()}'
        """
        resp = requests.post(
            f"https://googleads.googleapis.com/v16/customers/{customer_id}/googleAds:search",
            headers=headers,
            json={"query": query},
            timeout=30,
        )
        resp.raise_for_status()
        results = resp.json().get("results", [])

        synced = 0
        for row in results:
            metrics = row.get("metrics", {})
            spend = float(metrics.get("costMicros", 0)) / 1_000_000
            conversions = float(metrics.get("conversions", 0))
            revenue = float(metrics.get("conversionsValue", 0))
            record = AdSpendRecord(
                brand_id=self.connection.brand_id,
                platform="google_ads",
                campaign_name=row.get("campaign", {}).get("name"),
                date=row.get("segments", {}).get("date") or date.today(),
                spend=spend,
                impressions=int(metrics.get("impressions", 0)),
                clicks=int(metrics.get("clicks", 0)),
                purchases=int(conversions),
                attributed_revenue=revenue,
                roas=round(revenue / spend, 2) if spend else 0,
                cac=round(spend / conversions, 2) if conversions else 0,
            )
            db.session.add(record)
            synced += 1

        self.connection.last_synced_at = datetime.now(timezone.utc)
        db.session.commit()
        return {"platform": "google_ads", "records_synced": synced}

    # -- GA4: sessions/channel revenue --
    def _sync_ga4(self, since):
        since = since or (date.today() - timedelta(days=30))
        property_id = self.connection.external_account_id
        headers = {"Authorization": f"Bearer {self.connection.access_token}"}
        body = {
            "dateRanges": [{"startDate": str(since), "endDate": str(date.today())}],
            "dimensions": [{"name": "sessionDefaultChannelGroup"}, {"name": "date"}],
            "metrics": [{"name": "sessions"}, {"name": "totalRevenue"}, {"name": "conversions"}],
        }
        resp = requests.post(
            f"https://analyticsdata.googleapis.com/v1beta/properties/{property_id}:runReport",
            headers=headers,
            json=body,
            timeout=30,
        )
        resp.raise_for_status()
        rows = resp.json().get("rows", [])

        synced = 0
        for row in rows:
            dims = row.get("dimensionValues", [])
            mets = row.get("metricValues", [])
            channel = dims[0]["value"] if dims else "unknown"
            row_date = dims[1]["value"] if len(dims) > 1 else str(date.today())
            sessions = int(float(mets[0]["value"])) if mets else 0
            revenue = float(mets[1]["value"]) if len(mets) > 1 else 0
            conversions = int(float(mets[2]["value"])) if len(mets) > 2 else 0

            record = AdSpendRecord(
                brand_id=self.connection.brand_id,
                platform="ga4",
                campaign_name=channel,
                date=row_date,
                sessions=sessions,
                attributed_revenue=revenue,
                purchases=conversions,
            )
            db.session.add(record)
            synced += 1

        self.connection.last_synced_at = datetime.now(timezone.utc)
        db.session.commit()
        return {"platform": "ga4", "records_synced": synced}
