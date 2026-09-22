#!/usr/bin/env python3
"""Fetch every software engineer salary in Spain that qualifies, per company, from Levels.fyi.

    python3 scripts/fetch_spain.py                 # every resolved company in companies.csv
    python3 scripts/fetch_spain.py --company glovo
    python3 scripts/fetch_spain.py --audit         # report, write nothing

An entry qualifies when the engineer has at least lib.SENIOR_YEARS years of
experience and a base salary of at least lib.THRESHOLD_EUR. The level name does
not matter: companies call the same job L4, SDE II or Senior, and years are the
one thing every submission states the same way.

Most submissions are behind a sign-in. The public page embeds a handful (see
below); the "Latest Salary Submissions" table under it holds every one, and is
loaded by the browser from api.levels.fyi with the visitor's session token,
which an anonymous visitor does not have (the rows render as asterisks). Fever
is the case that exposed this: 29 Spanish software engineers in the table, one
on the public page. With a token in LEVELS_TOKEN or ~/.config/levels/token this
script reads the table too; without one it reads the public page and says so.
The token is a session credential: it is never written anywhere, and the run
report never prints it.

Why this exists instead of fetch_company.py: that script reads
/companies/<slug>/salaries, which is scoped by the caller's IP and silently
falls back to another country when Levels.fyi has no Spanish submissions. Its
only guard is that the page currency is EUR, which every euro-zone country
passes. Adyen, Celonis, N26, TomTom and FREE NOW all returned Dutch or German
salaries that way, and Datadog, Microsoft and Amazon returned US ones.

The per-location page carries individual submissions in two places:

  averages     The company's ladder for the location asked about. Each rung
               carries up to twenty recent `samples`, each one a submission
               with its city, years of experience and pay. That is where
               almost every entry comes from. A rung's `count` can be higher
               than its samples: the page does not publish the rest.
  median       One more submission. It stays Spanish even when the aggregate
               has given up, and it is often the only one a small company has.
  percentiles  An aggregate across every level. Never an entry. It falls back
               to another country when the Spanish sample is below their
               publication threshold; `percentiles.locationName` names the
               country actually served. `locationMeta` only echoes the URL.

Every sample names its city, and one outside Spain is skipped whatever page it
came from.

EVERY MONEY FIELD IN THE PAYLOAD IS USD. The page prints euros by multiplying
by `locationExchangeRate`, and the euro figures in its own FAQ text confirm it:
Glovo's Spanish median total of 79710.65 is published as "€68,551", which is
79710.65 x 0.86. An earlier version of this script wrote the raw numbers into a
file whose `compensation.currency` said EUR, which put every one of its 141
bands about 16% over the truth.

The median record also carries the currency its author was paid in and the rate
they typed it at. That rate converts to *their* currency, not to euros: Smile.io's
submission was 105.000 USD at a rate of 1, and was listed as 105.000 EUR until
2026-09-15. It is only used when that currency is EUR.
"""
from __future__ import annotations

import argparse
import base64
import copy
import gzip
import hashlib
import json
import os
import pathlib
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

import lib

BASE = "https://www.levels.fyi"
API = "https://api.levels.fyi/v3/salary/search"
ROLE = "software-engineer"
ATTRIBUTION = "Data source: Levels.fyi (https://www.levels.fyi)"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
MONTHS = {name: number for number, name in enumerate(
    ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), 1)}

# The signed-in table. Levels.fyi's own id for Spain, the API's page-size
# ceiling (it answers 400 above it), and where the maintainer leaves a token.
SPAIN_COUNTRY_ID = 226
TABLE_PAGE = 50
TOKEN_FILE = pathlib.Path.home() / ".config" / "levels" / "token"
# Level names the API sends where the author left the field blank.
NO_LEVEL = {"", "false", "none", "null"}


def unscoped(entry: dict) -> bool:
    """Was this entry read off a page that never named a location?

    A /companies/<slug>/salaries URL is the company's global ladder, served in
    whatever currency the caller's IP implies. Only a URL naming a location
    says where the money was earned.

    The test is the source URL, not the wording of `notes`. An earlier version
    matched on "reports this as" and so caught the per-level rows while missing
    "Median across all levels" and "Common Range Average across all levels" -
    173 of the 205 stale bands, which then shipped.
    """
    url = entry.get("source_url") or ""
    return "levels.fyi" in url and "/locations/" not in url


