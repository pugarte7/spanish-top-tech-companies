#!/usr/bin/env python3
"""Regressions that have actually happened here. Run:

    python3 tests/test_pipeline.py

No test framework and no dependencies on purpose: CI runs plain Python.

Every case below is a bug this repository shipped, not a hypothetical. The
location guard in particular has had to be enforced twice - 682 foreign salary
bands the first time, 205 the second - so it is checked from both ends: that
validate.py rejects such a band, and that the fetcher never writes one.
"""
from __future__ import annotations

import contextlib
import io
import json
import os
import pathlib
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import lib  # noqa: E402

UNSCOPED = "https://www.levels.fyi/companies/adyen/salaries"
PER_LOCATION = ("https://www.levels.fyi/companies/adyen/salaries"
                "/software-engineer/locations/spain")
DS_LOCATION = ("https://www.levels.fyi/companies/adyen/salaries"
               "/data-scientist/locations/spain")
COUNTRY = "https://www.levels.fyi/t/software-engineer/locations/spain"
OTHER_FAMILY = "https://www.levels.fyi/companies/bcg/salaries/data-scientist/locations/spain"
TODAY = "2026-10-14"

failures: list[str] = []


def check(label: str, got, want) -> None:
    if got == want:
        print(f"  pass  {label}")
    else:
        print(f"  FAIL  {label}\n          got  {got!r}\n          want {want!r}")
        failures.append(label)


def entry(url: str | None, notes: str = "", source: str = "levels.fyi", **fields) -> dict:
    return {"role": "software-engineer", "base": 80000, "years_experience": "8",
            "notes": notes, "source": source, "source_url": url,
            "date": "2026-08-31", **fields}


def row(slug: str = "acme", base: float = 100000, years=8,
        where: str = "Madrid, MD, Spain", uuid: str | None = None,
        role: str = "software-engineer", **extra) -> dict:
    """One row of the signed-in feed, the shape api.levels.fyi serves."""
    return {"uuid": uuid or f"{slug}-{base}-{years}-{where}",
            "companySlug": slug, "company": slug.replace("-", " ").title(),
            "jobFamilySlug": role, "level": "L4", "location": where,
            "yearsOfExperience": years, "baseSalary": base,
            "totalCompensation": base, "baseSalaryCurrency": "EUR",
            "exchangeRate": 0.86,
            "offerDate": "Thu Jun 25 2026 10:00:00 GMT+0000", **extra}


@contextlib.contextmanager
def temp_data(*companies: dict):
    """Point the scripts at a throwaway companies.csv holding these companies."""
    original = lib.DATA
    with tempfile.TemporaryDirectory() as directory:
        lib.DATA = pathlib.Path(directory) / "companies.csv"
        try:
            lib.save_companies(list(companies))
            yield lib.DATA
        finally:
            lib.DATA = original


def acme(*entries: dict, **fields) -> dict:
    return lib.blank_company("Acme", levels_slug="acme", levels_status="resolved",
                             **fields) | {"entries": list(entries)}


def stored(slug: str = "acme") -> dict | None:
    return lib.by_slug(lib.load_companies(), slug)


def fed(rows: list[dict], role: str = "software-engineer", rate: float = 0.86,
        today: str = TODAY):
    """What fetch_spain.entries_by_company does with feed rows."""
    import fetch_spain
    return fetch_spain.entries_by_company(rows, role, rate, today)


def write_role(role: str, by_slug: dict, only: set | None = None) -> dict:
    import fetch_spain
    with contextlib.redirect_stderr(io.StringIO()):
        return fetch_spain.write_role(role, by_slug, only)


def test_location_guard() -> None:
    """An entry must cite a URL that names a location, or validate.py fails.

    It also has to be a company page for the row's own job family: the country
    pages publish one median pooled across everyone, and another family's page
    is another job.
    """
    print("validate.py rejects data that cannot prove it is a Spanish salary")
    import validate

    for label, url, message in (
        ("unscoped company page is rejected", UNSCOPED, "not Spain-scoped"),
        ("country job-family page is rejected", COUNTRY, "cannot hold one person"),
        ("another job family is rejected", OTHER_FAMILY, "role is 'software-engineer'"),
    ):
        validate.errors.clear()
        validate.check_entry("test", entry(url))
        check(label, any(message in e for e in validate.errors), True)

    for label, found in (
        ("per-location software-engineer page is accepted", entry(PER_LOCATION)),
        ("a data-scientist row cites the data-scientist page",
         entry(DS_LOCATION, role="data-scientist")),
        # Someone reporting their own salary has no Levels.fyi URL to name.
        ("first-hand source needs no location", entry(None, source="offer-letter")),
    ):
        validate.errors.clear()
        validate.check_entry("test", found)
        check(label, validate.errors, [])


def test_unscoped_classifier() -> None:
    print("fetch_spain.unscoped() reads the URL, not the notes")
    import fetch_spain

    check("unscoped company page", fetch_spain.unscoped(entry(UNSCOPED)), True)
    check("per-location page", fetch_spain.unscoped(entry(PER_LOCATION)), False)

    # The wording of `notes` is not evidence of anything. Matching on it is
    # what let 173 of the 205 stale bands through: the purge looked for
    # "reports this as" and these two shapes never say it.
    for notes in ("Median across all levels.",
                  "Common Range Average across all levels."):
        check(f"unscoped despite notes {notes!r}",
              fetch_spain.unscoped(entry(UNSCOPED, notes=notes)), True)


def test_purge_runs_even_when_spain_data_exists() -> None:
    """The second regression, exactly.

    The purge used to run only for companies with no Spanish figure, so any
    company that did have one kept its foreign bands sitting beside it. Adyen
    kept a Dutch band next to a Spanish one.
    """
    print("fetch_spain.write_role() drops foreign entries beside a Spanish one")
    import fetch_spain

    with temp_data(acme(entry(UNSCOPED, "reports this as 'L3'."),
                        entry(UNSCOPED, "Common Range Average across all levels."))):
        by_slug, _ = fed([row("acme")])
        write_role("software-engineer", by_slug)
        check("only the Spanish entry survives",
              [e["source_url"] for e in stored()["entries"]],
              ["https://www.levels.fyi/companies/acme/salaries"
               "/software-engineer/locations/spain"])

    with temp_data(acme(entry(None, source="community"))):
        write_role("software-engineer", {})
        check("a first-hand entry is left alone",
              [e["source"] for e in stored()["entries"]], ["community"])


