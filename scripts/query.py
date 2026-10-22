"""Questions agents ask, answered from the site's /api/v1/data.json.

Shared by the MCP server and the llms-full.txt page. It reads only the
published aggregates, so nothing it returns comes from fewer than
`min_group` people: the privacy rule is enforced once, in site.build_data().
Depends on nothing but the data file, so it runs anywhere that file does.
"""
from __future__ import annotations

import json
import pathlib
import re
import unicodedata
import urllib.request


def load(source: str | pathlib.Path) -> dict:
    source = str(source)
    if source.startswith(("http://", "https://")):
        with urllib.request.urlopen(source, timeout=30) as r:
            return json.load(r)
    return json.loads(pathlib.Path(source).read_text(encoding="utf-8"))


def _norm(text) -> str:
    text = unicodedata.normalize("NFKD", str(text or "")).encode("ascii", "ignore").decode()
    return " ".join(text.lower().replace("-", " ").split())


class QueryError(ValueError):
    pass


def _whole(value) -> int | None:
    """An int, a float with nothing after the point or a string of digits; else None.

    api/mcp.js reads numbers the same way, so both servers accept and refuse
    the same arguments: 5.9 years is refused rather than read as 5, and true
    is not 1."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value) if value.is_integer() else None
    if isinstance(value, str) and re.fullmatch(r"\s*-?\d+\s*", value):
        return int(value)
    return None


def resolve_role(data: dict, role: str | None) -> str:
    if not role:
        return ""
    want = _norm(role)
    for r in data["roles"]:
        if want in (_norm(r["slug"]), _norm(r["name"])):
            return r["slug"]
    close = [r["slug"] for r in data["roles"]
             if want in _norm(r["name"]) or want in _norm(r["slug"])]
    if len(close) == 1:
        return close[0]
    raise QueryError(f"unknown role {role!r}; "
                     f"{'did you mean ' + ', '.join(close) if close else 'see list_filters'}")


def resolve_region(data: dict, region: str | None) -> str:
    if not region:
        return ""
    want = _norm(region)
    for code, names in data["regions"].items():
        if want in (_norm(code), _norm(names["en"]), _norm(names["es"])):
            return code
    for code, names in data["regions"].items():
        if want in _norm(names["en"]) or want in _norm(names["es"]):
            return code
    raise QueryError(f"unknown region {region!r}; use a code like MD or a name like Cataluña")


def resolve_years(data: dict, years) -> str:
    if years in (None, ""):
        return ""
    if str(years) in data["years"]:
        return str(years)
    n = _whole(years)
    if n is None:
        raise QueryError(f"years must be a number or one of {', '.join(data['years'])}")
    for bucket in data["years"]:
        low, _, high = bucket.rstrip("+").partition("-")
        if n >= int(low) and (not high or n <= int(high)):
            return bucket
    raise QueryError(f"no bucket holds {n} years; buckets are {', '.join(data['years'])}")


def resolve_limit(limit) -> int:
    if limit in (None, ""):
        return 20
    n = _whole(limit)
    if n is None:
        raise QueryError("limit must be a whole number from 1 to 200")
    return max(1, min(n, 200))


def _key(data: dict, role=None, region=None, years=None) -> tuple[str, dict]:
    r, g, y = resolve_role(data, role), resolve_region(data, region), resolve_years(data, years)
    return f"{r}|{g}|{y}", {"role": r or None, "region": g or None, "years": y or None}


def _figures(a: dict) -> dict:
    return {"people": a["n"], "median_base_eur": a["median"],
            "p25_base_eur": a["p25"], "p75_base_eur": a["p75"],
            "median_total_eur": a["total"], "share_at_60k_base": a["share"]}


def _withheld(data: dict, selection: dict) -> dict:
    return {"selection": selection, "result": None,
            "reason": f"fewer than {data['min_group']} salaries match; "
                      "widen the selection (drop region or years)"}


def stats(data: dict, role=None, region=None, years=None) -> dict:
    key, selection = _key(data, role, region, years)
    a = data["cells"].get(key)
    if not a:
        return _withheld(data, selection)
    return {"selection": selection, "result": _figures(a)}


def top_companies(data: dict, role=None, region=None, years=None,
                  search: str | None = None, limit: int = 20) -> dict:
    key, selection = _key(data, role, region, years)
    limit = resolve_limit(limit)
    found = data["company_cells"].get(key)
    if found is None:
        return _withheld(data, selection)
    want = _norm(search)
    rows = []
    for a in found:
        c = data["companies"][a["c"]]
        if want and want not in _norm(c["name"]):
            continue
        rows.append({"company": c["name"], "url": c["url"], **_figures(a)})
    return {"selection": selection, "companies_listed": len(rows),
            "result": rows[:limit]}


def company(data: dict, name: str, role=None, region=None, years=None) -> dict:
    """One company's published aggregates: overall and by one of role, region or
    years. Naming a role, region or years narrows to the groups that match it,
    combinations included; all of them at once came to ~9k tokens for Glovo."""
    _, selection = _key(data, role, region, years)
    want = _norm(name)
    matches = [i for i, c in enumerate(data["companies"]) if want in _norm(c["name"])]
    exact = [i for i in matches if _norm(data["companies"][i]["name"]) == want]
    matches = exact or matches
    if not matches:
        raise QueryError(f"no company matching {name!r} has {data['min_group']}+ salaries")
    if len(matches) > 1:
        raise QueryError("several companies match: "
                         + ", ".join(data["companies"][i]["name"] for i in matches[:15]))
    i = matches[0]
    asked = [selection[k] or "" for k in ("role", "region", "years")]
    groups = []
    for key, found in data["company_cells"].items():
        parts = key.split("|")
        if any(want_part and part != want_part for part, want_part in zip(parts, asked)):
            continue
        if not any(asked) and sum(1 for part in parts if part) > 1:
            continue
        for a in found:
            if a["c"] == i:
                r, g, y = parts
                groups.append({"role": r or None, "region": g or None,
                               "years": y or None, **_figures(a)})
    groups.sort(key=lambda x: (x["role"] is not None, x["region"] is not None,
                               x["years"] is not None, -x["people"]))
    c = data["companies"][i]
    return {"company": c["name"], "url": c["url"], "cities": c["cities"],
            "selection": selection, "groups": groups}


def filters(data: dict) -> dict:
    return {"roles": [{"slug": r["slug"], "name": r["name"]} for r in data["roles"]],
            "regions": data["regions"], "years": data["years"],
            "min_group": data["min_group"], "quartile_min": data.get("quartile_min"),
            "round_eur": data.get("round_eur"), "threshold_eur": data["threshold"],
            "company_floor_eur": data.get("company_floor"),
            "min_base_eur": data.get("min_base"), "reported": data.get("reported"),
            "data_as_of": data.get("data_as_of") or data["generated"]}