def ours(entry: dict) -> bool:
    """Was this entry written by this script on an earlier run?

    Those are replaced wholesale, because the page's samples change as new
    submissions arrive. Anything with a source this script does not write - a
    first-hand figure, a job ad - is left exactly where it is.
    """
    url = entry.get("source_url") or ""
    return (entry.get("source") == "levels.fyi"
            and "/companies/" in url and "/locations/" in url)


class Blocked(RuntimeError):
    """Levels.fyi's WAF returned a bot challenge, or the API refused the token."""


def get(url: str, delay: float, attempts: int = 3, headers: dict | None = None) -> str | None:
    """Fetch one page, retrying transient network faults.

    A dropped connection mid-read raises ConnectionResetError, which is an
    OSError and not wrapped by urllib.error, so catching URLError alone lets it
    kill a 243-page run. One reset is not a verdict about the company: retry.

    401 and 402 come from the API only. 401 is a token that has expired or was
    pasted wrong; 402 is what it answers a request it takes for a bot (a bare
    User-Agent got one). Neither says anything about the company, so both stop
    the run rather than write "no data".
    """
    request = urllib.request.Request(
        url, headers={"User-Agent": UA, "Accept-Encoding": "gzip",
                      "Accept": "text/html,application/xhtml+xml", **(headers or {})})
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
            if exc.code == 401:
                raise Blocked("Levels.fyi rejected the token (HTTP 401). Sign in again "
                              f"and copy a fresh one to {TOKEN_FILE}.") from exc
            if exc.code in (402, 403, 405, 429, 503):
                raise Blocked(f"Levels.fyi answered HTTP {exc.code}. Wait, then retry "
                              f"with a larger --delay.") from exc
            return None
        except (urllib.error.URLError, OSError) as exc:
            last = exc
            # Back off a little further each time before giving up on the page.
            time.sleep(delay * (attempt + 1))
    print(f"  network: {last} for {url}", file=sys.stderr)
    return None


def token() -> str | None:
    """The maintainer's Levels.fyi session, if one has been left for this run.

    Read from LEVELS_TOKEN, then ~/.config/levels/token. Nothing here or in the
    repository stores it, and nothing prints it: a run report that echoed the
    token would put a live login into the terminal scrollback.
    """
    found = os.environ.get("LEVELS_TOKEN", "").strip()
    if not found and TOKEN_FILE.exists():
        found = TOKEN_FILE.read_text(encoding="utf-8").strip()
    return found or None


def decrypt(payload: str) -> dict:
    """Decode an API answer of the form {"payload": "<base64>"}.

    The browser does exactly this in the page's own JavaScript: AES-128-ECB
    with a key that is the first sixteen characters of the base64 MD5 of a fixed
    string, then zlib-inflate, then JSON. It is obfuscation of a response the
    signed-in user is already allowed to read, not access control - the token
    is the access control. openssl does the AES because the standard library
    has none.
    """
    key = base64.b64encode(hashlib.md5(b"levelstothemoon!!").digest())[:16]
    plain = subprocess.run(["openssl", "enc", "-d", "-aes-128-ecb", "-K", key.hex()],
                           input=base64.b64decode(payload), capture_output=True, check=True).stdout
    return json.loads(zlib.decompress(plain))