def test_figures_are_converted_to_euros() -> None:
    """The payload is USD. Writing it as euros overstated 141 bands.

    Levels.fyi stores every figure in USD and multiplies by
    locationExchangeRate to print euros - its own FAQ text on Glovo's Spanish
    page says the median total of 79710.65 is EUR 68.551. This script wrote the
    raw number as euros, so every figure it produced was about 16% high.

    A row's own exchangeRate converts to the currency its author was paid in,
    which is not always euros. Smile.io's was 105.000 USD at a rate of 1, and
    it went on the list as 105.000 EUR.
    """
    print("fetch_spain converts USD to EUR")
    import fetch_spain

    check("Glovo's published euro figure", fetch_spain.eur(79710.65, 0.86), 68551)

    # A euro submission round-trips to the figure its author typed: exactly
    # 70.000 EUR at its own rate, whatever the page-wide rate is.
    by_slug, _ = fed([row(base=81641.1, years=6, exchangeRate=0.857413)])
    check("a euro submission uses its own rate", by_slug["acme"]["entries"][0]["base"], 70000)

    by_slug, _ = fed([row(base=105000, baseSalaryCurrency="USD", exchangeRate=1)])
    check("a dollar submission goes through the rate given",
          by_slug["acme"]["entries"][0]["base"], 90300)
    check("and is marked as paid in dollars",
          by_slug["acme"]["entries"][0]["currency"], "USD")

    by_slug, skipped = fed([row(base=105000, baseSalaryCurrency="USD", exchangeRate=1)],
                           rate=None)
    check("a dollar submission with no euro rate is dropped, not guessed",
          (by_slug, skipped["not-euro"]), ({}, 1))

    # Since 2026-11-02 the rate comes from the feed itself, with the role
    # page behind the WAF: the euro rows nearest in month, whose own rate is
    # the dollar-to-euro rate of that month.
    euros = ([row(uuid=f"e22-{i}", exchangeRate=1.04,
                  offerDate="Mon Jun 20 2022 10:00:00 GMT+0000") for i in range(3)]
             + [row(uuid=f"e25-{i}", exchangeRate=0.86,
                    offerDate="Wed Jun 25 2025 10:00:00 GMT+0000") for i in range(3)])
    dollars = [row("usd", base=100000, baseSalaryCurrency="USD", exchangeRate=1, uuid="d22",
                   offerDate="Fri Jul 01 2022 10:00:00 GMT+0000"),
               row("usd", base=100000, baseSalaryCurrency="USD", exchangeRate=1, uuid="d25",
                   offerDate="Tue Jul 01 2025 10:00:00 GMT+0000")]
    by_slug, skipped = fed(euros + dollars, rate=None)
    check("a dollar row converts at the euro rows' rate of its own month",
          (sorted(e["base"] for e in by_slug["usd"]["entries"]), skipped["not-euro"]),
          ([86000, 104000], 0))
    check("a feed with no euro rows prices nothing",
          fetch_spain.rate_near(fetch_spain.euro_rates(dollars), None), None)


def test_every_year_is_kept() -> None:
    """The file keeps every seniority, and the medians count every engineer.

    Seniority is five or more years, whatever the level says: on 2026-09-15
    the list briefly counted only rungs named senior, which threw away an L4
    with eight years at 90k and would have kept a "Senior" with two. Pay never
    decided who is a row either - until 2026-09-22 only seniors at 60k+ were
    kept, so two 90k engineers made Minsait read 90k while fourteen under 60k
    went unrecorded. Since 2026-10-14 juniors and other roles are kept for
    the website, and since 2026-10-17 juniors reach the engineers' median too.
    """
    print("fetch_spain keeps every year of experience; engineer_entries filters roles")

    by_slug, skipped = fed([row(years=8, level="SDE I"),
                            row(years=4, level="Senior Software Engineer"),
                            row(years="5-10", level=None),
                            row(years="2-4"),
                            row(years=None, uuid="no-years")])
    entries = by_slug["acme"]["entries"]
    check("every parseable year becomes a row, 'False' levels do not",
          sorted(e["years_experience"] for e in entries), ["2-4", "4", "5-10", "8"])
    check("a row with no years is skipped", skipped["no-years"], 1)
    check("the median counts software engineers at any experience",
          len(lib.engineer_entries(acme(*entries))), 4)
    check("and no other role",
          len(lib.engineer_entries(acme(entry(None, role="product-manager")))), 0)
    check("a bucket counts from its low end", lib.years("5-10"), 5)
    check("an open bucket counts from its number", lib.years("11+"), 11)

    import validate
    for label, row_, bad in (
        ("under five years is data now", entry(PER_LOCATION, years_experience="4"), False),
        ("no years", entry(PER_LOCATION, years_experience=None), True),
        ("a first-hand senior SWE under 60k", entry(None, source="community", base=55000), True),
        ("a first-hand junior SWE under 60k",
         entry(None, source="community", base=40000, years_experience="2"), True),
        ("a first-hand junior PM under 60k",
         entry(None, source="community", base=30000, years_experience="2",
               role="product-manager"), False),
        ("a Levels.fyi entry under 60k", entry(PER_LOCATION, base=55000), False),
    ):
        validate.errors.clear()
        validate.check_entry("test", row_)
        check(f"validate.py {'rejects' if bad else 'keeps'} {label}", bool(validate.errors), bad)


