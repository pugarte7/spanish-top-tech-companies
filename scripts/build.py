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


def render_stats(companies: list[dict]) -> str:
    entries = catalogue(companies)
    paid = [e for e in entries if e["value"] is not None and e["value"] >= lib.THRESHOLD_EUR]
    documented = [e for e in entries if e["value"] is not None]
    bands = [lvl for c in companies for _, lvl in lib.iter_levels(c)]
    points = sum(lvl.get("sample_size") or 0 for lvl in bands)
    stale = sum(1 for lvl in bands if lib.is_stale(lvl.get("last_verified")))
    parts = [
        f"**{len(entries)} companies**",
        f"**{len(paid)} paying 60k+**",
        # The table footnote already accounts for the undocumented rows, so
        # count what is known rather than repeating the gap twice.
        f"{len(documented)} with pay on file",
    ]
    # The public route publishes no sample sizes, so don't advertise "0 data points".
    if points:
        parts.append(f"{points} data points")
    if stale:
        parts.append(f"{stale} stale")
    freshest = max(
        (d for d in (lib.parse_date(lvl.get("last_verified")) for lvl in bands) if d),
        default=None,
    )
    if freshest:
        parts.append(f"newest data {freshest}")
    return " · ".join(parts)


# Senior and above, cheapest rung first. A company's senior+ pay is best
# represented by the rung you reach it at; staff and principal sit above.
SENIOR_PLUS = ("senior", "staff", "principal", "lead")


def headline(company: dict):
    """The number the front page shows, as (euros, is_senior_plus).

    Senior or above where the data has it. Most companies are known only
    through a country aggregate, which Levels.fyi publishes as one
    all-seniority median; that is not a senior figure, so it is returned
    flagged and the table marks it.
    """
    bands = {}
    for role, level in lib.iter_levels(company):
        if role != "software-engineer":
            continue
        value = lib.level_value(level)
        if value is not None:
            bands[level.get("level")] = value
    for rung in SENIOR_PLUS:
        if rung in bands:
            return bands[rung], True
    if "all" in bands:
        return bands["all"], False
    return None, False


def linkedin_url(linkedin_id) -> str | None:
    return f"https://www.linkedin.com/company/{linkedin_id}" if linkedin_id else None


def levels_page(slug: str | None) -> str | None:
    return f"https://www.levels.fyi/companies/{slug}/salaries" if slug else None


def company_levels_slug(company: dict) -> str | None:
    """The slug of the company's own Levels.fyi page, if a band cites one.

    Bands taken from a country aggregate cite a role/location page like
    /t/software-engineer/locations/spain, which is about every employer in
    Spain rather than this one. Only /companies/ URLs identify a company.
    """
    for _, level in lib.iter_levels(company):
        for source in level.get("sources", []) or []:
            url = source.get("url") or ""
            if source.get("name") == "levels.fyi" and "/companies/" in url:
                return url.split("/companies/")[1].split("/")[0]
    return None


