#!/usr/bin/env python3
"""Regenerate the README tables and the exports/ files from data/companies/."""
from __future__ import annotations

import csv
import io
import json
import re
import sys

import lib

README = lib.ROOT / "README.md"



def replace_block(text: str, marker: str, body: str) -> str:
    pattern = re.compile(
        rf"(<!-- BEGIN:{marker} -->\n).*?(\n<!-- END:{marker} -->)", re.DOTALL
    )
    if not pattern.search(text):
        raise SystemExit(f"README.md is missing the {marker} markers")
    return pattern.sub(lambda m: m.group(1) + body + m.group(2), text)


# --------------------------------------------------------------------------- cells


def k(value) -> str:
    if value is None:
        return "—"
    return f"{value / 1000:.1f}k".replace(".0k", "k")


def render_stats(companies: list[dict], backlog: int) -> str:
    listed = shortlist(companies)
    bands = [lvl for c in companies for _, lvl in lib.iter_levels(c)]
    points = sum(lvl.get("sample_size") or 0 for lvl in bands)
    stale = sum(1 for lvl in bands if lib.is_stale(lvl.get("last_verified")))
    parts = [
        f"**{len(listed)} companies**",
        f"**{len(bands)} salary bands**",
    ]
    # The public route publishes no sample sizes, so don't advertise "0 data points".
    if points:
        parts.append(f"{points} data points")
    if stale:
        parts.append(f"{stale} stale")
    if backlog:
        parts.append(f"{backlog} companies not yet researched")
    freshest = max(
        (d for d in (lib.parse_date(lvl.get("last_verified")) for lvl in bands) if d),
        default=None,
    )
    if freshest:
        parts.append(f"newest data {freshest}")
    return " · ".join(parts)


def headline(company: dict):
    """The one number the front page shows, as (euros, is_senior).

    Senior software engineer where the data has it. Most companies are known
    only through a country-level aggregate, which levels.fyi publishes as a
    single all-seniority median; falling back to that keeps them on the list
    instead of blanking four rows in five. The caller marks the difference.
    """
    bands = {}
    for role, level in lib.iter_levels(company):
        if role != "software-engineer":
            continue
        value = lib.level_value(level)
        if value is not None:
            bands[level.get("level")] = value
    if "senior" in bands:
        return bands["senior"], True
    if "all" in bands:
        return bands["all"], False
    return None, False


_BACKLOG_SLUGS: dict[str, str] | None = None


def backlog_slugs() -> dict[str, str]:
    """Company name -> Levels.fyi slug, from the rows the resolver confirmed.

    scripts/resolve_slugs.py probes each slug before writing it here, so these
    are known to exist. Keyed by name because that is what both files share.
    """
    global _BACKLOG_SLUGS
    if _BACKLOG_SLUGS is None:
        _BACKLOG_SLUGS = {}
        path = lib.ROOT / "data" / "backlog.csv"
        if path.exists():
            with path.open(encoding="utf-8") as fh:
                for row in csv.DictReader(fh):
                    if row.get("status") == "resolved" and row.get("levels_slug"):
                        _BACKLOG_SLUGS.setdefault(
                            (row.get("name") or "").strip().casefold(), row["levels_slug"]
                        )
    return _BACKLOG_SLUGS


def levels_url(company: dict):
    """The company's own Levels.fyi page, or nothing.

    Bands taken from a country aggregate cite a role/location page like
    /t/software-engineer/locations/spain. Linking a company name to that sends
    the reader to a page about every employer in Spain, so prefer a /companies/
    URL and otherwise fall back to the slug the resolver verified.
    """
    for _, level in lib.iter_levels(company):
        for source in level.get("sources", []) or []:
            url = source.get("url") or ""
            if source.get("name") == "levels.fyi" and "/companies/" in url:
                return url
    slug = backlog_slugs().get((company.get("name") or "").strip().casefold())
    if slug:
        return f"https://www.levels.fyi/companies/{slug}/salaries"
    return None


def shortlist(companies: list[dict]) -> list[dict]:
    """Companies the front page lists.

    Stricter than lib.qualifies, which admits a company when any role clears
    the threshold: this page shows one software engineering number, so a
    company earns its row only if that number clears it. Everything else stays
    in exports/ and in the data.
    """
    out = []
    for c in companies:
        value, _ = headline(c)
        if value is not None and value >= lib.THRESHOLD_EUR:
            out.append(c)
    return out


