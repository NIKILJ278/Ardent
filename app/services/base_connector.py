from datetime import datetime, timedelta, timezone

from app.services import credentials as creds


class BaseConnector:
    """What every source can do.

    Two ways in: an OAuth redirect (`get_authorize_url` + `exchange_code_for_token`)
    or credentials typed into the dashboard (`test_connection`). A connector
    implements whichever its platform supports. `sync` is always required.
    """

    platform_name = "base"

    # First sync reaches this far back; later syncs overlap the previous one by
    # OVERLAP, because platforms keep editing recent records (refunds, fees,
    # delivery status) for days after they are created.
    BACKFILL_DAYS = 90
    OVERLAP = timedelta(days=3)

    def __init__(self, connection):
        self.connection = connection
        self._credentials = None

    # OAuth ------------------------------------------------------------------

    def get_authorize_url(self, state: str) -> str:
        raise NotImplementedError(f"{self.platform_name} does not connect through an OAuth redirect")

    def exchange_code_for_token(self, code: str) -> dict:
        raise NotImplementedError(f"{self.platform_name} does not connect through an OAuth redirect")

    # Credentials --------------------------------------------------------------

    @property
    def credentials(self):
        """Decrypted keys for this connection. Loaded once per connector."""
        if self._credentials is None:
            self._credentials = creds.load(self.connection)
        return self._credentials

    def use_credentials(self, values):
        """Work with keys that have not been saved yet, e.g. while testing them."""
        self._credentials = dict(values)
        return self

    def remember(self, **values):
        """Store values back into the encrypted credentials, e.g. a refreshed token."""
        self._credentials = {**self.credentials, **values}
        if self.connection.id is not None:
            try:
                creds.update(self.connection, **values)
            except creds.CredentialError:
                pass  # not saved yet; the caller saves the full set afterwards

    def test_connection(self) -> dict:
        """Prove the keys work with one cheap call.

        Returns what the platform says about the account, at least
        `{"account_id": ..., "display_name": ...}`, so the connection can be
        labelled with something the user recognises.
        """
        raise NotImplementedError(f"{self.platform_name} cannot be connected with credentials")

    # Sync ---------------------------------------------------------------------

    def sync(self, since=None) -> dict:
        raise NotImplementedError

    def window_start(self, since):
        """Where a sync should start reading from, as an aware UTC datetime."""
        now = datetime.now(timezone.utc)
        if since is None:
            return now - timedelta(days=self.BACKFILL_DAYS)
        if since.tzinfo is None:
            since = since.replace(tzinfo=timezone.utc)
        return since - self.OVERLAP

    def mark_synced(self):
        self.connection.last_synced_at = datetime.now(timezone.utc)
        self.connection.status = "connected"
        self.connection.last_error = None
