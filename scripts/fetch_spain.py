#!/usr/bin/env python3
"""Fetch Spain-scoped pay per company from Levels.fyi, and only Spain.

    python3 scripts/fetch_spain.py                 # every resolved company in companies.csv
    python3 scripts/fetch_spain.py --company glovo
    python3 scripts/fetch_spain.py --audit         # report, write nothing

Why this exists instead of fetch_company.py: that script reads
/companies/<slug>/salaries, which is scoped by the caller's IP and silently
falls back to another country when Levels.fyi has no Spanish submissions. Its
only guard is that the page currency is EUR, which every euro-zone country
passes. Adyen, Celonis, N26, TomTom and FREE NOW all returned Dutch or German
salaries that way, and Datadog, Microsoft and Amazon returned US ones.

The per-location page carries three sources of Spanish pay and they disagree
constantly. All three are read here, because each one covers companies the
others miss:

  averages     Per-level means for the location asked about, each with a
               submission count and the company's own rung names. The only
               source that says which rung a figure belongs to, so the only
               one that can produce a senior salary rather than an
               all-seniority blur. Amazon serves a United States aggregate
               next to 50 Spanish submissions filed here across four rungs.
  percentiles  An interquartile aggregate. Falls back to another country when
               the Spanish sample is below their publication threshold;
               `percentiles.locationName` names the country actually served
               and is the guard. `locationMeta` is not usable for this, it
               only echoes back the URL.
  median       One real submission for the location requested. Stays Spanish
               even when the aggregate has given up.

EVERY MONEY FIELD IN THE PAYLOAD IS USD. The page prints euros by multiplying
by `locationExchangeRate`, and the euro figures in its own FAQ text confirm it:
Glovo's Spanish median total of 79710.65 is published as "€68,551", which is
79710.65 x 0.86. An earlier version of this script wrote the raw numbers into a
file whose `compensation.currency` says EUR, which put every one of its 141
bands about 16% over the truth. `fetch_levels_public.py` had converted from the
day it was written; this script was the one that forgot.

`generatedOccupationSchema.sampleSize` looks like the Spanish submission count
and is not one. It equals the sum of the `averages` counts when there are
averages, and the company's global submission count when there are none:
Amadeus reports 429 beside an empty `averages` and a page that says "Not enough
data". Only the `averages` counts are a real Spanish sample size.
"""
from __future__ import annotations

import argparse
import copy
import gzip
import json
import re
import sys
import time
import urllib.error
import urllib.request

import lib

BASE = "https://www.levels.fyi"
# The job family the list is about. --role reads any other one Levels.fyi
# publishes; the page shape and every guard below are the same either way.
ROLE = "software-engineer"
ATTRIBUTION = "Data source: Levels.fyi (https://www.levels.fyi)"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

# Company rung -> the level slugs lib.LEVEL_ORDER allows.
#
# Searched most senior first and against every title a rung carries, not just
# its slug. Both halves of that matter. Amazon files its senior rung as
# `sde-iii` and only the third of its three titles, "Senior SDE", says what it
# is; Accenture's "Senior Manager" is a manager and Amazon's "Senior Principal
# SDE" is a principal, so whichever pattern is checked first wins the rung.
#
# A rung whose name carries no seniority word at all - "L3", "Software
# Engineer II", "Grade 10" - is left unmapped on purpose. Deciding that Glovo's
# L3 is a senior engineer would be a guess, and a guess filed as data is the
# failure this repository keeps paying for. Those companies still get an `all`
# band; they just do not get a senior one.
LEVEL_PATTERNS = [
    ("intern", r"\bintern(ship)?s?\b"),
    ("director", r"\bdirector\b|\bvp\b|\bvice president\b|\bhead of\b"),
    ("manager", r"\bmanager\b|\bmgr\b"),
    ("principal", r"\bprincipal\b|\bdistinguished\b|\bfellow\b"),
    ("staff", r"\bstaff\b"),
    ("lead", r"\blead\b|\bleader\b"),
    ("senior", r"\bsenior\b|\bsr\.?\b"),
    ("mid", r"\bmid\b|\bmid[- ]level\b|\bintermediate\b"),
    ("junior", r"\bjunior\b|\bjr\.?\b|\bassociate\b|\bgraduate\b|\bentry\b"
               r"|\btrainee\b|\bapprentice\b"),
]


