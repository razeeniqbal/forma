"""Server configuration from environment variables (no secrets stored in FORMA)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Settings:
    data_dir: Path = field(default_factory=lambda: Path(os.environ.get("FORMA_DATA_DIR", "forma-data")).resolve())
    database_url: str = ""
    api_token: str | None = field(default_factory=lambda: os.environ.get("FORMA_API_TOKEN") or None)
    cors_origins: list[str] = field(
        default_factory=lambda: [o.strip() for o in os.environ.get("FORMA_CORS_ORIGINS", "http://localhost:5173,http://localhost:4173").split(",") if o.strip()]
    )
    max_workers: int = field(default_factory=lambda: int(os.environ.get("FORMA_MAX_WORKERS", "2")))
    run_timeout_s: int = field(default_factory=lambda: int(os.environ.get("FORMA_RUN_TIMEOUT", "3600")))
    python: str = field(default_factory=lambda: os.environ.get("FORMA_PYTHON", "") or __import__("sys").executable)

    def __post_init__(self) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        (self.data_dir / "files").mkdir(exist_ok=True)
        (self.data_dir / "runs").mkdir(exist_ok=True)
        if not self.database_url:
            self.database_url = os.environ.get("FORMA_DATABASE_URL") or f"sqlite:///{self.data_dir / 'forma.db'}"

    @property
    def ai_enabled(self) -> bool:
        return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))
