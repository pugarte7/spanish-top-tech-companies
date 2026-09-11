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
    stale = sum(1 for lvl in bands if lib.is_stale(lvl.get("last_verified")))
    parts = [
        f"**{len(entries)} companies**",
        f"**{len(paid)} paying 60k+**",
        # The table footnote already accounts for the undocumented rows, so
        # count what is known rather than repeating the gap twice.
        f"{len(documented)} with pay on file",
    ]
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

    Only an interquartile aggregate has one. A band pooled from a company's
    ladder carries a mean per rung and no distribution, so this returns None
    for it rather than inventing a quartile out of the top rung's average.
    """
    for block in (level.get("base") or {}, level.get("total_comp") or {}):
        if block.get("max") is not None:
            return block["max"]
    return None


def role_headline(bands: dict):
    """The best senior-or-above figure inside one job family, as (euros, kind).

    The highest named rung the company publishes for Spain, not the cheapest
    one that counts as senior: Twilio files 59.986 EUR at senior and 112.167 at
    principal, and a list of what a company pays its senior engineers that
    stops at the first rung answers a narrower question than it looks like.

    A rung beats the all-seniority band even when the band is higher. Unity's
    senior rung is 58.4k and its all-levels mean 70.7k; the mean is higher
    because it pools staff and principals, and reporting it as senior pay would
    be trading a measurement for an average.
    """
    best = None
    for rung in SENIOR_PLUS:
        level = bands.get(rung)
        if not level:
            continue
        value = lib.level_value(level)
        if value is not None and (best is None or value > best[0]):
            best = (value, "senior", level)
    if best:
        return best

    level = bands.get("all")
    if not level:
        return None, None, None
    if level.get("sample_size") == 1:
        return lib.level_value(level), "single", level
    top = upper_quartile(level)
    if top is not None:
        return top, "quartile", level
    return lib.level_value(level), "spread", level


def headline(company: dict):
    """The number the front page shows, as (euros, kind, level, role).

    The best senior-or-above software-engineering figure the company has in
    Spain. A company that has none falls back to its best other job family,
    because a company paying data scientists 108k in Spain is worth a row even
    when Levels.fyi publishes nothing for its engineers - with the family
    printed beside the number, since a data scientist's salary passing silently
    as an engineer's is the kind of quiet wrong answer this list exists to
    avoid.

    kind is how much the number is worth:
      "senior"   a measured rung from a real ladder
      "quartile" the upper quartile of the Spanish aggregate, an estimate
      "spread"   every level at the company averaged together, because its
                 rungs are named L3 and L4 and nothing says which is senior
      "single"   one person's reported salary, not a band at all

    The four are not interchangeable and `exports/` records which is which.
    """
    by_role: dict[str, dict] = {}
    for role, level in lib.iter_levels(company):
        by_role.setdefault(role, {})[level.get("level")] = level

    found = []
    for role, bands in by_role.items():
        value, kind, level = role_headline(bands)
        if value is not None:
            found.append((value, role == "software-engineer", kind, level, role))
    if not found:
        return None, None, None, None
    # Software engineering wins outright, not just on a tie: this list is
    # about engineers, and Amazon's engineering-manager median of 142.5k is a
    # worse answer to "what does a senior engineer get" than its own measured
    # senior rung of 88.9k, however much larger it is.
    value, _, kind, level, role = max(found, key=lambda f: (f[1], f[0]))
    return value, kind, level, role


# A salary someone in Spain told the maintainer directly outranks anything
# crowdsourced, so it sorts above it however large the crowdsourced one is.
VOUCHED = ("offer-letter", "community")


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


def jobs_url(entry: dict) -> str | None:
    """This company's open roles in Spain.

    LinkedIn filters a job search by numeric company id, which is what the
    backlog carries. A company known only by a vanity URL gets the jobs tab on
    its own page instead - the same list, without the country filter.

    The country goes in as `location=Spain`, a literal LinkedIn resolves
    itself. A `geoId` would be faster and is not worth it: get one digit wrong
    and the link confidently serves another country's jobs, which is the exact
    mistake this list exists not to make.
    """
    if entry.get("linkedin_id"):
        return (f"https://www.linkedin.com/jobs/search/?f_C={entry['linkedin_id']}"
                "&location=Spain")
    if entry.get("linkedin_url"):
        return entry["linkedin_url"].rstrip("/") + "/jobs/"
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


def spain_page(entry: dict) -> str | None:
    """The Spain-scoped page that answered with nothing.

    Worth linking: a reader who doubts a blank row can open the same page the
    fetcher read and see the gap for themselves.
    """
    check = entry.get("spain_check") or {}
    roles = check.get("roles") or []
    slug = entry.get("levels_slug")
    if not slug or not roles:
        return None
    role = "software-engineer" if "software-engineer" in roles else roles[0]
    return f"https://www.levels.fyi/companies/{slug}/salaries/{role}/locations/spain"


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
               linkedin_url_=None, spain_check=None, role=None) -> None:
        entry["linkedin_id"] = entry.get("linkedin_id") or linkedin_id
        entry["linkedin_url"] = entry.get("linkedin_url") or linkedin_url_
        entry["spain_check"] = entry.get("spain_check") or spain_check
        if slug and not entry["levels_slug"]:
            entry["levels_slug"] = slug
        if entry["value"] is None and value is not None:
            entry["value"] = value
            entry["kind"] = kind
            entry["level"] = level
            entry["role"] = role
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
        value, kind, level, role = headline(c)
        slug = company_levels_slug(c) or c.get("slug")
        alias = aliases.get(slug or "")
        existing = lookup(c["name"], slug, alias)
        if existing:
            absorb(existing, c["name"], slug, c.get("linkedin_id"), alias,
                   value, kind, level, c.get("linkedin_url"), c.get("spain_check"),
                   role)
            continue
        entry = {
            "name": c["name"],
            "levels_slug": slug,
            "linkedin_id": c.get("linkedin_id"),
            "linkedin_url": c.get("linkedin_url"),
            "value": value,
            "kind": kind,
            "level": level,
            "role": role,
            "spain_check": c.get("spain_check"),
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
            "role": None,
            "spain_check": None,
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

    rows = ["| Company | Senior+ | Roles |", "| --- | --- | --- |"]
    checked = 0
    for e in entries:
        li = linkedin_url(e)
        name = f"[{e['name']}]({li})" if li else e["name"]
        jobs = jobs_url(e)
        roles = f"[open roles]({jobs})" if jobs else "—"
        if e["value"] is not None:
            page = figure_url(e)
            figure = k(e["value"])
            cell = f"[{figure}]({page})" if page else figure
            role = e.get("role")
            if role and role != "software-engineer":
                cell += f" ({role.replace('-', ' ')})"
        elif e.get("spain_check"):
            # Asked and answered. Say so, rather than leaving a dash that
            # reads as "nobody has looked yet".
            checked += 1
            page = spain_page(e)
            cell = f"[no Spain data]({page})" if page else "no Spain data"
        else:
            cell = "—"
        rows.append(f"| {name} | {cell} | {roles} |")

    documented = sum(1 for e in entries if e["value"] is not None)
    rows.append("")
    rows.append(
        f"<sub>{documented} of {len(entries)} companies have pay on file. A figure is "
        "gross annual base salary in euros for the best-paid rung at senior or above, "
        "and links to the page it was read from. A job family in brackets means "
        "Levels.fyi publishes nothing for engineers there and this is the nearest "
        f"family it does publish. **no Spain data** ({checked}) means Levels.fyi was "
        "asked and published nothing for Spain at that company. Company names link "
        "to LinkedIn.</sub>"
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
            "headline_kind": headline(c)[1],
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
        "employees", "sector", "work_model",
        "remote_within_spain", "contract", "working_language",
        "role", "level", "base_min", "base_p50", "base_max",
        "tc_min", "tc_p50", "tc_max", "bonus_pct", "equity", "data_points",
        "sources", "last_verified",
    ])
    for c in companies:
        common = [
            c.get("slug"), c.get("name"), c.get("linkedin_id"), c.get("website"),
            c.get("careers_url"), c.get("hq", {}).get("city"), c.get("hq", {}).get("country"),
            c.get("employees"),
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