def unscoped(band: dict) -> bool:
    """Was this band read off a page that never named a location?

    A /companies/<slug>/salaries URL is the company's global ladder, served in
    whatever currency the caller's IP implies. Only a URL naming a location
    says where the money was earned.

    The test is the source URL, not the wording of `notes`. An earlier version
    matched on "reports this as" and so caught the per-level rows while missing
    "Median across all levels" and "Common Range Average across all levels" -
    173 of the 205 stale bands, which then shipped.
    """
    url = band.get("source_url") or ""
    return "levels.fyi" in url and "/locations/" not in url


def ours(band: dict) -> bool:
    """Was this band written by this script on an earlier run?

    Those are replaced wholesale, because the ladder they came from can gain
    and lose rungs between runs and a stale `senior` left behind would outrank
    the `all` band that replaced it. Anything with a source this script does
    not write - a first-hand figure, a job ad, a country-page row - is left
    exactly where it is.
    """
    url = band.get("source_url") or ""
    return (band.get("source") == "levels.fyi"
            and "/companies/" in url and "/locations/" in url)


def superseded(band: dict, replacing: set[str]) -> bool:
    """A weaker Levels.fyi reading of a level this run just measured.

    A country page (/t/<role>/locations/spain) publishes one median per company
    across every level; the company's own Spain-scoped page publishes a real
    range for the same role. Keep both and the role ends up with two bands at
    level `all` disagreeing with each other, which is what Vestas, BCG and six
    others looked like.

    Only a Levels.fyi band is replaced. A first-hand figure or a job ad at the
    same level is worth more than anything scraped and stays.
    """
    return band.get("level") in replacing and band.get("source") == "levels.fyi"


class Blocked(RuntimeError):
    """Levels.fyi's WAF returned a bot challenge."""


def get(url: str, delay: float, attempts: int = 3) -> str | None:
    """Fetch one page, retrying transient network faults.

    A dropped connection mid-read raises ConnectionResetError, which is an
    OSError and not wrapped by urllib.error, so catching URLError alone lets it
    kill a 243-page run. One reset is not a verdict about the company: retry.
    """
    request = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Encoding": "gzip",
                      "Accept": "text/html,application/xhtml+xml"})
    last: Exception | None = None
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                raw = response.read()
                if response.headers.get("Content-Encoding") == "gzip":
                    raw = gzip.decompress(raw)
                body = raw.decode("utf-8", "replace")
            if "Human Verification" in body[:2000]:
                raise Blocked("Levels.fyi served a bot challenge. Wait, then retry "
                              "with a larger --delay.")
            time.sleep(delay)
            return body
        except urllib.error.HTTPError as exc:
            time.sleep(delay)
            if exc.code in (403, 405, 429, 503):
                raise Blocked(f"Levels.fyi answered HTTP {exc.code}. Wait, then retry "
                              f"with a larger --delay.") from exc
            return None
        except (urllib.error.URLError, OSError) as exc:
            last = exc
            # Back off a little further each time before giving up on the page.
            time.sleep(delay * (attempt + 1))
    print(f"  network: {last} for {url}", file=sys.stderr)
    return None


def eur(value, rate) -> int | None:
    """USD to euros. Zero means "not published", not "unpaid".

    An empty page returns every percentile as 0 rather than null - GitLab's
    Spanish page does exactly that - so a falsy figure is missing data.
    """
    if not isinstance(value, (int, float)) or not isinstance(rate, (int, float)):
        return None
    if not value:
        return None
    return round(value * rate)


def in_spain(where) -> bool:
    return str(where or "").strip().endswith("Spain")


def rung_level(rung: dict) -> tuple[str | None, str | None]:
    """(level slug, the title that decided it) for one rung of a ladder."""
    titles = [t for t in (rung.get("titles") or []) if t]
    if rung.get("primaryLevelName"):
        titles.append(rung["primaryLevelName"])
    for level, pattern in LEVEL_PATTERNS:
        for title in titles:
            if re.search(pattern, title, re.I):
                return level, title
    return None, None


def weighted(rungs: list[dict], key: str) -> float | None:
    """Submission-weighted mean of `key` over rungs that published one."""
    pairs = [(r.get(key) or 0, r.get("count") or 0) for r in rungs]
    pairs = [(value, n) for value, n in pairs if value and n]
    if not pairs:
        return None
    return sum(value * n for value, n in pairs) / sum(n for _, n in pairs)