def test_one_submission_is_one_entry() -> None:
    """Feed rows repeat across pages when submissions arrive mid-read.

    Dedupe is on uuid; a row without one dedupes on its own facts.
    """
    print("fetch_spain lists a submission once")

    shared = row(uuid="same", base=81641.1, years=6, exchangeRate=0.857413)
    by_slug, skipped = fed([shared, dict(shared)])
    check("one entry, at the submission's own rate",
          [e["base"] for e in by_slug["acme"]["entries"]], [70000])
    check("the repeat counted as a duplicate", skipped["duplicate"], 1)

    anon = row(uuid=None, base=90000)
    anon.pop("uuid")
    by_slug, _ = fed([anon, dict(anon)])
    check("uuid-less rows dedupe on their facts",
          len(by_slug["acme"]["entries"]), 1)


def test_the_world_vouches_for_a_company() -> None:
    """A company under five submissions anywhere, over every role, is nobody's
    employer: DEKA's 300k mechanical engineer was the only DEKA submission in
    the world (maintainer, 2026-11-01). Judged once every role is written, so
    three engineers and three product managers count as six (2026-11-02).
    The company's domain from the feed is its website."""
    print("fetch_spain asks the world about small companies")
    import fetch_spain

    def company(name, *entries):
        return lib.blank_company(name.title(), levels_slug=name,
                                 levels_status="resolved") | {"entries": list(entries)}
    seen = {"checked": TODAY}
    cache = {"deka|software-engineer": {"total": 1, **seen},
             "repsol|software-engineer": {"total": 3, **seen},
             "repsol|product-manager": {"total": 3, **seen},
             "hand|software-engineer": {"total": 1, **seen},
             "stale|software-engineer": {"total": 1, "checked": "2025-01-01"}}
    with temp_data(
            company("deka", entry(PER_LOCATION, base=300000)),
            company("repsol", *[entry(PER_LOCATION, base=60000 + i) for i in range(3)],
                    *[entry(DS_LOCATION, role="product-manager", base=70000 + i) for i in range(3)]),
            company("hand", entry(None, source="community", base=90000), entry(PER_LOCATION)),
            company("stale", entry(PER_LOCATION)),
            company("dark", entry(PER_LOCATION)),
            company("many", *[entry(PER_LOCATION, base=70000 + i) for i in range(5)])):
        stats = fetch_spain.prune_unproven(cache, TODAY)
        left = {c["levels_slug"]: len(c["entries"]) for c in lib.load_companies()}
        check("one submission in the world, over every role, drops the company",
              (stats, "deka" in left), ({"unproven": 2, "companies": 1}, False))
        check("three engineers and three product managers are six people",
              left["repsol"], 6)
        check("the first-hand row stays when the Levels.fyi one goes", left["hand"], 1)
        check("a stale or missing answer judges nothing",
              (left["stale"], left["dark"]), (1, 1))
        check("five Spanish rows are five submissions", left["many"], 5)

    by_slug, _ = fed([row("acme", companyInfo={"icon": "https://img.logo.dev/acme.example?token=x"})])
    with temp_data(acme(entry(PER_LOCATION, base=80000))):
        write_role("software-engineer", by_slug)
        check("the feed's domain becomes the website of a company without one",
              stored()["website"], "https://acme.example")
    with temp_data(acme(entry(PER_LOCATION, base=80000), website="https://typed.example")):
        by_slug, _ = fed([row("acme", companyInfo={"icon": "https://img.logo.dev/acme.example?token=x"})])
        write_role("software-engineer", by_slug)
        check("a website on file is never overwritten", stored()["website"], "https://typed.example")


def test_foreign_rows_are_skipped() -> None:
    """Every row is checked for its own location, whatever feed it came in.

    The same guard that has had to be enforced twice elsewhere: a Berlin
    submission arriving in the Spanish feed is still a German salary.
    """
    print("fetch_spain skips a submission from outside Spain")

    by_slug, skipped = fed([row(where="Berlin, BE, Germany", uuid="de"),
                            row(uuid="es")])
    entries = by_slug["acme"]["entries"]
    check("only the Spanish submission survives",
          [(e["city"], e["region"]) for e in entries], [("Madrid", "MD")])
    check("the foreign one is counted", skipped["foreign"], 1)


def test_feed_is_read_to_the_end() -> None:
    """The feed keeps serving rows past its own `total`; read until empty.

    The API's total tops out at 250, so a caller that trusts it reads only
    the newest three months and misses Amazon's and Glovo's older rows. The
    feed is also the whole source of truth: a page that cannot be read is not
    an empty feed.
    """
    print("fetch_spain pages the feed until an empty answer")
    import fetch_spain

    calls = []

    def fake_get(url, delay, attempts=3, headers=None):
        calls.append(url)
        return pages.pop(0) if pages else None

    original = fetch_spain.get
    fetch_spain.get = fake_get
    try:
        a, b, c = row(uuid="a"), row(uuid="b"), row(uuid="c")
        pages = [json.dumps({"total": 250, "rows": [a, b]}),
                 json.dumps({"total": 250, "rows": [b, c]}),
                 json.dumps({"total": 250, "rows": []})]
        found = fetch_spain.feed("token", "software-engineer", 0)
        check("pages until the empty one, ignoring the lying total",
              [r["uuid"] for r in found], ["a", "b", "b", "c"])
        check("the offset walked by page size, not by new rows",
              ["offset=50" in u for u in calls[1:2]], [True])

        pages = [None]
        check("a page that fails to load makes the feed unread",
              fetch_spain.feed("token", "data-scientist", 0), None)
        pages = ['not json']
        check("a page that does not parse makes the feed unread",
              fetch_spain.feed("token", "data-scientist", 0), None)
        pages = [json.dumps({"rows": [{"uuid": "x"}] * 50})] * 40
        try:
            fetch_spain.feed("token", "software-engineer", 0)
            truncated = False
        except fetch_spain.Truncated:
            truncated = True
        check("a feed past the offset ceiling is truncated, not complete", truncated, True)
        check("no offset past the ceiling is asked for",
              any("offset=1000" in u for u in calls), False)
    finally:
        fetch_spain.get = original

    # The API wraps its answer the way the site's own JavaScript unwraps it.
    import base64, hashlib, subprocess, zlib
    key = base64.b64encode(hashlib.md5(b"levelstothemoon!!").digest())[:16]
    body = zlib.compress(json.dumps({"total": 1, "rows": [{"uuid": "x"}]}).encode())
    sealed = subprocess.run(["openssl", "enc", "-aes-128-ecb", "-K", key.hex()],
                            input=body, capture_output=True, check=True).stdout
    check("an encrypted answer is decoded", fetch_spain.decrypt(base64.b64encode(sealed).decode()),
          {"total": 1, "rows": [{"uuid": "x"}]})

    # A few feed rows carry False for both company fields: they name no
    # employer to file under and are skipped. Rows of another family arriving
    # in this feed are skipped too.
    by_slug, skipped = fed([row(uuid="ok"), row(uuid="anon", companySlug=False,
                                                company=False),
                            row(uuid="other", jobFamilySlug="data-scientist")])
    check("rows naming no employer or another family are skipped",
          (len(by_slug["acme"]["entries"]), skipped["no-employer"],
           skipped["wrong-family"]), (1, 1, 1))


