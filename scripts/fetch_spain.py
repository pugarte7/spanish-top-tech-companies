#!/usr/bin/env python3
"""Fetch every Spanish salary in every job family from Levels.fyi's signed-in feed.

    python3 scripts/fetch_spain.py                    # all 129 roles, ~30 min
    python3 scripts/fetch_spain.py --role data-scientist
    python3 scripts/fetch_spain.py --company glovo    # only this company written
    python3 scripts/fetch_spain.py --audit            # report, write nothing

The submissions table's API (api.levels.fyi/v3/salary/search) without a
companySlug is the country-wide feed: every Spanish submission in one job
family, newest first. It answers `total: 250` at most but keeps serving rows
past it, so feed() reads until an empty page rather than the total. That is
every Spanish submission in the family - the old per-company loop and the
discovery feed are both obsolete - at roughly 30 calls for software engineers
and one or two for a family nobody in Spain has submitted to.

The feed only exists behind a sign-in: the browser loads it with the
visitor's Cognito id token, which LEVELS_TOKEN, ~/.config/levels/token or the
refresh token in ~/.config/levels/refresh_token supplies (that last mints a
fresh id token each run, which is what lets it run unattended). A refused
refresh token stops the run rather than falling back to anything partial.
The token is a session credential: it is never written anywhere and never
printed.

Every row is checked for its own location ("Barcelona, CT, Spain"), never for
the currency or the page's scope - a German salary in this list is worse than
no salary. Rows carry their own exchange rate and the currency their author
was paid in; a euro row converts back at its own rate to exactly the figure
the author typed, and anything else goes through the Spain page's
locationExchangeRate (Smile.io's 105.000 USD once read as 105.000 EUR until
2026-09-15). Rows whose currency cannot be priced in euros are dropped and
counted, not guessed.

What a row keeps and what it drops is deliberate: the role, official
specialization and title slugs, work arrangement, contract type, offer-vs-
employee status, pay and city are stored; the submission uuid, exact day,
free-text title, team, details, years at company and years at level are not,
because those point at a person.
"""
from __future__ import annotations

import argparse
import base64
import collections
import hashlib
import gzip
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
import taxonomy

