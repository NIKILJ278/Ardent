"""One row per platform, campaign and day, written the same way for every ad source."""
from app.extensions import db
from app.models import AdSpendRecord


def upsert_ad_day(brand_id, platform, *, campaign_id, day, campaign_name=None, spend=0.0,
                  impressions=0, clicks=0, purchases=0, attributed_revenue=0.0, sessions=0,
                  frequency=0.0, ctr=0.0):
    """Replace the figures for one campaign on one day.

    Platforms restate recent days as conversions attribute late, so the latest
    read of a day always wins rather than being added to the previous one.
    """
    key = str(campaign_id or campaign_name or "unknown")
    row = AdSpendRecord.query.filter_by(
        brand_id=brand_id, platform=platform, campaign_id=key, date=day,
    ).first()
    if row is None:
        row = AdSpendRecord(brand_id=brand_id, platform=platform, campaign_id=key, date=day)
        db.session.add(row)
    row.campaign_name = campaign_name
    row.spend = float(spend or 0)
    row.impressions = int(impressions or 0)
    row.clicks = int(clicks or 0)
    row.sessions = int(sessions or 0)
    row.purchases = int(purchases or 0)
    row.attributed_revenue = float(attributed_revenue or 0)
    row.frequency = float(frequency or 0)
    row.ctr = float(ctr or 0)
    row.roas = round(row.attributed_revenue / row.spend, 2) if row.spend else 0.0
    row.cac = round(row.spend / row.purchases, 2) if row.purchases else 0.0
    return row