def catalogue(companies: list[dict]) -> list[dict]:
    """Every company the repo knows about, documented or not.

    Two sources overlap: data/companies/*.yml carries the researched ones,
    data/backlog.csv carries the rest plus the Levels.fyi slugs the resolver
    confirmed. Keyed on that slug where there is one so a company filed twice
    under different names (Adevinta and Adevinta Spain, Amazon and AWS) lands
    on one row, and on the name otherwise.
    """
    entries: list[dict] = []
    by_slug: dict[str, dict] = {}
    by_name: dict[str, dict] = {}

    def name_keys(name: str) -> list[str]:
        """Every spelling a row might use for this company.

        "Boston Consulting Group (BCG)" and "BCG" are one employer filed twice.
        Only uppercase parentheticals count as the acronym, so "(Official)" and
        "(Europe's favourite airline)" do not become merge keys.
        """
        name = name.strip()
        keys = [name.casefold()]
        outer = re.sub(r"\s*\([^)]*\)", "", name).strip()
        if outer and outer.casefold() != keys[0]:
            keys.append(outer.casefold())
        for inner in re.findall(r"\(([^)]{1,6})\)", name):
            token = inner.strip()
            if token.isalnum() and token.isupper():
                keys.append(token.casefold())
        return keys

    def index(entry: dict, name: str | None = None) -> None:
        for key in name_keys(name or entry["name"]):
            by_name.setdefault(key, entry)
        if entry["levels_slug"]:
            by_slug.setdefault(entry["levels_slug"], entry)

    def absorb(entry: dict, name: str, slug: str | None, linkedin_id) -> None:
        entry["linkedin_id"] = entry.get("linkedin_id") or linkedin_id
        if slug and not entry["levels_slug"]:
            entry["levels_slug"] = slug
        # A name we have now seen for this company, so the next row carrying
        # it merges here instead of opening a second entry.
        index(entry, name)

    def lookup(name: str, slug: str | None, alias: str | None):
        if slug and slug in by_slug:
            return by_slug[slug]
        for key in name_keys(name) + ([alias.strip().casefold()] if alias else []):
            if key in by_name:
                return by_name[key]
        return None

    for c in companies:
        value, is_senior = headline(c)
        entry = {
            "name": c["name"],
            "levels_slug": company_levels_slug(c),
            "linkedin_id": c.get("linkedin_id"),
            "value": value,
            "is_senior": is_senior,
        }
        entries.append(entry)
        index(entry)

    path = lib.ROOT / "data" / "backlog.csv"
    if path.exists():
        with path.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                name = (row.get("name") or "").strip()
                if not name:
                    continue
                slug = row.get("levels_slug") or None
                # The resolver records the name Levels.fyi answered with, which
                # is how "Meta Facebook" is known to be Meta: the two are one
                # company under two slugs, so no slug comparison would catch it.
                found = re.search(r"matched as ([^,]+)", row.get("notes") or "")
                alias = found.group(1).strip() if found else None
                # Slug first: it is the identity two differently-named rows
                # share (Amazon and "Amazon Web Services (AWS)" both resolve
                # to amazon). Then our name, then the name they answered with.
                existing = lookup(name, slug, alias)
                if existing:
                    absorb(existing, name, slug, row.get("linkedin_id"))
                    continue
                entry = {
                    "name": name,
                    "levels_slug": slug,
                    "linkedin_id": row.get("linkedin_id"),
                    "value": None,
                    "is_senior": False,
                }
                entries.append(entry)
                index(entry)

    return entries


def render_companies(companies: list[dict]) -> str:
    entries = catalogue(companies)
    if not entries:
        return (
            "_No companies documented yet._ Copy `data/companies/_template.yml`, "
            "fill it in, and run `python3 scripts/build.py`."
        )

    # Paid first and best-paying at the top; everything undocumented falls to
    # the bottom in alphabetical order so it reads as a directory, not a gap.
    entries.sort(key=lambda e: (e["value"] is None, -(e["value"] or 0), e["name"].lower()))

    rows = ["| Company | Senior+ |", "| --- | --- |"]
    approx = 0
    for e in entries:
        li = linkedin_url(e["linkedin_id"])
        name = f"[{e['name']}]({li})" if li else e["name"]
        if e["value"] is None:
            rows.append(f"| {name} | \u2014 |")
            continue
        if not e["is_senior"]:
            approx += 1
        figure = k(e["value"]) + ("" if e["is_senior"] else "*")
        page = levels_page(e["levels_slug"])
        rows.append(f"| {name} | " + (f"[{figure}]({page})" if page else figure) + " |")

    documented = sum(1 for e in entries if e["value"] is not None)
    rows.append("")
    rows.append(
        f"<sub>{documented} of {len(entries)} companies have pay on file; the rest are "
        "on the list but not researched yet. Company names link to LinkedIn, figures to "
        f"Levels.fyi. `*` on {approx} of them means the figure is an all-seniority "
        "median rather than a senior one.</sub>"
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


def main() -> int:
    companies = lib.load_companies()
    text = README.read_text(encoding="utf-8")
    text = replace_block(text, "STATS", render_stats(companies))
    text = replace_block(text, "COMPANIES", render_companies(companies))
    README.write_text(text, encoding="utf-8")
    write_exports(companies)
    print(f"Built README.md and exports/ from {len(companies)} companies.")
    return 0


if __name__ == "__main__":
    sys.exit(main())

