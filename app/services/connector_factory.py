"""Every source Ardent can connect, and what each needs from the user.

The dashboard builds its connection forms from this catalogue, so adding a
platform is one entry here plus its connector — no new screen.

`auth` is one of:
  credentials  keys typed into the dashboard, stored encrypted, tested on save
  oauth        a redirect to the platform's consent screen
  file         the platform publishes no data API; its reports are uploaded
"""
from app.services.amazon_service import AmazonConnector
from app.services.cashfree_service import CashfreeConnector
from app.services.file_import_service import OrderReportConnector, PaymentReportConnector
from app.services.flipkart_service import FlipkartConnector
from app.services.google_service import GA4Connector, GoogleAdsConnector
from app.services.meta_ads_service import MetaAdsConnector
from app.services.payu_service import PayUConnector
from app.services.razorpay_service import RazorpayConnector
from app.services.shiprocket_service import ShiprocketConnector
from app.services.shopify_service import ShopifyConnector
from app.services.stripe_service import StripeConnector


def field(key, label, *, secret=False, required=True, placeholder="", help="", options=None, default=None):
    return {"key": key, "label": label, "secret": secret, "required": required,
            "placeholder": placeholder, "help": help, "options": options, "default": default}


ENVIRONMENT = field("environment", "Environment", required=False, default="production",
                    options=[{"value": "production", "label": "Live"}, {"value": "test", "label": "Test"}])

