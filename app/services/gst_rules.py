"""Parsing and checking the pieces of GST that come from people, not from Shopify.

Everything here is strict about what it accepts and says why when it refuses,
because these values end up on tax figures.
"""
import re

# GST state / UT codes and the names the platforms use for them.
STATES = {
    "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
    "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh",
    "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland", "14": "Manipur",
    "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal",
    "20": "Jharkhand", "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
    "26": "Dadra and Nagar Haveli and Daman and Diu", "27": "Maharashtra", "29": "Karnataka",
    "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
    "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh",
}

_ALIASES = {
    "orissa": "21", "uttaranchal": "05", "pondicherry": "34", "nct of delhi": "07",
    "new delhi": "07", "delhi ncr": "07", "jammu & kashmir": "01", "jammu and kashmir": "01",
    "dadra and nagar haveli": "26", "daman and diu": "26", "dadra & nagar haveli and daman & diu": "26",
    "andaman & nicobar islands": "35", "andaman and nicobar": "35", "chattisgarh": "22",
}
_BY_NAME = {name.lower(): code for code, name in STATES.items()}
_BY_NAME.update(_ALIASES)


def state_code(name):
    """The GST state code for a state name as Shopify or a customer wrote it."""
    if not name:
        return None
    key = re.sub(r"\s+", " ", str(name)).strip().lower()
    return _BY_NAME.get(key)


_GSTIN = re.compile(r"^(\d{2})([A-Z]{5}\d{4}[A-Z])([1-9A-Z])Z([0-9A-Z])$")
_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _check_char(body):
    """The GSTIN's final character, from the mod-36 weighted checksum."""
    total = 0
    for i, ch in enumerate(body):
        v = _CHARS.index(ch) * (1 if i % 2 == 0 else 2)
        total += v // 36 + v % 36
    return _CHARS[(36 - total % 36) % 36]


def check_gstin(value):
    """(normalised gstin, None) or (None, reason). Empty means 'not set'."""
    text = (value or "").strip().upper().replace(" ", "")
    if not text:
        return None, None
    m = _GSTIN.match(text)
    if not m:
        return None, "A GSTIN is 15 characters, like 29ABCDE1234F1Z5"
    if m.group(1) not in STATES:
        return None, f"{m.group(1)} is not a GST state code"
    if _check_char(text[:14]) != text[14]:
        return None, "That GSTIN's check character doesn't match — one of the characters is wrong"
    return text, None


def state_of_gstin(gstin):
    if not gstin or len(gstin) < 2 or gstin[:2] not in STATES:
        return None
    return {"code": gstin[:2], "name": STATES[gstin[:2]]}


def parse_rate(raw):
    """A GST rate in percent from what a spreadsheet cell holds.

    Accepts 18, "18", "18%", 12.5. A bare number strictly between 0 and 1 is a
    spreadsheet percent (Excel stores 18% as 0.18) and is read as one.
    Returns (rate, None) or (None, reason); blank is (None, None).
    """
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None, None
    text = str(raw).strip()
    has_pct = text.endswith("%")
    try:
        value = float(text.rstrip("%").replace(",", "").strip())
    except ValueError:
        return None, f"“{text}” is not a number"
    if not has_pct and 0 < value < 1:
        value *= 100
    value = round(value, 4)
    if value < 0 or value > 40:
        return None, f"{value:g}% is outside 0–40%"
    return value, None


def parse_hsn(raw):
    """An HSN code as text. Excel turns 6302 into 6302.0 — undo that; keep 4, 6 or 8 digits."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None, None
    text = str(raw).strip()
    if re.fullmatch(r"\d+\.0", text):
        text = text[:-2]
    if not re.fullmatch(r"\d{4}|\d{6}|\d{8}", text):
        return None, f"HSN “{text}” should be 4, 6 or 8 digits"
    return text, None
