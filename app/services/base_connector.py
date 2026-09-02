from abc import ABC, abstractmethod


class BaseConnector(ABC):
    platform_name = "base"

    def __init__(self, connection):
        self.connection = connection

    @abstractmethod
    def get_authorize_url(self, state: str) -> str:
        raise NotImplementedError

    @abstractmethod
    def exchange_code_for_token(self, code: str) -> dict:
        raise NotImplementedError

    @abstractmethod
    def sync(self, since=None) -> dict:
        # returns e.g. {"records_synced": 120, "since": "..."}
        raise NotImplementedError