CATALOG = [
    # ── Storefront ───────────────────────────────────────────────────────────
    {
        "id": "shopify", "name": "Shopify", "category": "store", "auth": "credentials",
        "connector": ShopifyConnector, "account_field": "shop",
        "provides": ["orders", "products", "refunds", "unit costs"],
        "docs": "https://shopify.dev/docs/apps/build/dev-dashboard/get-api-access-tokens",
        "fields": [
            field("shop", "Store domain", placeholder="yourstore.myshopify.com",
                  help="The permanent .myshopify.com domain, not your custom domain."),
            field("client_id", "Client ID", required=False,
                  help="From your app in the Shopify Dev Dashboard → Settings."),
            field("client_secret", "Client secret", secret=True, required=False),
            field("admin_api_token", "Admin API access token", secret=True, required=False,
                  placeholder="shpat_…",
                  help="Only if you have an older custom app. Use this or the client ID and secret."),
        ],
        # Either pair works; the form enforces one of them.
        "one_of": [["client_id", "client_secret"], ["admin_api_token"]],
        "notes": "A client ID and secret work only when the app and the store belong to the same "
                 "Shopify organization. For any other store use Connect store, which installs through Shopify.",
        "also_oauth": True,
    },

    # ── Marketplaces ─────────────────────────────────────────────────────────
    {
        "id": "amazon", "name": "Amazon", "category": "marketplace", "auth": "credentials",
        "connector": AmazonConnector, "account_field": "client_id",
        "provides": ["orders", "marketplace fees", "refunds"],
        "docs": "https://developer-docs.amazon/sp-api/docs/self-authorization",
        "fields": [
            field("client_id", "LWA client ID", placeholder="amzn1.application-oa2-client.…",
                  help="Seller Central → Apps and Services → Develop Apps → your app → LWA credentials."),
            field("client_secret", "LWA client secret", secret=True),
            field("refresh_token", "Refresh token", secret=True, placeholder="Atzr|…",
                  help="Generated when you authorise your own app in Develop Apps."),
            field("region", "Region", required=False, default="eu", options=[
                {"value": "eu", "label": "Europe, India & Middle East"},
                {"value": "na", "label": "North America"},
                {"value": "fe", "label": "Far East"},
            ]),
            field("marketplace_id", "Marketplace ID", required=False, default="A21TJRUUN4KGV",
                  help="A21TJRUUN4KGV is Amazon.in."),
        ],
        "notes": "Amazon allows about one order page every three minutes after a short burst. A large "
                 "first sync stops when throttled and the next sync carries on from the same place.",
    },
    {
        "id": "flipkart", "name": "Flipkart", "category": "marketplace", "auth": "credentials",
        "connector": FlipkartConnector, "account_field": "app_id",
        "provides": ["orders", "cancellations"],
        "docs": "https://seller.flipkart.com/api-docs/FMSAPI.html",
        "fields": [
            field("app_id", "Application ID",
                  help="Seller Hub → Manage Profile → Developer Access → create a self-access application."),
            field("app_secret", "Application secret", secret=True),
        ],
        "notes": "Flipkart's order API does not include commission or fees, so Flipkart fees stay "
                 "unreported until a settlement source is added.",
    },
    {
        "id": "myntra", "name": "Myntra", "category": "marketplace", "auth": "file", "kind": "orders",
        "connector": OrderReportConnector,
        "provides": ["orders", "returns", "commission (if in report)"],
        "docs": "https://partners.myntrainfo.com/",
        "notes": "Myntra has no public seller API. Download the orders report from the Myntra Partner "
                 "Portal and upload it here.",
    },
    {
        "id": "nykaa", "name": "Nykaa", "category": "marketplace", "auth": "file", "kind": "orders",
        "connector": OrderReportConnector, "provides": ["orders", "returns"],
        "notes": "Nykaa has no public seller API. Upload the orders report from the Nykaa seller panel.",
    },
    {
        "id": "ajio", "name": "AJIO", "category": "marketplace", "auth": "file", "kind": "orders",
        "connector": OrderReportConnector, "provides": ["orders", "returns"],
        "notes": "AJIO has no public seller API. Upload the orders report from the AJIO seller portal.",
    },
    {
        "id": "meesho", "name": "Meesho", "category": "marketplace", "auth": "file", "kind": "orders",
        "connector": OrderReportConnector, "provides": ["orders", "returns"],
        "notes": "Meesho has no public seller API. Upload the order report from the Meesho supplier panel.",
    },
    {
        "id": "other_marketplace", "name": "Other marketplace", "category": "marketplace", "auth": "file",
        "kind": "orders", "connector": OrderReportConnector, "provides": ["orders"],
        "notes": "Any channel that can export an order report: upload it and map its columns.",
    },

    # ── Payments ─────────────────────────────────────────────────────────────
    {
        "id": "razorpay", "name": "Razorpay", "category": "payments", "auth": "credentials",
        "connector": RazorpayConnector, "account_field": "key_id",
        "provides": ["payments", "gateway fees", "refunds", "settlements"],
        "docs": "https://razorpay.com/docs/api/authentication/",
        "fields": [
            field("key_id", "Key ID", placeholder="rzp_live_…",
                  help="Dashboard → Account & Settings → API Keys."),
            field("key_secret", "Key secret", secret=True),
        ],
    },
    {
        "id": "payu", "name": "PayU", "category": "payments", "auth": "credentials",
        "connector": PayUConnector, "account_field": "merchant_key",
        "provides": ["payments", "gateway fees", "settlement references"],
        "docs": "https://docs.payu.in/reference/get_transaction_details_api",
        "fields": [
            field("merchant_key", "Merchant key", help="PayU Dashboard → Developers → API Keys."),
            field("salt", "Salt", secret=True, help="Use the salt version your account signs with."),
            ENVIRONMENT,
        ],
    },
    {
        "id": "cashfree", "name": "Cashfree Payments", "category": "payments", "auth": "credentials",
        "connector": CashfreeConnector, "account_field": "client_id",
        "provides": ["settled payments", "gateway fees", "refunds", "settlements"],
        "docs": "https://www.cashfree.com/docs/api-reference/payments/latest/settlement-reconciliation/settlement-reconciliation",
        "fields": [
            field("client_id", "App ID", help="Merchant Dashboard → Developers → API Keys."),
            field("client_secret", "Secret key", secret=True),
            field("environment", "Environment", required=False, default="production", options=[
                {"value": "production", "label": "Live"}, {"value": "sandbox", "label": "Sandbox"},
            ]),
        ],
        "notes": "Cashfree reports payments once they settle, so payments from the last day or two "
                 "appear on a later sync.",
    },
    {
        "id": "stripe", "name": "Stripe", "category": "payments", "auth": "credentials",
        "connector": StripeConnector, "account_field": None,
        "provides": ["payments", "gateway fees", "refunds", "payouts"],
        "docs": "https://docs.stripe.com/keys",
        "fields": [
            field("secret_key", "Secret or restricted key", secret=True, placeholder="rk_live_…",
                  help="A restricted key with read access to Balance and Payouts is enough."),
        ],
    },
    {
        "id": "phonepe", "name": "PhonePe", "category": "payments", "auth": "file", "kind": "payments",
        "connector": PaymentReportConnector, "provides": ["payments", "gateway fees"],
        "notes": "PhonePe's API can only look up one transaction at a time. Upload the transaction "
                 "report from the PhonePe Business dashboard instead.",
    },
    {
        "id": "paytm", "name": "Paytm", "category": "payments", "auth": "file", "kind": "payments",
        "connector": PaymentReportConnector, "provides": ["payments", "gateway fees"],
        "notes": "Upload the transaction or settlement report from the Paytm for Business dashboard.",
    },
    {
        "id": "other_gateway", "name": "Other payment gateway", "category": "payments", "auth": "file",
        "kind": "payments", "connector": PaymentReportConnector, "provides": ["payments", "fees"],
        "notes": "Any gateway that exports a transaction report (PayPal, CCAvenue, Easebuzz …).",
    },

    # ── Shipping ─────────────────────────────────────────────────────────────
    {
        "id": "shiprocket", "name": "Shiprocket", "category": "shipping", "auth": "credentials",
        "connector": ShiprocketConnector, "account_field": "email",
        "provides": ["shipments", "freight cost", "COD charges", "RTO"],
        "docs": "https://apidocs.shiprocket.in/",
        "fields": [
            field("email", "API user email",
                  help="Shiprocket → Settings → API → Configure → create an API user. It is separate "
                       "from your normal login."),
            field("password", "API user password", secret=True),
        ],
        "notes": "Parcels are matched to orders by order number, so a Shopify order #1001 shipped "
                 "through Shiprocket gets its courier cost.",
    },

    # ── Advertising ──────────────────────────────────────────────────────────
    {
        "id": "meta_ads", "name": "Meta Ads", "category": "ads", "auth": "credentials",
        "connector": MetaAdsConnector, "account_field": "ad_account_id",
        "provides": ["ad spend", "impressions", "clicks", "purchases", "attributed revenue"],
        "docs": "https://www.facebook.com/business/help/503306463479099",
        "fields": [
            field("ad_account_id", "Ad account ID", placeholder="act_1234567890",
                  help="Business Settings → Accounts → Ad accounts."),
            field("access_token", "System user access token", secret=True,
                  help="Business Settings → Users → System users → Generate token with ads_read."),
        ],
    },
    {
        "id": "google_ads", "name": "Google Ads", "category": "ads", "auth": "credentials",
        "connector": GoogleAdsConnector, "account_field": "customer_id",
        "provides": ["ad spend", "impressions", "clicks", "conversions", "conversion value"],
        "docs": "https://developers.google.com/google-ads/api/docs/get-started/introduction",
        "fields": [
            field("customer_id", "Customer ID", placeholder="123-456-7890"),
            field("developer_token", "Developer token", secret=True,
                  help="Google Ads → Tools → API Center (a manager account is needed to see it)."),
            field("client_id", "OAuth client ID", placeholder="….apps.googleusercontent.com"),
            field("client_secret", "OAuth client secret", secret=True),
            field("refresh_token", "Refresh token", secret=True, placeholder="1//…",
                  help="Generate once for your account, e.g. with Google's OAuth Playground and your client ID."),
            field("login_customer_id", "Manager account ID", required=False,
                  help="Only if this account is reached through a manager (MCC) account."),
        ],
    },
    {
        "id": "ga4", "name": "Google Analytics 4", "category": "ads", "auth": "credentials",
        "connector": GA4Connector, "account_field": "property_id",
        "provides": ["sessions by channel", "purchase revenue"],
        "docs": "https://developers.google.com/analytics/devguides/reporting/data/v1",
        "fields": [
            field("property_id", "Property ID", placeholder="123456789"),
            field("client_id", "OAuth client ID"),
            field("client_secret", "OAuth client secret", secret=True),
            field("refresh_token", "Refresh token", secret=True,
                  help="Authorised with the analytics.readonly scope."),
        ],
    },
]

BY_ID = {entry["id"]: entry for entry in CATALOG}
CATEGORIES = [
    {"id": "store", "label": "Storefront"},
    {"id": "marketplace", "label": "Marketplaces"},
    {"id": "payments", "label": "Payments"},
    {"id": "shipping", "label": "Shipping"},
    {"id": "ads", "label": "Advertising & analytics"},
]

# Kept for callers that import the old name.
CONNECTOR_REGISTRY = {entry["id"]: entry["connector"] for entry in CATALOG}
CONNECTOR_REGISTRY["instagram"] = MetaAdsConnector


def spec(platform):
    return BY_ID.get(platform)


def public_spec(entry):
    """The catalogue entry as the dashboard sees it: no classes, no secrets."""
    return {k: v for k, v in entry.items() if k != "connector"}


def secret_keys(platform):
    entry = BY_ID.get(platform) or {}
    return {f["key"] for f in entry.get("fields") or [] if f["secret"]}


def get_connector(connection):
    connector_cls = CONNECTOR_REGISTRY.get(connection.platform)
    if not connector_cls:
        raise ValueError(f"No connector implemented for platform '{connection.platform}'")
    return connector_cls(connection)