def test_a_role_past_the_ceiling_is_read_per_company() -> None:
    """One query sees at most 1,000 rows; software engineers are more.

    On 2026-10-16 the all-roles run could not read software engineers: the
    API refuses an offset past 990. Newest-first and oldest-first leave a
    gap of years between them, so read_role() reads each employer on its own
    and scopes the write to the companies it read.
    """
    print("fetch_spain reads a role past the offset ceiling company by company")
    import fetch_spain

    def fake_feed(bearer, role, delay, company=None, order="DESC"):
        if company is None:
            raise fetch_spain.Truncated([row("newco", uuid="n1")] if order == "DESC"
                                        else [row("oldco", uuid="o1")])
        if company == "broken":
            return None
        return [row(company, uuid=f"{company}-1"), row(company, uuid=f"{company}-2")]

    original = fetch_spain.feed
    fetch_spain.feed = fake_feed
    try:
        on_file = [acme(entry(PER_LOCATION)),
                   lib.blank_company("Broken", levels_slug="broken") | {"entries": [entry(PER_LOCATION)]},
                   lib.blank_company("Analysts", levels_slug="analysts")
                   | {"entries": [entry(PER_LOCATION, role="data-analyst")]}]
        rows, scope = fetch_spain.read_role("t", "software-engineer", 0, on_file)
        check("windows' employers and companies on file are read; others are not",
              scope, {"newco", "oldco", "acme"})
        check("the per-company rows are kept",
              sorted(r["uuid"] for r in rows if r["companySlug"] == "acme"), ["acme-1", "acme-2"])
        rows, scope = fetch_spain.read_role("t", "software-engineer", 0, on_file, {"lost"})
        check("a company asked for by name is read on its own, even off file",
              (scope, sorted(r["uuid"] for r in rows if r["companySlug"] == "lost")),
              ({"lost"}, ["lost-1", "lost-2"]))

        # 2026-11-02: an empty scope (no company read whole) was taken as no
        # limit, and every software engineer was replaced by the windows' rows.
        with temp_data(acme(entry(PER_LOCATION))):
            stats = fetch_spain.write_role("software-engineer", {}, set())
            check("an empty scope writes nothing",
                  (stats["rewritten"], stats["dropped"], len(stored()["entries"])), (0, 0, 1))

        def meeting(bearer, role, delay, company=None, order="DESC"):
            raise fetch_spain.Truncated([row(uuid="same")])
        fetch_spain.feed = meeting
        check("windows that meet are the whole feed",
              fetch_spain.read_role("t", "software-engineer", 0, on_file)[1], None)
    finally:
        fetch_spain.feed = original


def test_an_unread_feed_changes_nothing() -> None:
    """A feed that failed to load is not a feed with no entries.

    An unreachable page used to count as a page with no figures and delete
    what was on file; an unreadable feed would do that to every company in a
    role at once.
    """
    print("a role whose feed cannot be read is left untouched")
    import fetch_spain

    calls = []
    original = fetch_spain.feed, fetch_spain.write_role, fetch_spain.token
    real_write = fetch_spain.write_role
    fetch_spain.token = lambda: "test-token"
    fetch_spain.write_role = lambda *a, **kw: calls.append(a) or real_write(*a, **kw)
    try:
        fetch_spain.feed = lambda *a, **kw: None
        with temp_data(acme(entry(PER_LOCATION))):
            with contextlib.redirect_stderr(io.StringIO()):
                fetch_spain.main(["--role", "software-engineer"])
            check("unreadable feed: write_role never called",
                  (calls, stored()["entries"][0]["source_url"]), ([], PER_LOCATION))

        fetch_spain.feed = lambda *a, **kw: []
        with temp_data(acme(entry(PER_LOCATION))):
            calls.clear()
            with contextlib.redirect_stderr(io.StringIO()):
                fetch_spain.main(["--role", "software-engineer"])
            check("an empty feed is a real answer and wipes the role's rows",
                  (len(calls), stored()), (1, None))
    finally:
        fetch_spain.feed, fetch_spain.write_role, fetch_spain.token = original