def spain_data(slug: str, delay: float, role: str = ROLE):
    """Everything Spanish this company's page will give up.

    Returns (label, page, company). `page` is None when there is nothing, and
    `label` is for the run report.
    """
    url = f"{BASE}/companies/{slug}/salaries/{role}/locations/spain"
    body = get(url, delay)
    if not body:
        return "unreachable", None, {}
    found = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if not found:
        return "unreadable", None, {}
    try:
        props = json.loads(found.group(1))["props"]["pageProps"]
    except (KeyError, json.JSONDecodeError):
        return "unreadable", None, {}
    return interpret(props, slug, url)


def interpret(props: dict, slug: str, url: str):
    """Split one page's props into the Spanish parts worth recording.

    Separate from the fetch so the regression tests can hand it a saved page.
    """
    company = props.get("company") or {}

    # Without a rate the figures cannot be denominated, and a Spanish page that
    # is not quoting euros is a page that is not about Spain.
    rate = props.get("locationExchangeRate")
    if props.get("locationCurrency") != "EUR" or not isinstance(rate, (int, float)):
        return "not priced in EUR", None, company

    percentiles = props.get("percentiles") or {}
    aggregate = percentiles if percentiles.get("locationName") == "Spain" else None

    median = props.get("median") or {}
    submission = median if in_spain(median.get("location")) else None

    # `averages` is scoped to the location in the URL - GitLab's Spanish page
    # is empty while its German one holds Berlin submissions - but the samples
    # name their city, so check rather than trust. A rung that lists a foreign
    # one is dropped whole: the count behind it is not a Spanish count.
    rungs = []
    for rung in props.get("averages") or []:
        locations = [s.get("location") for s in rung.get("samples") or []]
        if all(in_spain(where) for where in locations):
            rungs.append(rung)
        else:
            print(f"  {slug}: dropped rung {rung.get('level')}, samples from "
                  f"{sorted({w for w in locations if not in_spain(w)})}", file=sys.stderr)

    if rungs:
        label = "Spain (ladder)"
    elif aggregate:
        label = "Spain (aggregate)"
    elif submission:
        label = "Spain (submission)"
    else:
        label = percentiles.get("locationName") or "no data"

    page = {
        "rate": rate,
        "rungs": rungs,
        "aggregate": aggregate,
        "submission": submission,
        "url": url,
    }
    # The company record is about the employer, not the location, so it is
    # worth keeping even when there is no Spanish pay to record.
    return label, page, company


def bands(page: dict, today: str) -> list[dict]:
    """Every band this page supports, in ladder order with `all` last.

    A named rung becomes a band at that level. Everything else lands in one
    `all` band, from the best source the page has for it: a real interquartile
    aggregate first, the ladder pooled across its rungs second, a lone
    submission last.
    """
    rate, rungs = page["rate"], page["rungs"]
    out: list[dict] = []

    by_level: dict[str, list[dict]] = {}
    for rung in rungs:
        level, _ = rung_level(rung)
        if level:
            by_level.setdefault(level, []).append(rung)

    for level, group in by_level.items():
        base = eur(weighted(group, "base"), rate)
        total = eur(weighted(group, "total"), rate)
        if base is None and total is None:
            continue
        count = sum(rung.get("count") or 0 for rung in group)
        named = ", ".join(rung.get("primaryLevelName") or rung.get("level") or "?"
                          for rung in group)
        out.append(assemble(
            level, {"p50": base}, {"p50": total}, count, today,
            f"Spain only. Mean of {count} Spanish submission"
            f"{'s' if count != 1 else ''} at {named}. Levels.fyi publishes an "
            "average per level, not a median.", page["url"]))

    spread = spread_band(page, today)
    if spread:
        out.append(spread)
    return sorted(out, key=lambda band: lib.level_rank(band["level"]))


def assemble(level: str, base: dict, total: dict, count: int | None, today: str,
             notes: str, url: str) -> dict:
    """One band. `base` and `total` map min/p50/max to euros, None for unpublished."""
    band = {"level": level}
    for block, figures in (("base", base), ("total", total)):
        for part in ("min", "p50", "max"):
            band[f"{block}_{part}"] = figures.get(part)
    band.update(sample_size=count or None, source="levels.fyi", source_url=url,
                date=today, notes=notes)
    return band


