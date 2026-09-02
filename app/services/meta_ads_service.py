from datetime import datetime, timezone, date, timedelta
from urllib.parse import urlencode
import requests
from flask import current_app
from app.extensions import db
from app.models import AdSpendRecord
from app.services.base_connector import BaseConnector

GRAPH_API_VERSION = "v19.0"


class MetaAdsConnector(BaseConnector):
    platform_name = "meta_ads"

    def get_authorize_url(self, state: str) -> str:
        params = {
            "client_id": current_app.config["META_APP_ID"],
            "redirect_uri": current_app.config["META_REDIRECT_URI"],
            "scope": "ads_read,read_insights",
            "state": state,
            "response_type": "code",
        }
        return f"https://www.facebook.com/{GRAPH_API_VERSION}/dialog/oauth?{urlencode(params)}"

    def exchange_code_for_token(self, code: str) -> dict:
        resp = requests.get(
            f"https://graph.facebook.com/{GRAPH_API_VERSION}/oauth/access_token",
            params={
                "client_id": current_app.config["META_APP_ID"],
                "client_secret": current_app.config["META_APP_SECRET"],
                "redirect_uri": current_app.config["META_REDIRECT_URI"],
                "code": code,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        self.connection.access_token = data.get("access_token")
        self.connection.status = "connected"
        db.session.commit()
        return data

    def sync(self, since: date = None) -> dict:
        ad_account_id = self.connection.external_account_id  # e.g. "act_1234567890"
        since = since or (date.today() - timedelta(days=30))

        resp = requests.get(
            f"https://graph.facebook.com/{GRAPH_API_VERSION}/{ad_account_id}/insights",
            params={
                "access_token": self.connection.access_token,
                "level": "campaign",
                "fields": "campaign_name,spend,impressions,clicks,actions,action_values,frequency,ctr",
                "time_range": f'{{"since":"{since}","until":"{date.today()}"}}',
                "time_increment": 1,
            },
            timeout=30,
        )
        resp.raise_for_status()
        rows = resp.json().get("data", [])

        synced = 0
        for row in rows:
            self._upsert_row(row)
            synced += 1

        self.connection.last_synced_at = datetime.now(timezone.utc)
        self.connection.status = "connected"
        db.session.commit()
        return {"platform": self.platform_name, "records_synced": synced}

    def _upsert_row(self, row: dict):
        brand_id = self.connection.brand_id
        purchases = 0
        revenue = 0.0
        for action in row.get("actions", []) or []:
            if action.get("action_type") == "purchase":
                purchases = int(float(action.get("value", 0)))
        for action_value in row.get("action_values", []) or []:
            if action_value.get("action_type") == "purchase":
                revenue = float(action_value.get("value", 0))

        spend = float(row.get("spend", 0) or 0)
        record = AdSpendRecord(
            brand_id=brand_id,
            platform="meta_ads",
            campaign_name=row.get("campaign_name"),
            date=row.get("date_start") or date.today(),
            spend=spend,
            impressions=int(row.get("impressions", 0) or 0),
            clicks=int(row.get("clicks", 0) or 0),
            purchases=purchases,
            attributed_revenue=revenue,
            roas=round(revenue / spend, 2) if spend else 0,
            cac=round(spend / purchases, 2) if purchases else 0,
            frequency=float(row.get("frequency", 0) or 0),
            ctr=float(row.get("ctr", 0) or 0),
        )
        db.session.add(record)