def test_companies_are_their_salaries() -> None:
    """On file means having salaries; the floor and the bar are about the median.

    Until 2026-10-14 a company under the 50k floor was deleted. Now the file
    keeps every role and seniority for the website, so low-median data stays
    on file - it is just not listed. What still disappears is a
    company with no rows at all after a full role read, and the feed still
    never writes a struck-off slug.
    """
    print("a company is kept while it has any salary, dropped at zero")
    import fetch_spain

    with temp_data(acme(entry(PER_LOCATION))):
        low = fed([row(base=52325)])  # 45k EUR
        write_role("software-engineer", low[0])
        check("a median under the floor stays on file",
              (stored() is not None, lib.listed(stored())), (True, False))

    with temp_data(acme(entry(PER_LOCATION))):
        write_role("software-engineer", {})
        check("a company whose feed emptied is dropped", stored(), None)

    with temp_data(acme(entry(None, source="community"))):
        write_role("software-engineer", {})
        check("a first-hand entry keeps it", stored() is not None, True)

    with temp_data():
        stats = write_role("software-engineer", {})
        check("nothing read, nothing created", (stats, stored()),
              ({"rewritten": 0, "unchanged": 0, "created": 0, "dropped": 0, "refused": 0}, None))

    with temp_data():
        by_slug, _ = fed([row("newco")])
        stats = write_role("software-engineer", by_slug)
        check("a feed employer not on file is created",
              (stats["created"], stored("newco")["company"]), (1, "Newco"))

    with temp_data(acme()):
        pass  # an empty hand-added row is validate.py's problem, checked below

    import validate
    for label, company, refused in (
        ("an empty row", acme(), True),
        ("rows all under 50k", acme(entry(PER_LOCATION, base=45000)), False),
        ("a median at 60k+", acme(entry(PER_LOCATION, base=45000), entry(PER_LOCATION)), False),
    ):
        validate.errors.clear()
        validate.check_company("acme", company)
        check(f"validate.py {'refuses' if refused else 'keeps'} {label}",
              any("no salaries on file" in e for e in validate.errors), refused)

    with temp_data(acme(entry(None, source="community"))):
        check("excluded rows never reach write_role", fed([row("abracadabra")])[0], {})
        stats = write_role("software-engineer", fed([row("abracadabra")])[0])
        check("a struck-off slug is never written or created",
              (stats["created"], stored("abracadabra")), (0, None))
        check("and a first-hand row elsewhere is untouched",
              [e["source"] for e in stored()["entries"]], ["community"])


def test_median_over_every_engineer() -> None:
    """The statistic is the median over every software engineer, never a mean.

    Two of Minsait's sixteen seniors are at 90k. The mean of those two, which
    the README showed until 2026-09-22, said Minsait pays 90k; the median over
    all sixteen says 43.5k. "Use all the data" was the criticism, and the
    maintainer took it, keeping the 60k bar for which list a company is on.
    """
    print("the median is over every engineer, juniors included, other roles never")
    company = acme(entry(PER_LOCATION, base=90000, total=95000), entry(PER_LOCATION, base=90000),
                   *[entry(PER_LOCATION, base=40000 + 1000 * i) for i in range(6)])
    check("median over all engineers, not the mean of the 60k+ ones",
          (lib.median_base(company), len(lib.engineer_entries(company))), (43500, 8))
    check("and a company with that median is not at the bar", lib.competitive(company), False)

    with_junior_and_pm = acme(
        entry(PER_LOCATION, base=90000), entry(PER_LOCATION, base=41000),
        entry(PER_LOCATION, base=30000, years_experience="2"),
        entry(DS_LOCATION, role="data-scientist", base=200000))
    check("juniors reach the median, other roles never do",
          (lib.median_base(with_junior_and_pm), len(lib.engineer_entries(with_junior_and_pm))), (41000, 3))


def test_floor_aliases_and_exclusions() -> None:
    """The maintainer's hand on the data, 2026-09-23.

    "I don't wanna lose all those companies": a median between 50k and 60k is
    kept and listed as "need to improve". "Timescale and Tiger Data are the
    same": an alias slug's rows are filed under the canonical company, each
    row keeping the page it came from. "Remove Abracadabra as we don't know
    what company it is": a struck-off slug is never written or created.
    """
    print("floor, alias slugs and struck-off slugs")
    import fetch_spain
    import validate

    def named(name: str, *entries: dict, **fields) -> dict:
        return lib.blank_company(name, **fields) | {"entries": list(entries)}
    check("a median at 60k+ is at the bar",
          lib.competitive(named("At Bar", entry(PER_LOCATION, base=70000))), True)
    check("under the floor is not listed",
          lib.listed(named("Low", entry(PER_LOCATION, base=49000))), False)
    check("at the floor is listed but not competitive",
          (lib.listed(named("Mid", entry(PER_LOCATION, base=55000))),
           lib.competitive(named("Mid", entry(PER_LOCATION, base=55000)))), (True, False))

    # An alias slug's rows are filed under the canonical slug; each row keeps
    # the page it was read from in its source URL.
    with temp_data(named("Timescale", entry(PER_LOCATION), levels_slug="timescale",
                         levels_status="resolved")):
        by_slug, _ = fed([row("timescale", base=120000, uuid="a"),
                          row("tiger-data", base=150000, uuid="b")])
        write_role("software-engineer", by_slug)
        found = stored("timescale")
        check("alias rows join the canonical company with their own page URL",
              sorted((e["base"], e["source_url"].split("/companies/")[1].split("/")[0])
                     for e in found["entries"]),
              [(103200, "timescale"), (129000, "tiger-data")])

    for label, company, message in (
        ("an alias slug's own row group", named("Tiger", entry(PER_LOCATION), levels_slug="tiger-data"),
         "is an alias of"),
        ("a struck-off slug", named("Abracadabra", entry(PER_LOCATION), levels_slug="abracadabra"),
         "struck off"),
    ):
        validate.errors.clear()
        validate.check_company("test", company)
        check(f"validate.py refuses {label}", any(message in e for e in validate.errors), True)


