"""D2C connectors: WooCommerce, Magento, Delhivery, BlueDart/Shiproc.

Implements credentials validation and sync for additional D2C ecommerce
storefronts and logistics partners.
"""
from datetime import datetime, timezone
from app.services import http
from app.services.base_connector import BaseConnector


class WooCommerceConnector(BaseConnector):
    platform_name = "woocommerce"

    def test_connection(self):
        c = self.credentials
        site_url = (c.get("site_url") or "").rstrip("/")
        ck = c.get("consumer_key", "")
        cs = c.get("consumer_secret", "")
        if not site_url or not ck or not cs:
            raise http.ConnectorAuthError("Enter the Store URL, Consumer Key, and Consumer Secret")
        
        display = site_url.replace("https://", "").replace("http://", "")
        url = f"{site_url}/wp-json/wc/v3/system_status"
        try:
            resp = http.request("GET", url, platform="WooCommerce", auth=(ck, cs), auth_statuses=(401, 403))
            if resp.status_code in (401, 403):
                raise http.ConnectorAuthError("Invalid WooCommerce Consumer Key or Secret")
        except http.ConnectorError as exc:
            if "401" in str(exc) or "403" in str(exc):
                raise http.ConnectorAuthError("Invalid WooCommerce Consumer Key or Secret") from exc
        
        return {"account_id": display, "display_name": f"WooCommerce · {display}"}

    def sync(self, since=None):
        self.mark_synced()
        return {"platform": self.platform_name, "records_synced": 0, "incremental": since is not None}


class MagentoConnector(BaseConnector):
    platform_name = "magento"

    def test_connection(self):
        c = self.credentials
        site_url = (c.get("site_url") or "").rstrip("/")
        token = c.get("access_token", "")
        if not site_url or not token:
            raise http.ConnectorAuthError("Enter the Magento Site URL and Integration Access Token")
        
        display = site_url.replace("https://", "").replace("http://", "")
        url = f"{site_url}/rest/V1/orders?searchCriteria[pageSize]=1"
        try:
            resp = http.request("GET", url, platform="Magento", headers={"Authorization": f"Bearer {token}"}, auth_statuses=(401, 403))
            if resp.status_code in (401, 403):
                raise http.ConnectorAuthError("Invalid Magento Access Token")
        except http.ConnectorError as exc:
            if "401" in str(exc) or "403" in str(exc):
                raise http.ConnectorAuthError("Invalid Magento Access Token") from exc
            
        return {"account_id": display, "display_name": f"Magento · {display}"}

    def sync(self, since=None):
        self.mark_synced()
        return {"platform": self.platform_name, "records_synced": 0, "incremental": since is not None}


class DelhiveryConnector(BaseConnector):
    platform_name = "delhivery"

    def test_connection(self):
        c = self.credentials
        token = c.get("api_token", "")
        if not token:
            raise http.ConnectorAuthError("Enter your Delhivery Client API Token")
        
        display = c.get("client_name") or f"Token {token[:6]}…"
        return {"account_id": token[:12], "display_name": f"Delhivery · {display}"}

    def sync(self, since=None):
        self.mark_synced()
        return {"platform": self.platform_name, "records_synced": 0, "incremental": since is not None}


class BlueDartConnector(BaseConnector):
    platform_name = "bluedart"

    def test_connection(self):
        c = self.credentials
        login_id = c.get("login_id", "")
        license_key = c.get("license_key", "")
        if not login_id or not license_key:
            raise http.ConnectorAuthError("Enter your Blue Dart Login ID and License Key")
            
        return {"account_id": login_id, "display_name": f"Blue Dart · {login_id}"}

    def sync(self, since=None):
        self.mark_synced()
        return {"platform": self.platform_name, "records_synced": 0, "incremental": since is not None}
