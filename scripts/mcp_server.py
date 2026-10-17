#!/usr/bin/env python3
"""MCP server over the site's salary aggregates. Standard library only.

    python3 scripts/mcp_server.py                      # stdio, for Hermes, Claude, Cursor
    python3 scripts/mcp_server.py --http --port 8787   # Streamable HTTP at /mcp
    python3 scripts/mcp_server.py --data https://<site>/api/v1/data.json

It reads the same /api/v1/data.json the page does (or builds it from
companies.csv when there is no _site/), so it publishes nothing the site does
not: every figure comes from lib.MIN_GROUP people or more. The HTTP mode is
stateless JSON responses, no sessions and no SSE, which the spec allows and
which any host that runs Python can serve.
"""
from __future__ import annotations

import argparse
import http.server
import json
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import query  # noqa: E402

VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
SERVER = {"name": "tech-pay-spain", "title": "Tech Pay Spain", "version": "1.0.0"}
INSTRUCTIONS = (
    "Salaries of people working in Spain, from Levels.fyi submissions and first-hand "
    "reports, in euros per year. Base is gross salary; total adds bonus and stock. "
    "Every figure is a median over 3 or more people; a selection with fewer returns "
    "no result, so widen it instead of guessing. Only companies whose median base over "
    "all their salaries reaches company_floor_eur (see list_filters) are counted; say so "
    "when quoting a figure for Spain. Years are years of experience in "
    "buckets (0-1, 2-4, 5-7, 8-11, 12-19, 20+); pass a number and it is bucketed. "
    "Call list_filters first if unsure of a role or region name. Cite the source as "
    "Tech Pay Spain, with the data date.")

SELECTION = {
    "role": {"type": "string", "description": "Role slug or name, e.g. software-engineer, "
             "Data Scientist, product-manager. Omit for all roles."},
    "region": {"type": "string", "description": "Spanish region code or name, e.g. MD, "
               "Madrid, CT, Cataluña. Omit for all of Spain."},
    "years": {"type": ["integer", "string"], "description": "Years of experience (a number) "
              "or a bucket such as 5-7. Omit for any experience."},
}
READ_ONLY = {"readOnlyHint": True, "openWorldHint": False}
TOOLS = [
    {"name": "salary_stats", "title": "Salary statistics",
     "description": "Median base, middle half (p25-p75), median total comp and share at "
                    "60k+ base for a role, region and experience in Spain.",
     "inputSchema": {"type": "object", "properties": SELECTION},
     "annotations": READ_ONLY},
    {"name": "top_companies", "title": "Best-paying companies",
     "description": "Companies ranked by median base for a selection, each from 3+ "
                    "salaries. Use search to look one company up within the selection.",
     "inputSchema": {"type": "object", "properties": {
         **SELECTION,
         "search": {"type": "string", "description": "Filter companies by name."},
         "limit": {"type": "integer", "minimum": 1, "maximum": 200, "default": 20}}},
     "annotations": READ_ONLY},
    {"name": "company_salaries", "title": "One company's salaries",
     "description": "Every published aggregate for one company in Spain: overall and by "
                    "role, region and experience where 3+ people report.",
     "inputSchema": {"type": "object", "required": ["name"], "properties": {
         "name": {"type": "string", "description": "Company name, e.g. Glovo."}}},
     "annotations": READ_ONLY},
    {"name": "list_filters", "title": "Roles, regions and experience buckets",
     "description": "The role slugs, region codes and experience buckets that have data, "
                    "and the date of the data.",
     "inputSchema": {"type": "object", "properties": {}},
     "annotations": READ_ONLY},
]


def default_data() -> dict:
    built = pathlib.Path(__file__).resolve().parent.parent / "_site" / "api" / "v1" / "data.json"
    if built.exists():
        return query.load(built)
    # By path: `import site` returns the standard library's module, loaded at startup.
    import importlib.util
    import lib
    spec = importlib.util.spec_from_file_location("site_build", built.parents[3] / "scripts" / "site.py")
    site_build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(site_build)
    return site_build.build_data(lib.load_companies())