def spread_band(page: dict, today: str) -> dict | None:
    """The one band that covers every level, however the page supports it."""
    rate, rungs = page["rate"], page["rungs"]
    aggregate, submission = page["aggregate"], page["submission"]
    count = sum(rung.get("count") or 0 for rung in rungs)

    if aggregate:
        def money(block):
            out = {}
            for ours_, theirs in (("min", "p25"), ("p50", "p50"), ("max", "p75")):
                value = eur((block or {}).get(theirs), rate)
                if value is not None:
                    out[ours_] = value
            return out

        base, total = money(aggregate.get("base_salary")), money(aggregate.get("tc"))
        if not base and not total:
            return None
        # Only the ladder carries a Spanish count. `sampleSize` beside an empty
        # ladder is the company's global one.
        return assemble(
            "all", base, total, count, today,
            "Spain only: Levels.fyi reports this location as Spain. Base and "
            "total compensation, interquartile range, converted from the USD "
            "the page stores.", page["url"])

    if rungs:
        base = eur(weighted(rungs, "base"), rate)
        total = eur(weighted(rungs, "total"), rate)
        if base is None and total is None:
            return None
        if len(rungs) == 1:
            where = f"all at {rungs[0].get('primaryLevelName') or rungs[0].get('level')}"
        else:
            means = sorted(eur(r.get("base") or r.get("total"), rate) or 0 for r in rungs)
            where = (f"spanning {len(rungs)} rungs of this company's ladder, "
                     f"rung means {lib.fmt_eur(means[0])} to {lib.fmt_eur(means[-1])}")
        return assemble(
            "all", {"p50": base}, {"p50": total}, count, today,
            f"Spain only. Mean across {count} Spanish submission"
            f"{'s' if count != 1 else ''}, {where}. Levels.fyi published no "
            "Spanish interquartile range for this company, so this is its "
            "ladder pooled rather than a measured distribution.", page["url"])

    if not submission:
        return None
    # A submission carries its own unrounded rate, which round-trips to the
    # figure the person actually typed: Glovo's median base of 64068.9615 USD
    # at 0.85845 is exactly 55.000 EUR. The page-wide rate is rounded to two
    # places and would say 55.099.
    rate = submission.get("exchangeRate") or rate
    base = eur(submission.get("baseSalary"), rate)
    total = eur(submission.get("totalCompensation"), rate)
    if base is None and total is None:
        return None
    reported = submission.get("level") or "unspecified"
    years = submission.get("yearsOfExperience")
    where = submission.get("location") or "Spain"
    return assemble(
        "all", {"p50": base}, {"p50": total}, 1, today,
        f"Single Spanish submission: {where}, reported level {reported}"
        f"{f', {years} years experience' if years is not None else ''}. "
        "Levels.fyi published no Spanish aggregate or ladder for this company, "
        "so this is one data point rather than a band.", page["url"])


def summarise(band: dict) -> str:
    """One band, for the run report."""
    figure = band.get("base_p50") or band.get("total_p50")
    count = band.get("sample_size")
    return f"{band['level']} {lib.fmt_eur(figure)}" + (f" n={count}" if count else "")


def note_check(company: dict, role: str, found: bool, served: str, today: str) -> None:
    """Record that Levels.fyi was asked for Spanish pay in this role and had none.

    A company nobody has a Spanish figure for is still worth a row, and a row
    that says "asked on this date, nothing published" is worth more than a bare
    dash: it tells a reader the gap is Levels.fyi's coverage rather than
    somebody forgetting to look.

    The front page reads these columns rather than the wording of a note, which
    is the same lesson as the location purge - prose is not a machine-readable
    fact, and matching on it is what let 173 stale bands through.
    """
    checked = set(company.get("spain_check_roles") or [])
    if found:
        checked.discard(role)
    else:
        checked.add(role)
    if not checked:
        company.update(spain_check_date=None, spain_check_roles=[], spain_check_served=None)
        return
    # Only a negative answer is dated: finding pay in one role says nothing
    # about when the others were last asked.
    if not found:
        company.update(spain_check_date=today, spain_check_served=served or None)
    elif not company.get("spain_check_date"):
        company["spain_check_date"] = today
    company["spain_check_roles"] = sorted(checked)


