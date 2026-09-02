from app.services.shopify_service import ShopifyConnector
from app.services.meta_ads_service import MetaAdsConnector
from app.services.google_service import GoogleConnector
from app.services.unicommerce_service import UnicommerceConnector

CONNECTOR_REGISTRY = {
    "shopify": ShopifyConnector,
    "meta_ads": MetaAdsConnector,
    "instagram": MetaAdsConnector,  # Instagram insights ride on the Meta Graph API
    "google_ads": GoogleConnector,
    "ga4": GoogleConnector,
    "amazon": UnicommerceConnector,
    "flipkart": UnicommerceConnector,
    "myntra": UnicommerceConnector,
    "unicommerce": UnicommerceConnector,
}


def get_connector(connection):
    connector_cls = CONNECTOR_REGISTRY.get(connection.platform)
    if not connector_cls:
        raise ValueError(f"No connector implemented for platform '{connection.platform}'")
    return connector_cls(connection)