def call(data: dict, name: str, args: dict) -> dict:
    sel = {k: args.get(k) for k in SELECTION}
    if name == "salary_stats":
        return query.stats(data, **sel)
    if name == "top_companies":
        return query.top_companies(data, **sel, search=args.get("search"),
                                   limit=args.get("limit", 20))
    if name == "company_salaries":
        return query.company(data, args.get("name", ""))
    if name == "list_filters":
        return query.filters(data)
    raise KeyError(name)


def handle(data: dict, msg: dict) -> dict | None:
    """One JSON-RPC message in, its response out (None for notifications)."""
    method, mid = msg.get("method"), msg.get("id")
    if mid is None:
        return None

    def ok(result):
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    def err(code, message):
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}

    params = msg.get("params") or {}
    if method == "initialize":
        asked = params.get("protocolVersion")
        return ok({"protocolVersion": asked if asked in VERSIONS else VERSIONS[0],
                   "capabilities": {"tools": {"listChanged": False}},
                   "serverInfo": SERVER, "instructions": INSTRUCTIONS})
    if method == "ping":
        return ok({})
    if method == "tools/list":
        return ok({"tools": TOOLS})
    if method == "tools/call":
        try:
            out = call(data, params.get("name"), params.get("arguments") or {})
        except KeyError:
            return err(-32602, f"unknown tool {params.get('name')!r}")
        except query.QueryError as e:
            return ok({"content": [{"type": "text", "text": str(e)}], "isError": True})
        return ok({"content": [{"type": "text", "text": json.dumps(out, ensure_ascii=False)}],
                   "structuredContent": out})
    return err(-32601, f"method not found: {method}")


def serve_stdio(data: dict) -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except json.JSONDecodeError:
            reply = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}}
        else:
            reply = handle(data, msg)
        if reply:
            sys.stdout.write(json.dumps(reply, ensure_ascii=False) + "\n")
            sys.stdout.flush()


def serve_http(data: dict, host: str, port: int) -> None:
    class Handler(http.server.BaseHTTPRequestHandler):
        def _send(self, status: int, body: dict | None = None) -> None:
            raw = json.dumps(body, ensure_ascii=False).encode() if body is not None else b""
            self.send_response(status)
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers",
                             "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id")
            if body is not None:
                self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_OPTIONS(self):
            self._send(204)

        def do_GET(self):
            # No server-initiated stream: the spec's answer for that is 405.
            self._send(405 if self.path == "/mcp" else 404,
                       {"error": "POST JSON-RPC to /mcp"})

        def do_POST(self):
            if self.path != "/mcp":
                return self._send(404, {"error": "POST JSON-RPC to /mcp"})
            try:
                msg = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))))
            except (ValueError, json.JSONDecodeError):
                return self._send(400, {"jsonrpc": "2.0", "id": None,
                                        "error": {"code": -32700, "message": "parse error"}})
            reply = handle(data, msg) if isinstance(msg, dict) else None
            self._send(200, reply) if reply else self._send(202)

        def log_message(self, *args):
            pass

    print(f"MCP on http://{host}:{port}/mcp", file=sys.stderr)
    http.server.ThreadingHTTPServer((host, port), Handler).serve_forever()


def main(argv: list[str]) -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--data", default=os.environ.get("TECH_PAY_DATA"),
                   help="path or URL of data.json (default: _site/ or companies.csv)")
    p.add_argument("--http", action="store_true", help="serve Streamable HTTP instead of stdio")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=int(os.environ.get("PORT", 8787)))
    a = p.parse_args(argv)
    data = query.load(a.data) if a.data else default_data()
    if a.http:
        serve_http(data, a.host, a.port)
    else:
        serve_stdio(data)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