BASE = "https://www.levels.fyi"
API = "https://api.levels.fyi/v3/salary/search"
ATTRIBUTION = "Data source: Levels.fyi (https://www.levels.fyi)"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
MONTHS = {name: number for number, name in enumerate(
    ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"), 1)}

# The signed-in table. Levels.fyi's own id for Spain, the API's page-size
# ceiling (it answers 400 above it), and where the maintainer leaves a token.
SPAIN_COUNTRY_ID = 226
TABLE_PAGE = 50
# The API refuses an offset past 990 ("offset must not be greater than 990"),
# so one query sees at most 1,000 rows. Software engineers in Spain are
# several times that; read_role() works around it.
MAX_OFFSET = 990
TOKEN_FILE = pathlib.Path.home() / ".config" / "levels" / "token"
# A Cognito refresh token for the same login mints a fresh id token each run,
# so an unattended run needs nobody to paste one daily. The pool's region and
# the site's web client are the `iss` and `aud` of Levels.fyi's id tokens.
REFRESH_FILE = TOKEN_FILE.with_name("refresh_token")
COGNITO = "https://cognito-idp.us-west-2.amazonaws.com/"
COGNITO_CLIENT = "76of0ich18hd8uehju7fniv2u1"
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

    Those are replaced wholesale per role, because the feed's contents change
    as new submissions arrive. Anything with a source this script does not
    write - a first-hand figure, a job ad - is left exactly where it is.
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
    kill a run. One reset is not a verdict: retry.

    401 and 402 come from the API only. 401 is a token that has expired or was
    pasted wrong; 402 is what it answers a request it takes for a bot (a bare
    User-Agent got one). Neither says anything about the data, so both stop
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

    Minted from ~/.config/levels/refresh_token when that exists, else read from
    LEVELS_TOKEN, then ~/.config/levels/token. Nothing in the repository stores
    it, and nothing prints it: a run report that echoed the token would put a
    live login into the terminal scrollback.
    """
    if REFRESH_FILE.exists():
        return refreshed(REFRESH_FILE)
    found = os.environ.get("LEVELS_TOKEN", "").strip()
    if not found and TOKEN_FILE.exists():
        found = TOKEN_FILE.read_text(encoding="utf-8").strip()
    return found or None


def refreshed(path: pathlib.Path) -> str:
    """A fresh id token from the Cognito refresh token in `path`.

    The same call the site's own Amplify client makes when its id token runs
    out. A pool that rotates refresh tokens answers with a new one and retires
    the old, so a new one is written back over the file. A refused refresh
    token stops the run: falling back to public pages would replace every
    feed entry on file with a fraction of them.
    """
    request = urllib.request.Request(COGNITO, data=json.dumps({
        "ClientId": COGNITO_CLIENT, "RefreshToken": path.read_text(encoding="utf-8").strip(),
    }).encode(), headers={
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.GetTokensFromRefreshToken"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            result = json.load(response)["AuthenticationResult"]
    except urllib.error.HTTPError as exc:
        reason = re.search(r'"message"\s*:\s*"([^"]*)"', exc.read().decode("utf-8", "replace"))
        raise SystemExit(f"Cognito refused the refresh token in {path} (HTTP {exc.code}"
                         f"{': ' + reason.group(1) if reason else ''}). Sign in to levels.fyi "
                         "again and copy a fresh one there.") from exc
    if result.get("RefreshToken"):
        path.write_text(result["RefreshToken"], encoding="utf-8")
    return result["IdToken"]


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


class Truncated(Exception):
    """A query reached the API's offset ceiling with rows still coming."""

    def __init__(self, rows: list[dict]):
        super().__init__(f"{len(rows)} rows read before the offset ceiling")
        self.rows = rows


def feed(bearer: str, role: str, delay: float, company: str | None = None,
         order: str = "DESC") -> list[dict] | None:
    """Every Spanish submission in one job family, to the end of the query.

    Without `company` it is the country-wide feed. `total` in the answer tops
    out at 250 but the API keeps serving rows past it, so paging stops at an
    empty page, not at the total. Rows repeat across pages when new
    submissions arrive mid-read; entries_by_company() dedupes on uuid. Each
    row carries its own exchange rate and currency, so the only thing the
    role's public page adds is the rate for rows paid in another currency.

    Returns None when a page could not be read: half a feed is not a smaller
    feed, and write_role() would treat the missing rows as deleted. Raises
    Truncated when the query outgrows the offset ceiling.
    """
    rows: list[dict] = []
    headers = {"Authorization": f"Bearer {bearer}", "x-agent": "levelsfyi_website",
               "Accept": "application/json", "Origin": BASE,
               "Referer": f"{BASE}/t/{role}/locations/spain"}
    for offset in range(0, MAX_OFFSET + 1, TABLE_PAGE):
        query = urllib.parse.urlencode(
            ([("companySlug", company)] if company else []) + [
                ("jobFamilySlug", role), ("countryIds[0]", SPAIN_COUNTRY_ID),
                ("offset", offset), ("limit", TABLE_PAGE),
                ("sortBy", "offer_date"), ("sortOrder", order)])
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
            print(f"  {role}: feed answer unreadable ({exc.__class__.__name__})",
                  file=sys.stderr)
            return None
        rows += page
        if not page:
            return rows
    raise Truncated(rows)


def read_role(bearer: str, role: str, delay: float, companies: list[dict],
              only: set | None = None):
    """(rows, scope) for one role, or None when it could not be read.

    scope is None when the country feed was read whole. A role past the
    offset ceiling is read newest-first and oldest-first; when the two
    windows meet, that is the whole feed. When they do not, the rows in
    between are only reachable per company: every employer either window
    names and every company already on file for the role is read on its own,
    and scope is the set of canonical slugs read whole. write_role() then
    touches only those, because an employer that reported only in the gap
    is invisible here and must keep what it has.
    """
    try:
        rows = feed(bearer, role, delay)
        return None if rows is None else (rows, None)
    except Truncated as newest:
        rows = newest.rows
    try:
        oldest = feed(bearer, role, delay, order="ASC")
    except Truncated as exc:
        oldest = exc.rows
    if oldest is None:
        return None
    if {_dedupe_key(r) for r in rows} & {_dedupe_key(r) for r in oldest}:
        return rows + oldest, None

    slugs = {r["companySlug"] for r in rows + oldest
             if isinstance(r.get("companySlug"), str) and r["companySlug"]}
    for company in companies:
        if company.get("levels_slug") and any(e.get("role") == role
                                              for e in company["entries"]):
            slugs.add(company["levels_slug"])
            slugs.update(lib.aliases_of(company["levels_slug"]))
    if only:
        slugs = {slug for slug in slugs if lib.canonical(slug) in only}
    print(f"  {role}: over {MAX_OFFSET + TABLE_PAGE} rows; reading {len(slugs)} "
          "companies one by one")
    read, unread = set(), set()
    for slug in sorted(slugs):
        try:
            found = feed(bearer, role, delay, company=slug)
        except Truncated:
            found = None
        if found is None:
            unread.add(lib.canonical(slug))
            print(f"    {slug}: unreadable, left untouched", file=sys.stderr)
            continue
        rows += found
        read.add(lib.canonical(slug))
    return rows + oldest, read - unread


def page_props(body: str) -> dict | None:
    found = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if not found:
        return None
    try:
        return json.loads(found.group(1))["props"]["pageProps"]
    except (KeyError, TypeError, json.JSONDecodeError):
        return None


def role_page(role: str, delay: float) -> dict | None:
    """The public /t/<role>/locations/spain page's props, for the euro rate.

    Non-euro rows convert at this page's locationExchangeRate; a page that is
    not quoting EUR is not about Spain and its rate is unusable, which costs
    only the rows that have no rate of their own.
    """
    body = get(f"{BASE}/t/{role}/locations/spain", delay)
    props = page_props(body) if body else None
    if not props or props.get("locationCurrency") != "EUR":
        return None
    return props


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

    Feed rows date themselves as JavaScript strings ("Thu Sep 24 2026
    08:53:46 GMT+0000"), page samples in ISO. The day is dropped: with a
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


def _dedupe_key(record: dict):
    """uuid, or the row's own facts when it has none."""
    return (record.get("uuid")
            or (record.get("companySlug"), record.get("offerDate"),
                record.get("baseSalary"), record.get("location"),
                record.get("yearsOfExperience"), record.get("level")))


def entries_by_company(rows: list[dict], role: str, page_rate, today: str):
    """Feed rows to {canonical slug: {"name": ..., "entries": [...]}}.

    Pure: tests hand it saved rows. Anything that names no employer, sits
    outside Spain, belongs to another family, states no years, or cannot be
    priced in euros is counted and skipped - never written.
    """
    by_slug: dict[str, dict] = {}
    seen: set = set()
    skipped = {"foreign": 0, "wrong-family": 0, "no-employer": 0,
               "no-years": 0, "not-euro": 0, "duplicate": 0}
    for record in rows:
        family = record.get("jobFamilySlug")
        if isinstance(family, str) and family != role:
            skipped["wrong-family"] += 1
            continue
        if not in_spain(record.get("location")):
            skipped["foreign"] += 1
            continue
        key = _dedupe_key(record)
        if key in seen:
            skipped["duplicate"] += 1
            continue
        seen.add(key)
        slug = record.get("companySlug")
        if not isinstance(slug, str) or not slug:
            skipped["no-employer"] += 1
            continue
        slug = lib.canonical(slug)
        if slug in lib.EXCLUDED_SLUGS:
            continue
        experience = record.get("yearsOfExperience")
        if lib.years(experience) is None:
            skipped["no-years"] += 1
            continue
        # A record that names euros converts back at its own rate to exactly
        # what its author typed; anything else goes through the page's.
        rate = page_rate
        if record.get("baseSalaryCurrency") == "EUR" and record.get("exchangeRate"):
            rate = record["exchangeRate"]
        base = eur(record.get("baseSalary"), rate)
        total = eur(record.get("totalCompensation"), rate)
        if base is None and total is None:
            skipped["not-euro"] += 1
            continue
        level = str(record.get("level") or "").strip()
        city, region = lib.split_location(record.get("location"))
        title = lib.title_slug(role, record.get("title"))
        entry = {
            "role": role,
            "base": base,
            "total": total,
            "bonus": eur(record.get("avgAnnualBonusValue") or record.get("firstYearBonusValue"), rate),
            "stock": eur(record.get("avgAnnualStockGrantValue") or record.get("firstYearStockGrantValue"), rate),
            "currency": record.get("baseSalaryCurrency") or None,
            "years_experience": str(experience),
            "level": None if level.lower() in NO_LEVEL else level,
            "title": title,
            # focusTag first; a sub-tag name maps to its parent, and a known
            # title implies its specialization when the author left both blank.
            "specialization": lib.specialization_slug(role, record.get("focusTag"))
                or lib.specialization_slug(role, record.get("focusSubTag"))
                or lib.title_spec(role, title),
            "city": city,
            "region": region,
            "work_arrangement": record.get("workArrangement") or None,
            "employment_type": record.get("employmentType") or None,
            "perspective": record.get("compPerspective") or None,
            "reported": reported(record.get("offerDate") or record.get("createdAt")),
            "source": "levels.fyi",
            "source_url": f"{BASE}/companies/{record['companySlug']}/salaries/{role}/locations/spain",
            "date": today,
            "notes": None,
        }
        group = by_slug.setdefault(slug, {"name": None, "entries": []})
        if not group["name"]:
            name = record.get("company") or (record.get("companyInfo") or {}).get("name")
            group["name"] = name if isinstance(name, str) and name else slug
        group["entries"].append(entry)
    for group in by_slug.values():
        group["entries"].sort(key=lib.entry_order)
    return by_slug, skipped


def _as_rows(entries: list[dict]) -> collections.Counter:
    # A multiset, not a sorted list: rows mix None and text in one column.
    return collections.Counter(tuple(entry.get(column) for column in lib.ENTRY_COLUMNS)
                               for entry in entries)


def write_role(role: str, by_slug: dict, only: set | None = None) -> dict:
    """Replace one role's stored Levels.fyi rows with the feed's, per company.

    Only the role's own rows are touched: first-hand entries and other roles
    stay exactly where they are. A company left with no rows at all is
    removed - on file means having salaries - but a hand-added row that never
    had any survives, because the fetcher may not have reached it yet. A slug
    struck off by hand is never written.
    """
    companies = lib.load_companies()
    stats = {"rewritten": 0, "unchanged": 0, "created": 0, "dropped": 0, "refused": 0}
    touched: set[int] = set()
    for company in companies:
        slug = company.get("levels_slug")
        canonical = lib.canonical(slug) if slug else None
        if (slug in lib.EXCLUDED_SLUGS) or (only and canonical not in only):
            continue
        found = by_slug.pop(canonical, None) if canonical else None
        kept = [entry for entry in company["entries"]
                if not unscoped(entry)
                and not (ours(entry) and entry.get("role") == role)]
        if found is None and len(kept) == len(company["entries"]):
            continue
        updated = kept + (found["entries"] if found else [])
        if _as_rows(company["entries"]) == _as_rows(updated):
            stats["unchanged"] += 1
            continue
        company["entries"] = updated
        touched.add(id(company))
        stats["rewritten"] += 1
    for slug in sorted(by_slug):
        if slug in lib.EXCLUDED_SLUGS or (only and slug not in only):
            continue
        group = by_slug[slug]
        if lib.by_name(companies, group["name"]):
            print(f"  {slug}: not created, {group['name']!r} is already on file "
                  "under another slug", file=sys.stderr)
            stats["refused"] += 1
            continue
        company = lib.blank_company(group["name"], levels_slug=slug, levels_status="resolved")
        company["entries"] = group["entries"]
        companies.append(company)
        stats["created"] += 1
    dropped = [company for company in companies
               if id(company) in touched and not company["entries"]]
    stats["dropped"] = len(dropped)
    companies = [company for company in companies if company not in dropped]
    if stats["rewritten"] or stats["created"] or stats["dropped"]:
        lib.save_companies(companies)
    return stats


def roles_from_args(args) -> list[str]:
    roles = sorted(dict.fromkeys(args.role)) if args.role else sorted(taxonomy.ROLES)
    unknown = [role for role in roles if role not in taxonomy.ROLES]
    if unknown:
        raise SystemExit(f"unknown job families: {', '.join(unknown)} "
                         "(regenerate scripts/taxonomy.py if Levels.fyi added them)")
    return roles


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--role", action="append", default=[],
                        help="Job-family slug. Repeatable. Defaults to every one in the catalog.")
    parser.add_argument("--company", action="append", default=[],
                        help="Write only this Levels.fyi slug. Repeatable. "
                             "The feeds are still read in full.")
    parser.add_argument("--delay", type=float, default=3.0,
                        help="Seconds between requests. Below ~2.5 trips their WAF.")
    parser.add_argument("--audit", action="store_true",
                        help="Report what each role's feed serves, write nothing.")
    args = parser.parse_args(argv)

    bearer = token()
    if not bearer:
        raise SystemExit(f"No token in LEVELS_TOKEN, {TOKEN_FILE} or {REFRESH_FILE}. The "
                         "feed is the only source and it needs one; --audit skips only "
                         "the writes, not the reading.")
    only = {lib.canonical(slug) for slug in args.company} or None
    today = lib.today_utc().isoformat()
    read = skipped_roles = 0

    try:
        for role in roles_from_args(args):
            answer = read_role(bearer, role, args.delay, lib.load_companies(), only)
            if answer is None:
                skipped_roles += 1
                print(f"  {role}: feed unreadable, left untouched", file=sys.stderr)
                continue
            rows, scope = answer
            if scope is not None:
                scope = scope & only if only else scope
            if not rows:
                print(f"  {role}: no Spanish submissions")
                if not args.audit:
                    write_role(role, {}, only if scope is None else scope)
                continue
            props = role_page(role, args.delay)
            by_slug, skipped = entries_by_company(rows, role,
                                                  (props or {}).get("locationExchangeRate"),
                                                  today)
            total = sum(len(group["entries"]) for group in by_slug.values())
            dropped = ", ".join(f"{k} {v}" for k, v in skipped.items() if v)
            print(f"  {role}: {total} entries at {len(by_slug)} companies"
                  + (f"  (skipped: {dropped})" if dropped else ""))
            read += 1
            if not args.audit:
                stats = write_role(role, by_slug, only if scope is None else scope)
                print("    file: " + ", ".join(f"{v} {k}" for k, v in stats.items() if v)
                      or "    file: nothing changed")
    except Blocked as exc:
        print(f"\n{exc}", file=sys.stderr)
        print("Progress so far is saved.", file=sys.stderr)

    print(f"\nroles read: {read}, unreadable: {skipped_roles}")
    if not args.audit:
        print(f"\n{ATTRIBUTION}")
        print("Next: python3 scripts/validate.py && python3 scripts/build.py")
    if not read:
        print("\nNo role could be read: Levels.fyi is refusing this machine "
              "(GitHub's runners get exactly this).", file=sys.stderr)
        return 1
    return 0 if skipped_roles < read else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
