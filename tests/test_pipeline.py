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
import pathlib
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
    check("a dollar submission goes through the page's rate",
          by_slug["acme"]["entries"][0]["base"], 90300)
    check("and is marked as paid in dollars",
          by_slug["acme"]["entries"][0]["currency"], "USD")

    by_slug, skipped = fed([row(base=105000, baseSalaryCurrency="USD", exchangeRate=1)],
                           rate=None)
    check("a dollar submission with no euro rate is dropped, not guessed",
          (by_slug, skipped["not-euro"]), ({}, 1))


def test_every_year_is_kept_the_readme_filters() -> None:
    """The file keeps every seniority now; the README still counts seniors.

    Seniority is five or more years, whatever the level says: on 2026-09-15
    the list briefly counted only rungs named senior, which threw away an L4
    with eight years at 90k and would have kept a "Senior" with two. Pay never
    decided who is a row either - until 2026-09-22 only seniors at 60k+ were
    kept, so two 90k engineers made Minsait read 90k while fourteen under 60k
    went unrecorded. Since 2026-10-14 the same is true for juniors and other
    roles: all kept for the website, none reaching the README's median.
    """
    print("fetch_spain keeps every year of experience; readme_entries filters")

    by_slug, skipped = fed([row(years=8, level="SDE I"),
                            row(years=4, level="Senior Software Engineer"),
                            row(years="5-10", level=None),
                            row(years="2-4"),
                            row(years=None, uuid="no-years")])
    entries = by_slug["acme"]["entries"]
    check("every parseable year becomes a row, 'False' levels do not",
          sorted(e["years_experience"] for e in entries), ["2-4", "4", "5-10", "8"])
    check("a row with no years is skipped", skipped["no-years"], 1)
    check("the README counts only the seniors",
          len(lib.readme_entries(acme(*entries))), 2)
    check("a bucket counts from its low end", lib.years("5-10"), 5)
    check("an open bucket counts from its number", lib.years("11+"), 11)

    import validate
    for label, row_, bad in (
        ("under five years is data now", entry(PER_LOCATION, years_experience="4"), False),
        ("no years", entry(PER_LOCATION, years_experience=None), True),
        ("a first-hand senior SWE under 60k", entry(None, source="community", base=55000), True),
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
        pages = [json.dumps({"rows": [{"uuid": "x"}] * 50})] * fetch_spain.MAX_PAGES
        check("a feed that never empties is incomplete, not complete",
              fetch_spain.feed("token", "software-engineer", 0), None)
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
    """On file means having salaries; the README's bar is about the median.

    Until 2026-10-14 a company under the 50k floor was deleted. Now the file
    keeps every role and seniority for the website, so low-median data stays
    on file - it just does not reach the README. What still disappears is a
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


def test_median_and_share_over_every_senior() -> None:
    """The statistic is the median over every senior, and the share at 60k+.

    Two of Minsait's sixteen seniors are at 90k. The mean of those two, which
    the table showed until 2026-09-22, said Minsait pays 90k; the median over
    all sixteen says 43.5k, and the share says 60k+ happens to 12% of them.
    "Use all the data" was the criticism, and the maintainer took it, keeping
    the 60k bar for which companies are listed and for the share only.
    """
    print("the README shows the median over every senior and the share at 60k+")
    import build

    company = acme(entry(PER_LOCATION, base=90000, total=95000), entry(PER_LOCATION, base=90000),
                   *[entry(PER_LOCATION, base=40000 + 1000 * i) for i in range(6)])
    found = build.summary(company)
    check("median over all seniors, not the mean of the 60k+ ones",
          (found["base"], found["engineers"], found["at_bar"]), (43500, 8, 2))
    check("the share is at 60k+ over all seniors", build.share_cell(found), "25% (2)")
    check("total has its own median", found["total"], 95000)
    check("a share under 1% is not 0%",
          build.share_cell({"share": 1 / 250, "at_bar": 1}), "<1% (1)")

    with_junior_and_pm = acme(
        entry(PER_LOCATION, base=90000), entry(PER_LOCATION, base=41000),
        entry(PER_LOCATION, base=30000, years_experience="2"),
        entry(DS_LOCATION, role="data-scientist", base=200000))
    found = build.summary(with_junior_and_pm)
    check("juniors and other roles never reach the README's median",
          (found["base"], found["engineers"]), (65500, 2))

    def named(name: str, *entries: dict) -> dict:
        return lib.blank_company(name) | {"entries": list(entries)}
    table = build.render_companies([
        named("Rare High", entry(PER_LOCATION, base=120000), entry(PER_LOCATION, base=40000)),
        named("Everyone", entry(PER_LOCATION, base=70000)),
        named("Everyone Paid More", entry(PER_LOCATION, base=90000)),
        named("Vouched", entry(None, source="community", base=65000)),
        named("Only Juniors", entry(PER_LOCATION, base=30000, years_experience="2")),
        named("Only PMs", entry(DS_LOCATION, role="data-scientist", base=200000)),
    ])
    check("rows sort by median, then share, first-hand first",
          [line.split(" | ")[0].lstrip("| ") for line in table.splitlines()[4:]],
          ["Vouched", "Everyone Paid More", "Rare High", "Everyone"])
    check("companies without senior software engineers are not in the README",
          "Only Juniors" in table or "Only PMs" in table, False)


def test_floor_aliases_and_exclusions() -> None:
    """The maintainer's hand on the data, 2026-09-23.

    "I don't wanna lose all those companies": a median between 50k and 60k is
    kept and shown under "Need to improve". "Timescale and Tiger Data are the
    same": an alias slug's rows are filed under the canonical company, each
    row keeping the page it came from. "Remove Abracadabra as we don't know
    what company it is": a struck-off slug is never written or created.
    """
    print("floor, alias slugs and struck-off slugs")
    import build
    import fetch_spain
    import validate

    def named(name: str, *entries: dict, **fields) -> dict:
        return lib.blank_company(name, **fields) | {"entries": list(entries)}
    table = build.render_companies([
        named("At Bar", entry(PER_LOCATION, base=70000)),
        named("Nearly", entry(PER_LOCATION, base=55000), entry(PER_LOCATION, base=58000)),
    ])
    rows = [line.split(" | ")[0].lstrip("| ") for line in table.splitlines()
            if line.startswith("| ") and not line.startswith(("| Company", "| ---"))]
    check("a median under 60k lands in the second table", rows, ["At Bar", "Nearly"])
    check("and the first table ends before it",
          table.index("At Bar") < table.index("## Need to improve") < table.index("Nearly"), True)
    check("the second table says what it is", "## Need to improve: median between 50k and 60k" in table, True)
    check("under the floor is not on the README",
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


def main() -> int:
    for test in (test_location_guard, test_unscoped_classifier,
                 test_purge_runs_even_when_spain_data_exists,
                 test_figures_are_converted_to_euros,
                 test_every_year_is_kept_the_readme_filters,
                 test_one_submission_is_one_entry,
                 test_foreign_rows_are_skipped,
                 test_feed_is_read_to_the_end,
                 test_an_unread_feed_changes_nothing,
                 test_companies_are_their_salaries,
                 test_median_and_share_over_every_senior,
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