def table(bearer: str, delay: float, slug: str | None = None) -> list[dict] | None:
    """Every Spanish software-engineer submission in the signed-in table.

    With a slug, the company's own table; without one, the newest submissions
    across every employer in Spain. Fifty per page, newest first, until the
    API's own total is reached. The total tops out at 250, so for the largest
    employers, and always for the country-wide feed, this is the 250 most
    recent. Each row has the same shape as the page's `median` record, its own
    exchange rate and currency included, so entries() reads both the same way.

    Returns None when a page could not be read, and the caller then leaves the
    company alone: a table that half-loaded is not a smaller table.
    """
    rows: list[dict] = []
    scope = f"/companies/{slug}/salaries/{ROLE}" if slug else f"/t/{ROLE}"
    headers = {"Authorization": f"Bearer {bearer}", "x-agent": "levelsfyi_website",
               "Accept": "application/json", "Origin": BASE,
               "Referer": f"{BASE}{scope}/locations/spain"}
    while True:
        query = urllib.parse.urlencode([
            *([("companySlug", slug)] if slug else []),
            ("jobFamilySlug", ROLE), ("countryIds[0]", SPAIN_COUNTRY_ID),
            ("offset", len(rows)), ("limit", TABLE_PAGE), ("sortBy", "offer_date"),
            ("sortOrder", "DESC")])
        body = get(f"{API}?{query}", delay, headers=headers)
        if body is None:
            return None
        try:
            data = json.loads(body)
            if isinstance(data, dict) and "payload" in data:
                data = decrypt(data["payload"])
            page = data["rows"]
        except (json.JSONDecodeError, ValueError, TypeError, KeyError, zlib.error,
                subprocess.CalledProcessError) as exc:
            print(f"  {slug or 'spain'}: table answer unreadable ({exc.__class__.__name__})",
                  file=sys.stderr)
            return None
        rows += page
        if not page or len(rows) >= (data.get("total") or 0):
            return rows


def eur(amount, rate) -> int | None:
    """USD to euros. Zero means "not published", not "unpaid".

    An empty page returns every percentile as 0 rather than null - GitLab's
    Spanish page does exactly that - so a falsy figure is missing data.
    """
    if not isinstance(amount, (int, float)) or not isinstance(rate, (int, float)):
        return None
    if not amount:
        return None
    return round(amount * rate)


def in_spain(where) -> bool:
    return str(where or "").strip().endswith("Spain")


def reported(raw) -> str | None:
    """YYYY-MM of a submission's offer date.

    Samples date themselves in ISO, the median record as a JavaScript date
    string ("Fri Oct 06 2023 07:43:13 GMT+0000"). The day is dropped: with a
    company, a city and a level beside it, an exact date points at a person.
    """
    text = str(raw or "")
    found = re.match(r"(\d{4})-(\d{2})", text)
    if found:
        return f"{found.group(1)}-{found.group(2)}"
    found = re.search(r"\b([A-Z][a-z]{2}) \d{1,2} (\d{4})\b", text)
    if found and found.group(1) in MONTHS:
        return f"{found.group(2)}-{MONTHS[found.group(1)]:02d}"
    return None


def spain_data(slug: str, delay: float, bearer: str | None = None):
    """Everything Spanish this company's page will give up.

    Returns (label, page, company). `page` is None when the page could not be
    read at all, and `label` says what it served, for the run report.

    With a token, the signed-in table is read as well, and a table that could
    not be read makes the whole company unread: writing the public page's
    handful in its place would delete the table entries from the last run.

    Levels.fyi answers 404 for the page of an employer with only a submission
    or two, while the table still has them: 42 of the 107 employers discovery
    turned up on 2026-09-21 were like that. So with a token, no page and a
    table is still an answer, read from the rows alone.
    """
    url = f"{BASE}/companies/{slug}/salaries/{ROLE}/locations/spain"
    body = get(url, delay)
    props = page_props(body) if body else None
    if body and props is None:
        return "unreadable", None, {}
    rows = None
    if bearer:
        rows = table(bearer, delay, slug)
        if rows is None:
            return "table unreadable", None, (props or {}).get("company") or {}
    if props is None:
        if not rows:
            return "unreachable", None, {}
        props = {"locationCurrency": "EUR"}
    return interpret(props, slug, url, rows)


def page_props(body: str) -> dict | None:
    found = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if not found:
        return None
    try:
        return json.loads(found.group(1))["props"]["pageProps"]
    except (KeyError, TypeError, json.JSONDecodeError):
        return None


