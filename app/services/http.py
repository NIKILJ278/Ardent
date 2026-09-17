"""HTTP for connectors.

Every platform throttles, times out and expires tokens in its own way, but the
right response is the same: wait and retry on throttling or a passing server
error, stop immediately on bad credentials, and never retry forever. Putting
that here means each connector only describes its own API.
"""
import time

import requests


class ConnectorError(Exception):
    """The platform answered, but not with data we can use."""


class ConnectorAuthError(ConnectorError):
    """The stored credentials were refused; the user must re-enter them."""


class ConnectorRateLimited(ConnectorError):
    """Still throttled after every retry; the sync can resume later."""


RETRY_STATUSES = {429, 500, 502, 503, 504}


def _wait_for(resp, attempt):
    """Seconds to wait before retrying this response."""
    header = resp.headers.get("Retry-After") if resp is not None else None
    if header:
        try:
            return min(float(header), 60.0)
        except ValueError:
            pass
    return min(2 ** attempt, 30)


def request(method, url, *, platform, attempts=5, sleep=time.sleep, auth_statuses=(401, 403),
            is_auth_failure=None, timeout=60, **kwargs):
    """Make a request, retrying what is worth retrying.

    Raises ConnectorAuthError for a refused credential, ConnectorRateLimited if
    the platform keeps throttling, and ConnectorError for anything else that is
    not a success. Returns the response otherwise.
    """
    last = None
    for attempt in range(attempts):
        try:
            resp = requests.request(method, url, timeout=timeout, **kwargs)
        except requests.RequestException as exc:
            last = exc
            if attempt == attempts - 1:
                raise ConnectorError(f"Could not reach {platform}: {exc.__class__.__name__}") from exc
            sleep(_wait_for(None, attempt))
            continue

        # Some platforms report a dead token as a 400 with a code in the body,
        # so the caller can recognise it rather than relying on the status.
        if resp.status_code in auth_statuses or (is_auth_failure and is_auth_failure(resp)):
            raise ConnectorAuthError(
                f"{platform} rejected the credentials ({resp.status_code}). Check the keys and save them again."
            )
        if resp.status_code in RETRY_STATUSES:
            last = resp
            if attempt == attempts - 1:
                break
            sleep(_wait_for(resp, attempt))
            continue
        if resp.status_code >= 400:
            raise ConnectorError(f"{platform} returned {resp.status_code}: {_brief(resp)}")
        return resp

    # Duck-typed rather than an isinstance check: `last` only needs to look
    # like a response (any object with a status_code works, including the
    # fakes a test builds), and the branch is purely about the number.
    if getattr(last, "status_code", None) == 429:
        raise ConnectorRateLimited(f"{platform} is rate-limiting requests. Sync again in a few minutes.")
    status = getattr(last, "status_code", "no response")
    raise ConnectorError(f"{platform} kept failing ({status}). Try the sync again later.")


def _brief(resp):
    """A short, credential-free description of an error body."""
    try:
        body = resp.json()
    except ValueError:
        return (resp.text or "").strip()[:200] or resp.reason
    if isinstance(body, dict):
        for key in ("message", "error_description", "description", "msg", "errors", "error"):
            value = body.get(key)
            if isinstance(value, dict):
                value = value.get("description") or value.get("message") or value
            if isinstance(value, list) and value:
                first = value[0]
                value = first.get("message") if isinstance(first, dict) else first
            if value:
                return str(value)[:200]
    return str(body)[:200]


def json_of(resp, platform):
    try:
        return resp.json()
    except ValueError as exc:
        raise ConnectorError(f"{platform} returned a response that is not JSON") from exc