def render_companies(companies: list[dict]) -> str:
    listed = shortlist(companies)
    if not listed:
        return (
            "_No companies documented yet._ Copy `data/companies/_template.yml`, "
            "fill it in, and run `python3 scripts/build.py`."
        )

    ranked = []
    for c in listed:
        value, is_senior = headline(c)
        ranked.append((c, value, is_senior))
    # Best-paying first: the list is only useful if the top of it is the top.
    ranked.sort(key=lambda r: (r[1] is None, -(r[1] or 0), r[0]["name"].lower()))

    rows = ["| Company | Senior |", "| --- | --- |"]
    approx = 0
    for c, value, is_senior in ranked:
        url = levels_url(c)
        name = "[" + c["name"] + "](" + url + ")" if url else c["name"]
        if value is None:
            rows.append("| " + name + " | \u2014 |")
            continue
        if not is_senior:
            approx += 1
        rows.append("| " + name + " | " + k(value) + ("" if is_senior else "*") + " |")

    rows.append("")
    if approx:
        rows.append(
            "<sub>Gross annual base, software engineers. `*` on "
            + str(approx) + " of " + str(len(ranked)) + " rows means the figure is "
            "an all-seniority median, not a senior-specific one. "
            "Company names link to levels.fyi.</sub>"
        )
    return chr(10).join(rows)

def write_exports(companies: list[dict]) -> None:
    lib.EXPORTS_DIR.mkdir(exist_ok=True)

    payload = []
    for c in companies:
        record = {key: value for key, value in c.items() if not key.startswith("_")}
        best = lib.top_band(c)
        record["_computed"] = {
            "qualifies": lib.qualifies(c),
            "top_band_eur": best[2] if best else None,
            "top_band_role": best[0] if best else None,
            "top_band_level": best[1]["level"] if best else None,
        }
        payload.append(record)
    (lib.EXPORTS_DIR / "companies.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8"
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([
        "slug", "name", "linkedin_id", "website", "careers_url", "hq_city", "hq_country",
        "spain_presence", "offices_es", "employees", "sector", "work_model",
        "remote_within_spain", "contract", "working_language",
        "role", "level", "base_min", "base_p50", "base_max",
        "tc_min", "tc_p50", "tc_max", "bonus_pct", "equity", "data_points",
        "sources", "last_verified",
    ])
    for c in companies:
        common = [
            c.get("slug"), c.get("name"), c.get("linkedin_id"), c.get("website"),
            c.get("careers_url"), c.get("hq", {}).get("city"), c.get("hq", {}).get("country"),
            c.get("spain_presence"), "|".join(c.get("offices_es") or []), c.get("employees"),
            "|".join(c.get("sector") or []), c.get("work_model"), c.get("remote_within_spain"),
            "|".join(c.get("contract", [])), c.get("working_language"),
        ]
        levels = list(lib.iter_levels(c))
        if not levels:
            writer.writerow(common + [""] * 13)
            continue
        for role, level in levels:
            base = level.get("base", {})
            tc = level.get("total_comp", {}) or {}
            writer.writerow(common + [
                role, level.get("level"),
                base.get("min"), base.get("p50"), base.get("max"),
                tc.get("min"), tc.get("p50"), tc.get("max"),
                level.get("bonus_pct"), level.get("equity"), level.get("sample_size"),
                "|".join(s["name"] for s in level.get("sources", [])),
                level.get("last_verified"),
            ])
    (lib.EXPORTS_DIR / "companies.csv").write_text(buffer.getvalue(), encoding="utf-8")


def count_backlog() -> int:
    path = lib.ROOT / "data" / "backlog.csv"
    if not path.exists():
        return 0
    with path.open(encoding="utf-8") as fh:
        return sum(1 for row in csv.DictReader(fh) if row.get("status") == "unresolved")

        return sum(1 for row in csv.DictReader(fh) if row.get("status") != "resolved")
def main() -> int:
    companies = lib.load_companies()
    text = README.read_text(encoding="utf-8")
    text = replace_block(text, "STATS", render_stats(companies, count_backlog()))
    text = replace_block(text, "COMPANIES", render_companies(companies))
    README.write_text(text, encoding="utf-8")
    write_exports(companies)
    print(f"Built README.md and exports/ from {len(companies)} companies.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