def interpret(props: dict, slug: str, url: str, rows: list[dict] | None = None):
    """Split one page's props, and the signed-in table if it was read, into the
    Spanish submissions worth reading.

    Separate from the fetch so the regression tests can hand it a saved page.
    """
    company = props.get("company") or {}

    # A Spanish page that is not quoting euros is a page that is not about
    # Spain, and without a rate its figures cannot be denominated. Table rows
    # carry their own euro rate, so with rows on hand a missing page rate only
    # costs the records that have none; entries() leaves those out.
    rate = props.get("locationExchangeRate")
    if props.get("locationCurrency") != "EUR" or not (isinstance(rate, (int, float)) or rows):
        return "not priced in EUR", None, company
    if not isinstance(rate, (int, float)):
        rate = None

    median = props.get("median") or {}
    samples = [sample for rung in props.get("averages") or [] for sample in rung.get("samples") or []]

    # The median record goes first: it can also be one of the samples, and it
    # carries the rate its author typed it at. The table's rows carry theirs
    # too and usually include the median and every sample, so they go last
    # and the uuid check drops the repeats.
    records, seen, foreign = [], set(), 0
    for record in ([median] if median else []) + samples + (rows or []):
        if not in_spain(record.get("location")):
            foreign += bool(record.get("location"))
            continue
        key = record.get("uuid")
        if key and key in seen:
            continue
        seen.add(key)
        records.append(record)
    if foreign:
        print(f"  {slug}: skipped {foreign} submission{'s' if foreign != 1 else ''} "
              "from outside Spain", file=sys.stderr)

    # "Spain (table)" is the one label that means every Spanish submission was
    # read. The others mean the public page's subset, which for most companies
    # is the median record alone.
    percentiles = props.get("percentiles") or {}
    if rows:
        label = "Spain (table)"
    elif any(in_spain(sample.get("location")) for sample in samples):
        label = "Spain (ladder)"
    elif percentiles.get("locationName") == "Spain":
        label = "Spain (aggregate)"
    elif records:
        label = "Spain (submission)"
    else:
        label = percentiles.get("locationName") or "no data"

    page = {"rate": rate, "records": records, "url": url}
    # The company record is about the employer, not the location, so it is
    # worth keeping even when there is no Spanish pay to record.
    return label, page, company


def entries(page: dict, today: str) -> list[dict]:
    """Every Spanish submission on the page with enough years and enough pay."""
    out = []
    for record in page["records"]:
        experience = record.get("yearsOfExperience")
        # A record that names euros converts back to exactly what its author
        # typed at its own rate; anything else goes through the page's.
        rate = page["rate"]
        if record.get("baseSalaryCurrency") == "EUR" and record.get("exchangeRate"):
            rate = record["exchangeRate"]
        level = str(record.get("level") or "").strip()
        entry = {
            "base": eur(record.get("baseSalary"), rate),
            "total": eur(record.get("totalCompensation"), rate),
            "years_experience": None if experience is None else str(experience),
            "level": None if level.lower() in NO_LEVEL else level,
            "city": (record.get("location") or "").split(",")[0].strip() or None,
            "reported": reported(record.get("offerDate")),
            "source": "levels.fyi",
            "source_url": page["url"],
            "date": today,
            "notes": None,
        }
        if lib.qualifies(entry):
            out.append(entry)
    return sorted(out, key=lib.entry_order)


