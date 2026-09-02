from datetime import datetime, timezone, timedelta
import requests
from flask import current_app
from app.extensions import db
from app.models import Order, OrderItem
from app.services.base_connector import BaseConnector


class UnicommerceConnector(BaseConnector):
    # unicommerce sits in front of amazon/flipkart/myntra/etc with one API,
    # so we don't need a separate connector per marketplace
    platform_name = "unicommerce"

    def get_authorize_url(self, state: str) -> str:
        # Unicommerce uses API-key based auth (not a standard OAuth redirect flow).
        return f"https://{self.connection.external_account_id}.unicommerce.com/oauth/authorize?state={state}"

    def exchange_code_for_token(self, code: str) -> dict:
        resp = requests.post(
            f"https://{self.connection.external_account_id}.unicommerce.com/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "client_id": current_app.config["UNICOMMERCE_API_KEY"],
            },
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        self.connection.access_token = data.get("access_token")
        self.connection.status = "connected"
        db.session.commit()
        return data

    def sync(self, since=None) -> dict:
        since = since or (datetime.now(timezone.utc) - timedelta(days=30))
        headers = {"Authorization": f"Bearer {self.connection.access_token}"}
        resp = requests.get(
            f"https://{self.connection.external_account_id}.unicommerce.com/services/rest/v1/oms/saleOrder/search",
            headers=headers,
            params={"updatedSince": since.isoformat()},
            timeout=30,
        )
        resp.raise_for_status()
        raw_orders = resp.json().get("elements", [])

        synced = 0
        for raw in raw_orders:
            self._upsert_order(raw)
            synced += 1

        self.connection.last_synced_at = datetime.now(timezone.utc)
        self.connection.status = "connected"
        db.session.commit()
        return {"platform": "unicommerce", "records_synced": synced}

    def _upsert_order(self, raw: dict):
        brand_id = self.connection.brand_id
        channel = (raw.get("channel") or "marketplace").lower()  # amazon, flipkart, myntra, eternz
        external_id = str(raw.get("code") or raw.get("id"))

        order = Order.query.filter_by(brand_id=brand_id, channel=channel, external_order_id=external_id).first()
        if not order:
            order = Order(brand_id=brand_id, channel=channel, external_order_id=external_id)
            db.session.add(order)

        gross = float(raw.get("totalPrice", 0) or 0)
        commission = float(raw.get("marketplaceCommission", 0) or 0)

        order.order_date = datetime.fromtimestamp(raw["displayOrderDateTime"] / 1000, tz=timezone.utc) if raw.get("displayOrderDateTime") else datetime.now(timezone.utc)
        order.gross_amount = gross
        order.marketplace_fee_amount = commission
        order.net_amount = gross - commission
        order.shipping_state = (raw.get("shippingAddress") or {}).get("state")
        order.status = raw.get("status", "placed").lower()
        order.is_rto = raw.get("status") == "RTO"
        order.is_returned = raw.get("status") == "RETURNED"
        order.is_cancelled = raw.get("status") == "CANCELLED"

        db.session.flush()
        OrderItem.query.filter_by(order_id=order.id).delete()
        for li in raw.get("saleOrderItems", []):
            item = OrderItem(
                order_id=order.id,
                sku=li.get("itemSku", "unknown"),
                product_name=li.get("itemName"),
                quantity=li.get("quantity", 1),
                unit_price=float(li.get("sellingPrice", 0) or 0),
                line_total=float(li.get("totalPrice", 0) or 0),
            )
            db.session.add(item)