def test_normalization() -> None:
    """New fields are normalized enums, never the free text an author typed."""
    print("locations, titles and specializations normalize")

    check("a Levels.fyi location splits",
          lib.split_location("Barcelona, CT, Spain"), ("Barcelona", "CT"))
    check("a radar-style region name maps to its code",
          lib.split_location("Palma, Illes Balears, Spain"), ("Palma", "IB"))
    check("a misspelled city is fixed", lib.split_location("1A Coruna, GA, Spain"),
          ("A Coruna", "GA"))
    check("a bare city has no region", lib.split_location("Madrid, Spain"), ("Madrid", None))

    check("seniority words are stripped for the title lookup",
          lib.title_slug("software-engineer", "Senior Data Engineer"), "data-engineer")
    check("a developer spelling maps to the catalog's engineer",
          lib.title_slug("software-engineer", "iOS Developer"), "ios-engineer")
    check("an abbreviation expands", lib.title_slug("software-engineer", "ML Engineer"),
          "machine-learning-engineer")
    check("the family's own name is not a title worth storing",
          lib.title_slug("software-engineer", "Software Engineer"), None)
    check("an invented title stays empty",
          lib.title_slug("software-engineer", "Wizard of Code"), None)

    check("a displayValue matches its slug",
          lib.specialization_slug("software-engineer", "Machine Learning"), "ml-ai")
    check("a sub-tag maps to its parent",
          lib.specialization_slug("software-engineer", "Pre-training"), "ml-ai")
    check("the family's own name is its generic bucket",
          lib.specialization_slug("data-scientist", "Data Science"), "general")
    check("an unsalvageable focus stays empty",
          lib.specialization_slug("data-scientist", "Asociarte Tech Analyst"), None)
    check("a known title backfills an empty focusTag",
          lib.title_spec("software-engineer", "data-engineer"), "data")

    by_slug, _ = fed([row(uuid="x", title="Senior Data Engineer", focusTag=None,
                          workArrangement="remote", employmentType="contract",
                          compPerspective="offer")])
    found = by_slug["acme"]["entries"][0]
    check("a feed row becomes a normalized entry",
          (found["title"], found["specialization"], found["work_arrangement"],
           found["employment_type"], found["perspective"], found["region"],
           found["currency"], found["reported"]),
          ("data-engineer", "data", "remote", "contract", "offer", "MD", "EUR", "2026-06"))


def test_radar_enrichment() -> None:
    """Spain Tech Radar enriches salary-bearing companies, matched three ways."""
    print("fetch_radar matches and fills without overwriting")
    import fetch_radar

    empresa = {"slug": "acme-com", "nombre": "Acme", "dominio": "acme.com",
               "tipo": "producto", "remoto": "hibrido", "cif": "B12345678",
               "enlaces": {"web": "https://acme.com", "empleo": "https://acme.com/jobs",
                           "github": "https://github.com/acme"},
               "oficinas": [{"municipio": "Barcelona", "comunidad": "Cataluña",
                             "lat": 41.38, "lon": 2.17}],
               "stack": [{"tecnologia": "Python"}, {"tecnologia": "TypeScript"}]}
    wanted = fetch_radar.fields(empresa)
    check("a radar company maps to our columns",
          (wanted["company_type"], wanted["remote_policy"], wanted["offices"],
           wanted["stack"], wanted["cif"]),
          ("product", "hybrid", ["Barcelona, CT (41.38,2.17)"],
           ["Python", "TypeScript"], "B12345678"))

    company = acme(entry(PER_LOCATION), website=None, linkedin_url="https://www.linkedin.com/company/acme")
    filled = fetch_radar.fill(company, wanted)
    check("empty fields are filled", filled > 0 and company["company_type"], "product")

    company = acme(entry(PER_LOCATION), website="https://acme.example",
                   remote_policy="-")
    fetch_radar.fill(company, wanted)
    check("hand-set values are never overwritten, '-' included",
          (company["website"], company["remote_policy"]),
          ("https://acme.example", "-"))

    dataset = [empresa,
               {"slug": "same-a", "nombre": "Same Name", "dominio": "same-a.com",
                "enlaces": {}, "oficinas": [], "stack": [], "tipo": "desconocido"},
               {"slug": "same-b", "nombre": "Same Name", "dominio": "same-b.com",
                "enlaces": {}, "oficinas": [], "stack": [], "tipo": "desconocido"},
               {"slug": "linked", "nombre": "Other", "dominio": "other.io",
                "enlaces": {"linkedin": "https://www.linkedin.com/company/acme"},
                "oficinas": [], "stack": [], "tipo": "desconocido"}]
    companies = [acme(entry(PER_LOCATION), website="https://acme.com"),
                 acme(entry(PER_LOCATION), website=None,
                      linkedin_url="https://www.linkedin.com/company/acme"),
                 lib.blank_company("Same Name", levels_slug="same") | {"entries": [entry(PER_LOCATION)]},
                 lib.blank_company("No Salaries") | {"entries": []}]
    companies[1]["company"] = "Acme2"
    matched = fetch_radar.match(companies, dataset)
    check("domain wins; ambiguous names and salary-less companies are skipped",
          {name: way for name, (_, way) in matched.items()},
          {"Acme": "domain", "Acme2": "linkedin"})


def test_rows_compare_with_empty_cells() -> None:
    """A role's rows mix empty and filled cells in one column.

    The first all-roles run died at data-analyst on 2026-10-15: comparing the
    stored rows with the feed's sorted tuples, and None does not sort
    against text.
    """
    print("fetch_spain compares rows whose cells are empty in some, filled in others")
    import fetch_spain
    rows = [entry(PER_LOCATION, city=None), entry(PER_LOCATION, city="Madrid")]
    check("same rows, any order, compare equal",
          fetch_spain._as_rows(rows) == fetch_spain._as_rows(rows[::-1]), True)
    with temp_data(acme(*rows)):
        by_slug = {"acme": {"name": "Acme", "entries": stored()["entries"][::-1]}}
        check("an unchanged role counts as unchanged",
              write_role("software-engineer", by_slug)["unchanged"], 1)


