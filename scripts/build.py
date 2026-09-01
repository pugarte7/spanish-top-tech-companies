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


def upper_quartile(level: dict):
    """The 75th percentile of a band, base before total comp.

    An all-seniority band spans juniors to principals, so its median answers
    the wrong question. The upper quartile is where the senior half of the
    company sits, which is the closest this data gets to a senior figure.
    """
    for block in (level.get("base") or {}, level.get("total_comp") or {}):
        if block.get("max") is not None:
            return block["max"]
    return None


def headline(company: dict):
    """The number the front page shows, as (euros, kind).

    kind is how much the number is worth:
      "senior"   a measured senior rung from a real ladder
      "quartile" the upper quartile of the Spanish aggregate, an estimate
      "single"   one person's reported salary, not a band at all

    The three are not interchangeable and the table marks which is which.
    """
    bands = {}
    for role, level in lib.iter_levels(company):
        if role != "software-engineer":
            continue
        bands[level.get("level")] = level
    for rung in SENIOR_PLUS:
        if rung in bands:
            value = lib.level_value(bands[rung])
            if value is not None:
                return value, "senior", bands[rung]
    if "all" in bands:
        level = bands["all"]
        if level.get("sample_size") == 1:
            return lib.level_value(level), "single", level
        # Prefer the upper quartile; fall back to the median when a band
        # carries only a single figure.
        return upper_quartile(level) or lib.level_value(level), "quartile", level
    return None, None, None


# How much a row is worth turning up for. A salary someone in Spain told the
# maintainer directly outranks anything crowdsourced, so it is named plainly.
SOURCE_LABELS = {
    "offer-letter": "offer received",
    "community": "known personally",
    "job-posting": "job ad",
    "company-published": "company",
    "levels.fyi": "levels.fyi",
    "glassdoor": "glassdoor",
}
VOUCHED = ("offer-letter", "community")


def evidence(level: dict | None) -> tuple[str, str]:
    """(data points, where it came from) for one band, ready to print."""
    if not level:
        return "—", "—"
    points = level.get("sample_size")
    names = [s.get("name") for s in (level.get("sources") or []) if s.get("name")]
    # A band the maintainer can vouch for is the one worth naming first.
    names.sort(key=lambda n: (n not in VOUCHED, n))
    label = SOURCE_LABELS.get(names[0], names[0]) if names else "—"
    return (str(points) if points else "—"), label


def linkedin_url(entry: dict) -> str | None:
    """Where the company name points.

    A vanity URL is what a person would recognise and what Levels.fyi records,
    so it wins over the numeric id from the LinkedIn job-search filter. The id
    still resolves, and is all the backlog rows have.
    """
    if entry.get("linkedin_url"):
        return entry["linkedin_url"]
    if entry.get("linkedin_id"):
        return f"https://www.linkedin.com/company/{entry['linkedin_id']}"
    return None


def levels_page(slug: str | None) -> str | None:
    return f"https://www.levels.fyi/companies/{slug}/salaries" if slug else None


