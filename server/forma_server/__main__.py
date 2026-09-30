"""Run the FORMA server:  python -m forma_server  (or `forma-server`)."""
from __future__ import annotations

import argparse
import os


def main() -> None:
    parser = argparse.ArgumentParser(description="FORMA server")
    parser.add_argument("--host", default=os.environ.get("FORMA_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("FORMA_PORT", "8787")))
    args = parser.parse_args()
    import uvicorn

    from .app import create_app

    uvicorn.run(create_app(), host=args.host, port=args.port)


if __name__ == "__main__":
    main()
