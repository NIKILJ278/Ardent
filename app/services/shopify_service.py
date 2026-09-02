from datetime import datetime, timezone
from urllib.parse import urlencode
import requests
from flask import current_app
from app.extensions import db
from app.models import Order, OrderItem, Customer
from app.services.base_connector import BaseConnector


class ShopifyConnector(BaseConnector):
    platform_name = "shopify"

    def get_authorize_url(self, state: str) -> str:
        shop = self.connection.external_account_id  # e.g. "mystore.myshopify.com"
        params = {
            "client_id": current_app.config["SHOPIFY_API_KEY"],
            "scope": current_app.config["SHOPIFY_SCOPES"],
            "redirect_uri": current_app.config["SHOPIFY_REDIRECT_URI"],
            "state": state,
        }
        return f"https://{shop}/admin/oauth/authorize?{urlencode(params)}"

    def exchange_code_for_token(self, code: str) -> dict:
        shop = self.connection.external_account_id
        resp = requests.post(
            f"https://{shop}/admin/oauth/access_token",
            json={
                "client_id": current_app.config["SHOPIFY_API_KEY"],
                "client_secret": current_app.config["SHOPIFY_API_SECRET"],
                "code": code,
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        self.connection.access_token = data.get("access_token")
        self.connection.scopes = data.get("scope")
        self.connection.status = "connected"
        db.session.commit()
        return data

    def _headers(self):
        return {"X-Shopify-Access-Token": self.connection.access_token}

    def sync(self, since=None) -> dict:
        shop = self.connection.external_account_id
        params = {"status": "any", "limit": 250}
        if since:
            params["created_at_min"] = since.isoformat()

        url = f"https://{shop}/admin/api/2024-01/orders.json"
        resp = requests.get(url, headers=self._headers(), params=params, timeout=30)
        resp.raise_for_status()
        raw_orders = resp.json().get("orders", [])

        synced = 0
        for raw in raw_orders:
            self._upsert_order(raw)
            synced += 1

        self.connection.last_synced_at = datetime.now(timezone.utc)
        self.connection.status = "connected"
        db.session.commit()

        return {"platform": self.platform_name, "records_synced": synced}

    def _upsert_order(self, raw: dict):
        brand_id = self.connection.brand_id
        external_id = str(raw["id"])

        order = Order.query.filter_by(
            brand_id=brand_id, channel="shopify", external_order_id=external_id
        ).first()
        if not order:
            order = Order(brand_id=brand_id, channel="shopify", external_order_id=external_id)
            db.session.add(order)

        gross = float(raw.get("total_price", 0) or 0)
        discounts = float(raw.get("total_discounts", 0) or 0)
        shipping = sum(float(s.get("price", 0) or 0) for s in raw.get("shipping_lines", []))
        tax = float(raw.get("total_tax", 0) or 0)

        order.order_date = datetime.fromisoformat(raw["created_at"].replace("Z", "+00:00")) if raw.get("created_at") else datetime.now(timezone.utc)
        order.gross_amount = gross
        order.discount_amount = discounts
        order.shipping_amount = shipping
        order.tax_amount = tax
        order.net_amount = gross - discounts
        order.payment_mode = "cod" if "cash on delivery" in str(raw.get("gateway", "")).lower() else "prepaid"
        order.shipping_state = (raw.get("shipping_address") or {}).get("province")
        order.is_cancelled = raw.get("cancelled_at") is not None
        order.status = "cancelled" if order.is_cancelled else raw.get("fulfillment_status") or "placed"

        db.session.flush()

        OrderItem.query.filter_by(order_id=order.id).delete()
        for li in raw.get("line_items", []):
            item = OrderItem(
                order_id=order.id,
                sku=li.get("sku") or f"unknown-{li.get('id')}",
                product_name=li.get("name"),
                quantity=li.get("quantity", 1),
                unit_price=float(li.get("price", 0) or 0),
                line_total=float(li.get("price", 0) or 0) * li.get("quantity", 1),
            )
            db.session.add(item)