def test_agents_see_only_groups_of_five() -> None:
    """data.json holds no group under MIN_GROUP, no quartiles under QUARTILE_MIN and no
    unrounded euro: with three people, median and quartiles gave back every salary."""
    print("published aggregates cannot be turned back into salaries")
    import importlib.util
    spec = importlib.util.spec_from_file_location("site_build", ROOT / "scripts" / "site.py")
    site_build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(site_build)
    madrid = (40100, 45300, 50200, 55500, 61400, 70400, 75000, 82600, 90000, 99900)
    rows = [entry(PER_LOCATION, base=b, region="MD", city="Madrid") for b in madrid]
    rows += [entry(PER_LOCATION, base=b, region="VC", city="Valencia")
             for b in (50200, 61400, 70400, 82600, 90000)]
    rows += [entry(PER_LOCATION, base=b, region="CT", city="Barcelona")
             for b in (60000, 65000, 70000, 80000)]
    with temp_data(acme(*rows, website="https://acme.example")):
        data = site_build.build_data(lib.load_companies())

    def quartiles(region: str) -> list:
        a = data["cells"][f"|{region}|"]
        return [a["median"], a["p25"], a["p75"]]

    check("Madrid's ten: median and quartiles, rounded to 1,000",
          quartiles("MD"), [66000, 52000, 81000])
    check("Valencia's five: median and quartiles too", quartiles("VC"), [70000, 61000, 83000])
    check("Barcelona's four give nothing", data["cells"].get("|CT|"), None)
    published = list(data["cells"].values()) + [a for v in data["company_cells"].values() for a in v]
    check("no published group under five", min(a["n"] for a in published), 5)
    check("every published euro figure is a multiple of 1,000",
          [a for a in published for k in ("median", "p25", "p75", "total")
           if a[k] is not None and a[k] % 1000], [])
    check("years are bucketed", site_build.year_bucket(8), "8-11")
    check("a company's groups leave Barcelona out",
          sorted(key.split("|")[1] for key, found in data["company_cells"].items()
                 if key.split("|")[0] == key.split("|")[2] == "" and found), ["", "MD", "VC"])
    check("llms-full.txt renders", "## By region" in site_build.llms_full(data), True)


def test_location_files_list_companies_all_there() -> None:
    """A place's file keeps rows only for companies that are also elsewhere; one
    whose salaries are all in the place is listed under `whole` and the page
    takes its rows from the role's file. A city that is all of its region has
    no file of its own."""
    print("location files are a lookup on the role's file")
    import importlib.util
    spec = importlib.util.spec_from_file_location("site_build", ROOT / "scripts" / "site.py")
    site_build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(site_build)
    madrid = dict(region="MD", city="Madrid")
    acme_rows = [entry(PER_LOCATION, base=b, **madrid) for b in (70000, 80000, 90000)]
    beta_url = "https://www.levels.fyi/companies/beta/salaries/software-engineer/locations/spain"
    beta = lib.blank_company("Beta", levels_slug="beta", levels_status="resolved",
                             website="https://beta.example") | {"entries": [
        entry(beta_url, base=60000, **madrid), entry(beta_url, base=64000, **madrid),
        entry(beta_url, base=99000, region="CT", city="Barcelona")]}
    with temp_data(acme(*acme_rows, website="https://acme.example"), beta):
        _, files = site_build.build_site(lib.load_companies())
    place = files["all~MD"]
    check("Acme, all in Madrid, is whole", place["whole"], [0])
    check("Beta keeps its own Madrid row", [r[:3] for r in place["cells"]["|"]], [[1, 2, 62000]])
    check("Madrid the city is Madrid the region, so it has no file", "all~MD-madrid" in files, False)
    check("and the menu points it at the region's",
          [r["cities"] for r in files[""]["places"] if r["code"] == "MD"],
          [[["MD-madrid", "Madrid", 5, "MD"]]])
    check("regions by salaries", [r["code"] for r in files[""]["places"]], ["MD", "CT"])


def test_job_boards_follow_the_ranking() -> None:
    """/api/v1/boards.json lists the companies with a known board in the companies.json format lib/ats reads
    companies.json format, tiered by today's engineers' median and tagged with
    their cities the way lib/ats writes tags."""
    print("boards.json tiers companies by the site's ranking")
    import importlib.util
    spec = importlib.util.spec_from_file_location("site_build", ROOT / "scripts" / "site.py")
    site_build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(site_build)
    madrid = dict(region="MD", city="Madrid")
    beta_url = "https://www.levels.fyi/companies/beta/salaries/software-engineer/locations/spain"
    beta = lib.blank_company("Beta", levels_slug="beta", levels_status="resolved",
                             website="https://beta.example") | {"entries": [
        entry(beta_url, base=99000, **madrid),
        *(entry(beta_url, base=b, region="GA", city="A Coruña") for b in (50000, 52000))]}
    gamma_url = "https://www.levels.fyi/companies/gamma/salaries/software-engineer/locations/spain"
    gamma = lib.blank_company("Gamma", levels_slug="gamma", levels_status="resolved",
                              website="https://gamma.example") | {"entries": [entry(gamma_url, **madrid)]}
    with temp_data(acme(*[entry(PER_LOCATION, base=b, **madrid) for b in (70000, 80000, 90000)],
                        website="https://acme.example"), beta, gamma):
        data, tables = site_build.build_site(lib.load_companies())
    with tempfile.TemporaryDirectory() as directory:
        original, site_build.AGGREGATES = site_build.AGGREGATES, pathlib.Path(directory)
        (site_build.AGGREGATES / "boards.json").write_text(json.dumps({
            "acme": {"ats": "greenhouse", "board": "acme"},
            "beta": {"ats": "lever", "board": "beta", "region": "eu"}}))
        try:
            boards = site_build.job_boards(data, tables)
        finally:
            site_build.AGGREGATES = original
    check("one entry per company with a board, as lib/ats reads them", boards["companies"], [
        {"name": "Acme", "ats": "greenhouse", "board": "acme", "tier": "A", "tags": ["spain", "madrid"]},
        {"name": "Beta", "ats": "lever", "board": "beta", "tier": "B",
         "tags": ["spain", "a-coruna", "madrid"], "region": "eu"}])
    check("in its list format", (boards["version"], boards["data_as_of"]), (1, data["data_as_of"]))


