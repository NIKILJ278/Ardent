# usage:
#   python manage.py init-db      create all tables
#   python manage.py seed-demo    load demo data for one brand
import sys
from app import create_app
from app.extensions import db


def init_db():
    app = create_app()
    with app.app_context():
        db.create_all()
        print("Tables created.")


def seed_demo():
    from datetime import datetime, timedelta, timezone
    import random
    from app.models import User, Brand, BrandMember, Order, OrderItem, AdSpendRecord, InventoryItem, Customer

    app = create_app()
    with app.app_context():
        db.create_all()

        user = User.query.filter_by(email="demo@brandstack.local").first()
        if not user:
            user = User(email="demo@brandstack.local", full_name="Demo Founder")
            user.set_password("password123")
            db.session.add(user)
            db.session.flush()

        brand = Brand.query.filter_by(name="Demo D2C Brand").first()
        if not brand:
            brand = Brand(name="Demo D2C Brand", industry="apparel", currency="INR")
            db.session.add(brand)
            db.session.flush()
            db.session.add(BrandMember(brand_id=brand.id, user_id=user.id, role="owner"))

        channels = ["shopify", "myntra", "amazon", "flipkart", "eternz"]
        states = ["Maharashtra", "Delhi", "Karnataka", "Uttar Pradesh", "Tamil Nadu", "West Bengal"]
        skus = [("SKU-001", "Classic Tee"), ("SKU-002", "Denim Jacket"), ("SKU-003", "Linen Shirt"),
                ("SKU-004", "Cargo Pants"), ("SKU-005", "Summer Dress")]

        now = datetime.now(timezone.utc)
        for i in range(600):
            channel = random.choice(channels)
            gross = round(random.uniform(500, 4000), 2)
            discount = round(gross * random.uniform(0, 0.15), 2)
            fee = round(gross * (0.2 if channel != "shopify" else 0.02), 2)
            net = round(gross - discount - fee, 2)
            cogs = round(gross * random.uniform(0.35, 0.65), 2)
            margin = round(net - cogs, 2)
            is_rto = random.random() < (0.25 if channel != "shopify" else 0.08)
            is_cancelled = random.random() < 0.1
            order = Order(
                brand_id=brand.id, channel=channel, external_order_id=f"seed-{i}",
                order_date=now - timedelta(days=random.randint(0, 90)),
                gross_amount=gross, discount_amount=discount, marketplace_fee_amount=fee,
                net_amount=net, cogs_amount=cogs, net_margin_amount=margin,
                net_margin_pct=round((margin / net) * 100, 1) if net else 0,
                payment_mode=random.choice(["cod", "prepaid"]),
                shipping_state=random.choice(states),
                is_rto=is_rto, is_cancelled=is_cancelled,
                status="cancelled" if is_cancelled else ("rto" if is_rto else "delivered"),
            )
            db.session.add(order)
            db.session.flush()
            sku, name = random.choice(skus)
            db.session.add(OrderItem(
                order_id=order.id, sku=sku, product_name=name, quantity=1,
                unit_price=gross, unit_cost=cogs, line_total=gross, line_margin=margin,
            ))

        for platform, campaign in [("meta_ads", "Prospecting - Broad"), ("google_ads", "Search - Brand"),
                                     ("meta_ads", "Retargeting - Cart")]:
            for d in range(14):
                spend = round(random.uniform(50, 500), 2)
                db.session.add(AdSpendRecord(
                    brand_id=brand.id, platform=platform, campaign_name=campaign,
                    date=(now - timedelta(days=d)).date(), spend=spend,
                    impressions=random.randint(1000, 50000), clicks=random.randint(50, 2000),
                    purchases=random.randint(1, 50),
                    attributed_revenue=round(spend * random.uniform(0.8, 4.5), 2),
                    frequency=round(random.uniform(1, 5), 2),
                ))

        for sku, name in skus:
            db.session.add(InventoryItem(
                brand_id=brand.id, sku=sku, product_name=name,
                stock_on_hand=random.randint(0, 200), reorder_point=20,
                unit_cost=round(random.uniform(200, 800), 2),
                is_dead_stock=random.random() < 0.1, is_fast_mover=random.random() < 0.3,
            ))

        db.session.commit()
        print(f"Seeded demo brand_id={brand.id} (login demo@brandstack.local / password123)")


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else None
    if cmd == "init-db":
        init_db()
    elif cmd == "seed-demo":
        seed_demo()
    else:
        print("usage: python manage.py [init-db|seed-demo]")