def write(slug: str, new_entries: list[dict], name_hint: str, today: str,
          record: dict | None = None, served: str | None = None) -> str:
    """Update one company in companies.csv. Returns what happened, for the run report.

    The whole file is read and written for each company, so a run that gets
    blocked halfway keeps everything it fetched before that.

    A company is on the list only while it has a salary on file. One that
    Levels.fyi was asked about and that ends up with nothing, and that nobody
    has vouched for with a first-hand entry, is removed; the maintainer dropped
    112 such rows on 2026-09-21 rather than list them as "no data". A page that
    could not be read removes nothing.
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
    handle = ((record or {}).get("linkedin") or "").strip().strip("/")
    if handle and not company.get("linkedin_url"):
        # Usually `company/<name>`, sometimes already a full URL.
        company["linkedin_url"] = handle if handle.startswith("http") \
            else f"https://www.linkedin.com/{handle}"

    # Anything read off the unscoped company page is another country's pay.
    # Drop it whether or not this company also turns out to have a Spanish
    # entry: the earlier version only ran this when the company had no Spanish
    # data at all, so 27 companies kept theirs.
    company["entries"] = [entry for entry in company["entries"] if not unscoped(entry)]

    # A page that never loaded is not evidence of anything. It used to count as
    # a page with no figures and delete the ones already on file, so a network
    # error could empty a company; only an answer actually read changes them.
    if served is not None:
        company["entries"] = [entry for entry in company["entries"] if not ours(entry)] \
            + new_entries

    # Nothing is created empty, whatever else the page gave (an unread table
    # once created two companies from their LinkedIn handle alone), and a
    # company that came back empty is removed. An unread page removes nothing.
    if not company["entries"]:
        if created:
            return "not listed"
        if served is None:
            return "skipped"
        companies.remove(company)
        lib.save_companies(companies)
        return "removed"

    if company == before:
        return "skipped"
    if created:
        if lib.by_name(companies, company["company"]):
            print(f"  {slug}: not written, {company['company']!r} is already in "
                  f"{lib.DATA.name} under another slug", file=sys.stderr)
            return "refused"
        companies.append(company)
    lib.save_companies(companies)
    if not new_entries:
        return "created" if created else "cleaned"
    return "created" if created else "updated"


def targets() -> list[tuple[str, str]]:
    """(slug, name) for every company with a confirmed Levels.fyi page."""
    return sorted((c["levels_slug"], c["company"]) for c in lib.load_companies()
                  if c.get("levels_slug") and c.get("levels_status") == "resolved")


def discover(bearer: str, delay: float, known: set[str]) -> list[tuple[str, str]]:
    """(slug, name) for every employer with a recent Spanish submission not yet on file.

    The country-wide feed is the newest 250 Spanish software-engineer
    submissions, about three months' worth. Reading it each run is what makes
    "add your salary on Levels.fyi and it gets picked up" true for a company
    nobody has added by hand: it is fetched like the rest, and gets a row the
    first time one of its engineers qualifies. The API sends `False` for both
    company fields on a few rows; those name no employer to look up.
    """
    rows = table(bearer, delay) or []
    found = {row["companySlug"]: row.get("company") or row["companySlug"] for row in rows
             if isinstance(row.get("companySlug"), str) and row["companySlug"] not in known}
    return sorted(found.items())


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--company", action="append", default=[],
                        help="Levels.fyi slug. Repeatable. Defaults to every resolved slug.")
    parser.add_argument("--delay", type=float, default=3.0,
                        help="Seconds between pages. Below ~2 trips their WAF.")
    parser.add_argument("--audit", action="store_true",
                        help="Report what each company serves, write nothing.")
    args = parser.parse_args(argv)

    pending = [(s, "") for s in args.company] if args.company else targets()
    today = lib.today_utc().isoformat()
    served: dict[str, int] = {}
    tally: dict[str, int] = {}
    found = 0

    bearer = token()
    print("signed in: reading each company's submissions table" if bearer else
          f"no token in LEVELS_TOKEN or {TOKEN_FILE}: reading the public page only, "
          "which hides most submissions", file=sys.stderr)

    try:
        if bearer and not args.company:
            new = discover(bearer, args.delay, {slug for slug, _ in pending})
            print(f"  {len(new)} employers with recent Spanish submissions are not on file: "
                  + ", ".join(slug for slug, _ in new), file=sys.stderr)
            pending += new
        for slug, name in pending:
            label, page, record = spain_data(slug, args.delay, bearer)
            served[label] = served.get(label, 0) + 1
            new_entries = entries(page, today) if page else []
            found += len(new_entries)
            if new_entries:
                print(f"  {slug}: {label} - {len(new_entries)} qualifying, top "
                      f"{lib.fmt_eur(new_entries[0]['base'])}")
            else:
                print(f"  {slug}: {label}, nothing qualifies")
            if not args.audit:
                outcome = write(slug, new_entries, name, today, record,
                                label if page else None)
                tally[outcome] = tally.get(outcome, 0) + 1
    except Blocked as exc:
        print(f"\n{exc}", file=sys.stderr)
        print("Progress so far is saved.", file=sys.stderr)

    print("\nserved: " + ", ".join(
        f"{k} {v}" for k, v in sorted(served.items(), key=lambda kv: -kv[1])))
    print(f"qualifying entries: {found}")
    if not args.audit:
        print("companies: " + ", ".join(f"{k} {v}" for k, v in sorted(tally.items())))
        print(f"\n{ATTRIBUTION}")
        print("Next: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