def test_companies_table_shows_any_data() -> None:
    """The companies table lists a company with any salary under the filters, and
    its row has a bar for every band someone reported, even one person
    (maintainer, 2026-11-01). data.json's groups keep MIN_GROUP; tests/mcp.test.mjs
    checks the MCP does too."""
    print("the companies table goes down to one person")
    import importlib.util
    spec = importlib.util.spec_from_file_location("site_build", ROOT / "scripts" / "site.py")
    site_build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(site_build)
    rows = [entry(PER_LOCATION, base=b, region="MD", city="Madrid", years_experience="8")
            for b in (70000, 75000, 82600, 90000)]
    rows.append(entry(PER_LOCATION, base=61400, region="MD", city="Madrid", years_experience="3"))
    beta_url = "https://www.levels.fyi/companies/beta/salaries/software-engineer/locations/spain"
    beta = lib.blank_company("Beta", levels_slug="beta", levels_status="resolved",
                             linkedin_url="https://www.linkedin.com/company/beta") | {
        "entries": [entry(beta_url, base=b, region="MD", city="Madrid") for b in (90000, 100000)]}
    ghost_url = "https://www.levels.fyi/companies/ghost/salaries/software-engineer/locations/spain"
    ghost = lib.blank_company("Ghost", levels_slug="ghost", levels_status="resolved") | {
        "entries": [entry(ghost_url, base=b, region="MD", city="Madrid") for b in (90000,) * 6]}
    with temp_data(acme(*rows, website="https://acme.example"), beta, ghost):
        data, files = site_build.build_site(lib.load_companies())
        import review
        review_md = review.render(lib.load_companies(), limit=1)
    check("one person's band has a rounded median, empty bands none",
          files[""]["years"][""][0], [None, [61000, 1], None, [79000, 4], None, None])
    cells = files[""]["cells"]
    # A key whose rows repeat an earlier key's holds that key (site.shared()).
    at = lambda k: cells[cells[k]] if isinstance(cells[k], str) else cells[k]
    check("the table filtered to that band lists the company with one salary",
          [r[:3] for r in at("|2-4")], [[0, 1, 61000]])
    check("a company with two salaries is listed, after one with three or more whatever the median",
          [r[:3] for r in files[""]["cells"]["|"]], [[0, 5, 75000], [1, 2, 95000]])
    check("but data.json has no group of it",
          sorted(a["c"] for v in data["company_cells"].values() for a in v if a["c"] == 1), [])
    check("a company with no LinkedIn and no website is on no table and in no group "
          "(maintainer, 2026-11-01: unverified)",
          ([c["name"] for c in data["companies"]], data["cells"]["||"]["n"]), (["Acme", "Beta"], 7))
    check("review.py lists it for the maintainer, with a count and no salary",
          ("| Ghost | [ghost](https://www.levels.fyi/companies/ghost/salaries) | 6 | software-engineer |"
           in review_md, "90" in review_md, "Acme" in review_md), (True, False, False))


def test_site_dates_and_minimum_base() -> None:
    """The page's date is when the salaries were read, and a base under the minimum wage
    is no salary: once it held a company's median down and moved small groups."""
    print("site dates and the minimum base")
    import importlib.util
    spec = importlib.util.spec_from_file_location("site_build", ROOT / "scripts" / "site.py")
    site_build = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(site_build)
    rows = [entry(PER_LOCATION, base=b, region="MD", city="Madrid", date=d, reported=r)
            for b, d, r in ((52000, "2026-09-01", "2021-03"), (61000, "2026-09-01", "2024-05"),
                            (70000, "2026-10-17", "2025-01"), (82000, "2026-10-17", "2026-02"),
                            (90000, "2026-10-17", "2026-10"))]
    rows.append(entry(PER_LOCATION, base=1000, region="MD", city="Madrid", date="2026-10-18"))
    with temp_data(acme(*rows, website="https://acme.example")):
        data = site_build.build_data(lib.load_companies())
    check("the 1,000 EUR base is left out", data["cells"]["||"]["n"], 5)
    check("the date is the latest read of a counted salary", data["data_as_of"], "2026-10-17")
    check("reported months: first, last and median",
          data["reported"], {"from": "2021-03", "to": "2026-10", "median": "2025-01"})
    check("llms.txt says when", "reported from 2021-03 to 2026-10" in site_build.llms_txt(data), True)


def test_aggregates_ignore_the_hash_seed() -> None:
    """A refresh of the same salaries writes the same data/: once the per-role tables
    came out in PYTHONHASHSEED order and every weekly run committed a diff of nothing."""
    print("data/ is the same whatever the hash seed")
    rows = [entry(PER_LOCATION, base=60000 + 1000 * i, region="MD", city="Madrid",
                  specialization=spec) for spec in ("backend", "frontend") for i in range(6)]
    script = ("import importlib.util, json, sys; sys.path.insert(0, 'scripts'); import lib; "
              "spec = importlib.util.spec_from_file_location('site_build', 'scripts/site.py'); "
              "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); "
              "data, tables = m.build_site(lib.load_companies()); "
              "print(json.dumps([list(data['cells']), list(tables)]))")
    with temp_data(acme(*rows, website="https://acme.example")):
        runs = {subprocess.run([sys.executable, "-c", script], cwd=ROOT, capture_output=True, text=True,
                               env={**os.environ, "STC_DATA": str(lib.DATA), "PYTHONHASHSEED": seed},
                               check=True).stdout
                for seed in ("1", "2", "3", "4")}
    check("four seeds, one order of cells and tables", len(runs), 1)


def main() -> int:
    for test in (test_aggregates_ignore_the_hash_seed, test_location_guard, test_unscoped_classifier,
                 test_purge_runs_even_when_spain_data_exists,
                 test_figures_are_converted_to_euros,
                 test_every_year_is_kept,
                 test_one_submission_is_one_entry,
                 test_the_world_vouches_for_a_company,
                 test_foreign_rows_are_skipped,
                 test_feed_is_read_to_the_end,
                 test_a_role_past_the_ceiling_is_read_per_company,
                 test_an_unread_feed_changes_nothing,
                 test_companies_are_their_salaries,
                 test_rows_compare_with_empty_cells,
                 test_median_over_every_engineer,
                 test_agents_see_only_groups_of_five,
                 test_companies_table_shows_any_data,
                 test_location_files_list_companies_all_there,
                 test_job_boards_follow_the_ranking,
                 test_site_dates_and_minimum_base,
                 test_floor_aliases_and_exclusions,
                 test_normalization,
                 test_radar_enrichment):
        test()
    if failures:
        print(f"\n{len(failures)} failed: {', '.join(failures)}")
        return 1
    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