def figure_url(entry: dict) -> str | None:
    """Where a figure links to: the page its number was actually read off.

    Not the company's own /companies/<slug>/salaries page. That one is scoped
    by the reader's IP and shows the company's global ladder, so it answers a
    different question than the Spanish figure printed beside it - a reader
    clicking Adyen's Spanish 80.1k used to land on Dutch numbers. Fall back to
    it only for a company we know of but hold no band for.
    """
    for source in (entry.get("level") or {}).get("sources") or []:
        if source.get("url"):
            return source["url"]
    return levels_page(entry["levels_slug"])


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

    def index(entry: dict, name: str | None = None, alias: str | None = None) -> None:
        keys = name_keys(name or entry["name"])
        if alias:
            keys += name_keys(alias)
        for key in keys:
            by_name.setdefault(key, entry)
        if entry["levels_slug"]:
            by_slug.setdefault(entry["levels_slug"], entry)

    def absorb(entry: dict, name: str, slug: str | None, linkedin_id,
               alias: str | None = None, value=None, kind=None, level=None,
               linkedin_url_=None) -> None:
        entry["linkedin_id"] = entry.get("linkedin_id") or linkedin_id
        entry["linkedin_url"] = entry.get("linkedin_url") or linkedin_url_
        if slug and not entry["levels_slug"]:
            entry["levels_slug"] = slug
        if entry["value"] is None and value is not None:
            entry["value"] = value
            entry["kind"] = kind
            entry["level"] = level
        # Levels.fyi files some employers under two slugs, so the same company
        # arrives twice under a plain name and a padded one: Meta and "Meta
        # Facebook", BCG and "Boston Consulting Group (BCG)". The shorter is
        # the one worth showing.
        if len(name) < len(entry["name"]):
            entry["name"] = name
        # Names we have now seen for this company, so the next row carrying one
        # merges here instead of opening a second entry.
        index(entry, name, alias)

    def lookup(name: str, slug: str | None, alias: str | None):
        if slug and slug in by_slug:
            return by_slug[slug]
        for key in name_keys(name) + ([alias.strip().casefold()] if alias else []):
            if key in by_name:
                return by_name[key]
        return None

    # The resolver records the name Levels.fyi answered with, which is how
    # "Meta Facebook" is known to be Meta. Both now have their own company
    # file, so the aliases have to be known before those files are read or the
    # two are appended as separate companies before anything can pair them.
    backlog_rows = []
    aliases: dict[str, str] = {}
    path = lib.ROOT / "data" / "backlog.csv"
    if path.exists():
        with path.open(encoding="utf-8") as fh:
            for row in csv.DictReader(fh):
                if not (row.get("name") or "").strip():
                    continue
                found = re.search(r"matched as ([^,]+)", row.get("notes") or "")
                if found and row.get("levels_slug"):
                    aliases[row["levels_slug"]] = found.group(1).strip()
                backlog_rows.append(row)

    for c in companies:
        value, kind, level = headline(c)
        slug = company_levels_slug(c) or c.get("slug")
        alias = aliases.get(slug or "")
        existing = lookup(c["name"], slug, alias)
        if existing:
            absorb(existing, c["name"], slug, c.get("linkedin_id"), alias,
                   value, kind, level, c.get("linkedin_url"))
            continue
        entry = {
            "name": c["name"],
            "levels_slug": slug,
            "linkedin_id": c.get("linkedin_id"),
            "linkedin_url": c.get("linkedin_url"),
            "value": value,
            "kind": kind,
            "level": level,
        }
        entries.append(entry)
        index(entry, alias=alias)

    for row in backlog_rows:
        name = (row.get("name") or "").strip()
        slug = row.get("levels_slug") or None
        alias = aliases.get(slug or "")
        # Slug first: it is the identity two differently-named rows share
        # (Amazon and "Amazon Web Services (AWS)" both resolve to amazon).
        # Then our name, then the name Levels.fyi answered with.
        existing = lookup(name, slug, alias)
        if existing:
            absorb(existing, name, slug, row.get("linkedin_id"), alias)
            continue
        entry = {
            "name": name,
            "levels_slug": slug,
            "linkedin_id": row.get("linkedin_id"),
            "linkedin_url": None,
            "value": None,
            "kind": None,
            "level": None,
        }
        entries.append(entry)
        index(entry, alias=alias)

    return entries


def render_companies(companies: list[dict]) -> str:
    entries = catalogue(companies)
    if not entries:
        return (
            "_No companies documented yet._ Copy `data/companies/_template.yml`, "
            "fill it in, and run `python3 scripts/build.py`."
        )

    # First-hand before crowdsourced, then best-paying, then everything
    # undocumented alphabetically at the bottom so it reads as a directory
    # rather than a gap. A salary someone in Spain reported directly is worth
    # more than any number scraped from a submission site, so it sorts above
    # one however large that number is.
    def rank(entry: dict):
        level = entry.get("level") or {}
        names = {s.get("name") for s in (level.get("sources") or [])}
        first_hand = bool(names & set(VOUCHED))
        return (not first_hand, entry["value"] is None,
                -(entry["value"] or 0), entry["name"].lower())

    entries.sort(key=rank)

    marks = {"senior": "", "quartile": "*", "single": "\u2020"}
    rows = ["| Company | Senior+ | Data points | Source |", "| --- | --- | --- | --- |"]
    counts = {"senior": 0, "quartile": 0, "single": 0}
    vouched = 0
    for e in entries:
        li = linkedin_url(e)
        name = f"[{e['name']}]({li})" if li else e["name"]
        if e["value"] is None:
            rows.append(f"| {name} | \u2014 | \u2014 | \u2014 |")
            continue
        kind = e.get("kind") or "quartile"
        counts[kind] = counts.get(kind, 0) + 1
        points, source = evidence(e.get("level"))
        if source in ("offer received", "known personally"):
            vouched += 1
            source = f"**{source}**"
        figure = k(e["value"]) + marks.get(kind, "*")
        page = figure_url(e)
        cell = f"[{figure}]({page})" if page else figure
        rows.append(f"| {name} | {cell} | {points} | {source} |")

    documented = sum(1 for e in entries if e["value"] is not None)

    # Only describe a marker the table actually uses. There are no measured
    # senior rungs on the list at the moment, and counting a tier at zero while
    # naming it anyway reads as a stronger dataset than this one is.
    legend = []
    if counts["senior"]:
        legend.append(f"unmarked ({counts['senior']}) is a measured senior salary")
    legend.append(f"`*` ({counts['quartile']}) is the upper quartile of every engineer "
                  "at that company in Spain")
    legend.append(f"`\u2020` ({counts['single']}) is one person's number")

    rows.append("")
    rows.append(
        f"<sub>{documented} of {len(entries)} companies have pay on file, "
        f"{vouched} of them first-hand. **Source** says where the number came from: "
        "**known personally** is someone in Spain who told the maintainer what they "
        "earn, **offer received** is an offer the maintainer was made, and anything "
        "else is crowdsourced and worth less. **Data points** is how many salaries "
        f"the figure rests on. How well a figure is known: {'; '.join(legend)}. "
        "Company names link to LinkedIn, figures to the Levels.fyi page they were "
        "read from.</sub>"
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