def write(slug: str, new_bands: list[dict], name_hint: str, today: str,
          record: dict | None = None, role: str = ROLE,
          served: str | None = None) -> str:
    """Update one company in companies.csv. Returns what happened, for the run report.

    The whole file is read and written for each company, so a run that gets
    blocked halfway keeps everything it fetched before that.
    """
    companies = lib.load_companies()
    company = lib.by_slug(companies, slug)
    created = company is None
    if created:
        company = lib.blank_company(name_hint or (record or {}).get("name") or slug,
                                    levels_slug=slug, levels_status="resolved")
    before = copy.deepcopy(company)

    # The employer's own LinkedIn page, which the front page links company
    # names to. Never overwrite one already on file: a hand-entered URL was
    # put there deliberately and is better than anything guessed here.
    handle = (record or {}).get("linkedin")
    if handle and not company.get("linkedin_url"):
        company["linkedin_url"] = f"https://www.linkedin.com/{handle.strip('/')}"

    # Anything read off the unscoped company page is another country's pay,
    # whatever role it sits under. Drop it whether or not this company also
    # turns out to have a Spanish figure: a Spanish software-engineer band says
    # nothing about the Dutch product-designer band filed beside it, and the
    # earlier version only ran this when the company had no Spanish data at
    # all, so 27 companies kept theirs.
    company["bands"] = [band for band in company["bands"] if not unscoped(band)]

    # A page that never loaded is not evidence of anything, so only an answer
    # we actually read updates the record.
    if served is not None:
        note_check(company, role, bool(new_bands), served, today)

    replacing = {band["level"] for band in new_bands}
    company["bands"] = [
        band for band in company["bands"]
        if band["role"] != role or not (ours(band) or superseded(band, replacing))
    ] + [dict(band, role=role) for band in new_bands]

    if company == before:
        return "skipped"
    if created:
        if lib.by_name(companies, company["company"]):
            print(f"  {slug}: not written, {company['company']!r} is already in "
                  f"{lib.DATA.name} under another slug", file=sys.stderr)
            return "refused"
        companies.append(company)
    lib.save_companies(companies)
    if not new_bands:
        return "created" if created else "cleaned"
    return "created" if created else "updated"


def targets() -> list[tuple[str, str]]:
    """(slug, name) for every company with a confirmed Levels.fyi page."""
    return sorted((c["levels_slug"], c["company"]) for c in lib.load_companies()
                  if c.get("levels_slug") and c.get("levels_status") == "resolved")


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--company", action="append", default=[],
                        help="Levels.fyi slug. Repeatable. Defaults to every resolved slug.")
    parser.add_argument("--delay", type=float, default=3.0,
                        help="Seconds between pages. Below ~2 trips their WAF.")
    parser.add_argument("--role", default=ROLE,
                        help="Levels.fyi job family. Defaults to software-engineer, "
                             "which is the one the front page is about.")
    parser.add_argument("--audit", action="store_true",
                        help="Report what each company serves, write nothing.")
    args = parser.parse_args(argv)

    pending = [(s, "") for s in args.company] if args.company else targets()
    today = lib.today_utc().isoformat()
    served: dict[str, int] = {}
    tally: dict[str, int] = {}

    try:
        for slug, name in pending:
            label, page, record = spain_data(slug, args.delay, args.role)
            served[label] = served.get(label, 0) + 1
            new_bands = bands(page, today) if page else []
            if new_bands:
                print(f"  {slug}: {label} - " + ", ".join(summarise(b) for b in new_bands))
            else:
                print(f"  {slug}: {label}, nothing Spanish to record")
            if not args.audit:
                outcome = write(slug, new_bands, name, today, record, args.role,
                                label if page else None)
                tally[outcome] = tally.get(outcome, 0) + 1
    except Blocked as exc:
        print(f"\n{exc}", file=sys.stderr)
        print("Progress so far is saved.", file=sys.stderr)

    print("\nserved by country: " + ", ".join(
        f"{k} {v}" for k, v in sorted(served.items(), key=lambda kv: -kv[1])))
    if not args.audit:
        print("companies: " + ", ".join(f"{k} {v}" for k, v in sorted(tally.items())))
        print(f"\n{ATTRIBUTION}")
        print("Next: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
