"""Meta Ads (Facebook and Instagram): daily spend and results per campaign.

Two ways to connect. A system-user access token and an ad account ID, typed
into the dashboard, is the simplest for a business's own account: create the
system user in Business Settings → Users → System users, assign it the ad
account, and generate a token with `ads_read`. The OAuth redirect is kept for
installs that use a Meta app instead.

Rows are upserted per campaign per day, so a sync can be repeated without
double-counting spend — the previous version added a fresh row every time.
"""
from datetime import datetime, timezone
from urllib.parse import urlencode

from flask import current_app

from app.extensions import db
from app.services import http
from app.services.ads_writer import upsert_ad_day
from app.services.base_connector import BaseConnector

# Purchase actions overlap: `omni_purchase` already includes the pixel and app
# purchases, so the first present wins and they are never added together.
PURCHASE_ACTIONS = ("omni_purchase", "purchase", "offsite_conversion.fb_pixel_purchase")
FIELDS = "campaign_id,campaign_name,spend,impressions,clicks,ctr,frequency,actions,action_values,date_start"


def _version():
    return current_app.config.get("META_GRAPH_VERSION", "v25.0")


def _pick(actions):
    by_type = {a.get("action_type"): a.get("value") for a in actions or []}
    for name in PURCHASE_ACTIONS:
        if by_type.get(name) is not None:
            try:
                return float(by_type[name])
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def _is_dead_token(resp):
    # Meta reports an expired or revoked token as HTTP 400 with error code 190.
    try:
        return resp.status_code == 400 and (resp.json().get("error") or {}).get("code") in (190, 102)
    except ValueError:
        return False


def normalise_account(value):
    text = str(value or "").strip()
    if not text:
        return None
    digits = text[4:] if text.lower().startswith("act_") else text
    return f"act_{digits}" if digits.isdigit() else None


class MetaAdsConnector(BaseConnector):
    platform_name = "meta_ads"

    # OAuth (kept for app-based installs) ------------------------------------

    def get_authorize_url(self, state: str) -> str:
        params = {
            "client_id": current_app.config["META_APP_ID"],
            "redirect_uri": current_app.config["META_REDIRECT_URI"],
            "scope": "ads_read,read_insights",
            "state": state,
            "response_type": "code",
        }
        return f"https://www.facebook.com/{_version()}/dialog/oauth?{urlencode(params)}"

    def exchange_code_for_token(self, code: str) -> dict:
        resp = http.request("GET", f"https://graph.facebook.com/{_version()}/oauth/access_token",
                            platform="Meta", params={
                                "client_id": current_app.config["META_APP_ID"],
                                "client_secret": current_app.config["META_APP_SECRET"],
                                "redirect_uri": current_app.config["META_REDIRECT_URI"],
                                "code": code,
                            })
        data = http.json_of(resp, "Meta")
        self.connection.access_token = data.get("access_token")
        self.connection.status = "connected"
        return data

    # Credentials ------------------------------------------------------------

    def _token(self):
        token = self.credentials.get("access_token") or self.connection.access_token
        if not token:
            raise http.ConnectorAuthError("Enter a Meta system-user access token")
        return token

    def _account(self):
        account = normalise_account(self.credentials.get("ad_account_id") or self.connection.external_account_id)
        if not account:
            raise http.ConnectorError("Enter the ad account ID, for example act_1234567890")
        return account

    def _get(self, url, params=None):
        resp = http.request("GET", url, platform="Meta", params=params,
                            headers={"Authorization": f"Bearer {self._token()}"},
                            is_auth_failure=_is_dead_token)
        return http.json_of(resp, "Meta")

    def test_connection(self):
        account = self._account()
        body = self._get(f"https://graph.facebook.com/{_version()}/{account}",
                         {"fields": "name,currency,account_status"})
        return {"account_id": account, "display_name": f"Meta Ads · {body.get('name') or account}",
                "currency": body.get("currency")}

    # Sync -------------------------------------------------------------------

    def sync(self, since=None):
        start = self.window_start(since).date()
        end = datetime.now(timezone.utc).date()
        account = self._account()
        url = f"https://graph.facebook.com/{_version()}/{account}/insights"
        params = {
            "level": "campaign",
            "fields": FIELDS,
            "time_increment": 1,
            "time_range": f'{{"since":"{start}","until":"{end}"}}',
            "limit": 500,
        }
        rows = 0
        while url:
            body = self._get(url, params)
            for row in body.get("data") or []:
                spend = float(row.get("spend") or 0)
                purchases = _pick(row.get("actions"))
                upsert_ad_day(
                    self.connection.brand_id, "meta_ads",
                    campaign_id=row.get("campaign_id"),
                    day=datetime.strptime(row["date_start"], "%Y-%m-%d").date(),
                    campaign_name=row.get("campaign_name"),
                    spend=spend,
                    impressions=int(row.get("impressions") or 0),
                    clicks=int(row.get("clicks") or 0),
                    purchases=int(purchases),
                    attributed_revenue=_pick(row.get("action_values")),
                    frequency=float(row.get("frequency") or 0),
                    ctr=float(row.get("ctr") or 0),
                )
                rows += 1
            db.session.commit()
            # `paging.next` is a complete URL with every parameter already on it.
            url = ((body.get("paging") or {}).get("next"))
            params = None

        self.mark_synced()
        db.session.commit()
        return {"platform": self.platform_name, "campaign_days": rows,
                "records_synced": rows, "incremental": since is not None, "window": [str(start), str(end)]}
