#!/usr/bin/env python3
"""Serve HayDex locally using Python's standard library."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys


class WebsiteHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".json": "application/json",
        ".wasm": "application/wasm",
        ".onnx": "application/octet-stream",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "SAMEORIGIN")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), clipboard-write=(self)")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self' 'wasm-unsafe-eval' https://cloud.umami.is; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://static.wikia.nocookie.net; worker-src 'self' blob:; media-src 'self' blob:; connect-src 'self' https://static.wikia.nocookie.net https://gateway.umami.is; frame-src 'self'; frame-ancestors 'self'; object-src 'none'; base-uri 'self'; form-action 'self'")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(404, "Not found")
        return None


def port_number(value):
    try:
        port = int(value)
    except ValueError:
        raise argparse.ArgumentTypeError("Port must be a number.") from None
    if not 1 <= port <= 65535:
        raise argparse.ArgumentTypeError("Port must be between 1 and 65535.")
    return port


def main():
    parser = argparse.ArgumentParser(
        description="Run the trade builder and Barn Lens on your phone's localhost."
    )
    parser.add_argument(
        "--port", type=port_number, default=5173,
        help="Local server port (default: 5173).",
    )
    args = parser.parse_args()
    root = Path(__file__).resolve().parent
    website = root / ("public" if (root / "public").is_dir() else "web")
    required = ["index.html", "scanner/index.html", "data/catalog.json"]
    missing = [name for name in required if not (website / name).is_file()]
    if missing:
        print("Website files are missing: " + ", ".join(missing), file=sys.stderr)
        print("Keep main.py beside the project's web folder.", file=sys.stderr)
        return 1

    handler = partial(WebsiteHandler, directory=str(website))
    try:
        server = ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    except OSError as error:
        print(f"Could not start localhost:{args.port}: {error}", file=sys.stderr)
        print("Try another port: python3 main.py --port 8080", file=sys.stderr)
        return 1

    print("\nHayDex is running.", flush=True)
    print(f"Trade builder: http://localhost:{args.port}/", flush=True)
    print(f"Barn scanner:  http://localhost:{args.port}/scanner/", flush=True)
    print("\nOpen either address in your phone's browser.", flush=True)
    print("Keep this Termux terminal open. Press Ctrl+C to stop.\n", flush=True)
    with server:
        try:
            server.serve_forever(poll_interval=0.25)
        except KeyboardInterrupt:
            print("\nLocal server stopped.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
