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
import pathlib
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))

import lib  # noqa: E402

UNSCOPED = "https://www.levels.fyi/companies/adyen/salaries"
PER_LOCATION = ("https://www.levels.fyi/companies/adyen/salaries"
                "/software-engineer/locations/spain")
COUNTRY = "https://www.levels.fyi/t/software-engineer/locations/spain"
OTHER_FAMILY = "https://www.levels.fyi/companies/bcg/salaries/data-scientist/locations/spain"

failures: list[str] = []


def check(label: str, got, want) -> None:
    if got == want:
        print(f"  pass  {label}")
    else:
        print(f"  FAIL  {label}\n          got  {got!r}\n          want {want!r}")
        failures.append(label)


def entry(url: str | None, notes: str = "", source: str = "levels.fyi", **fields) -> dict:
    return {"base": 80000, "years_experience": "8", "notes": notes, "source": source,
            "source_url": url, "date": "2026-08-31", **fields}


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


def test_location_guard() -> None:
    """An entry must cite a URL that names a location, or validate.py fails.

    It also has to be a company's software-engineer page: the country pages
    publish one median pooled across everyone, and another family's page is
    another job.
    """
    print("validate.py rejects data that cannot prove it is a Spanish engineer's")
    import validate

    for label, url, message in (
        ("unscoped company page is rejected", UNSCOPED, "not Spain-scoped"),
        ("country job-family page is rejected", COUNTRY, "cannot hold one engineer"),
        ("another job family is rejected", OTHER_FAMILY, "cannot hold one engineer"),
    ):
        validate.errors.clear()
        validate.check_entry("test", entry(url))
        check(label, any(message in e for e in validate.errors), True)

    for label, found in (
        ("per-location software-engineer page is accepted", entry(PER_LOCATION)),
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
    print("fetch_spain.write() drops foreign entries beside a Spanish one")
    import fetch_spain

    with temp_data(acme(entry(UNSCOPED, "reports this as 'L3'."),
                        entry(UNSCOPED, "Common Range Average across all levels."))):
        fetch_spain.write("acme", [entry(PER_LOCATION)], "Acme", "2026-09-02",
                          served="Spain (ladder)")
        check("only the Spanish entry survives",
              [e["source_url"] for e in stored()["entries"]], [PER_LOCATION])

    with temp_data(acme(entry(None, source="community"))):
        fetch_spain.write("acme", [], "Acme", "2026-09-02", served="no data")
        check("a first-hand entry is left alone",
              [e["source"] for e in stored()["entries"]], ["community"])


def props(**overrides) -> dict:
    """A Levels.fyi /locations/spain page, trimmed to what the fetcher reads."""
    page = {
        "locationCurrency": "EUR",
        "locationExchangeRate": 0.86,
        "percentiles": {"base_salary": {"p25": 0, "p50": 0, "p75": 0},
                        "tc": {"p25": 0, "p50": 0, "p75": 0}},
        "median": None,
        "averages": [],
        "company": {},
    }
    page.update(overrides)
    return page


def sample(base: float, years, level: str = "L4", where: str = "Madrid, MD, Spain",
           uuid: str | None = None, **extra) -> dict:
    return {"uuid": uuid or f"{base}-{years}-{where}", "level": level, "location": where,
            "yearsOfExperience": years, "baseSalary": base, "totalCompensation": base,
            "offerDate": "2026-06-30T21:59:59.999+00:00", **extra}


def ladder(*samples: dict) -> dict:
    return props(averages=[{"primaryLevelName": "L4", "count": len(samples),
                            "samples": list(samples)}])


def read(page: dict, slug: str = "acme", rows: list[dict] | None = None) -> list[dict]:
    import fetch_spain
    with contextlib.redirect_stderr(io.StringIO()):
        _, parsed, _ = fetch_spain.interpret(page, slug, PER_LOCATION, rows)
    return fetch_spain.entries(parsed, "2026-09-15")


def label(page: dict, rows: list[dict] | None = None) -> str:
    import fetch_spain
    with contextlib.redirect_stderr(io.StringIO()):
        return fetch_spain.interpret(page, "acme", PER_LOCATION, rows)[0]


def test_figures_are_converted_to_euros() -> None:
    """The payload is USD. Writing it as euros overstated 141 bands.

    Levels.fyi stores every figure in USD and multiplies by
    locationExchangeRate to print euros - its own FAQ text on Glovo's Spanish
    page says the median total of 79710.65 is EUR 68.551. This script wrote the
    raw number as euros, so every figure it produced was about 16% high.

    The median record's own exchangeRate converts to the currency its author was
    paid in, which is not always euros. Smile.io's was 105.000 USD at a rate of 1,
    and it went on the list as 105.000 EUR.
    """
    print("fetch_spain converts USD to EUR")
    import fetch_spain

    check("Glovo's published euro figure", fetch_spain.eur(79710.65, 0.86), 68551)

    [found] = read(ladder(sample(100000, 8)))
    check("a sample goes through the page's rate", found["base"], 86000)

    # A euro submission round-trips to the figure its author typed: exactly
    # 70.000 EUR at its own rate, not 70.211 at the page's.
    [found] = read(props(median=sample(81641.1, 6, baseSalaryCurrency="EUR",
                                       exchangeRate=0.857413)))
    check("a euro submission uses its own rate", found["base"], 70000)

    [found] = read(props(median=sample(105000, 8, baseSalaryCurrency="USD", exchangeRate=1)))
    check("a dollar submission goes through the page's rate", found["base"], 90300)


def test_seniority_is_years_not_titles() -> None:
    """Five years of experience makes an engineer senior, whatever the level says.

    On 2026-09-15 the list briefly counted only rungs and submissions whose names
    said senior. That threw away an L4 with eight years at 90k and would have
    kept a "Senior" with two, and the maintainer ruled it out the same day:
    seniority is five or more years, and the level name does not matter.

    Pay does not decide who is a row either. Until 2026-09-22 only seniors at
    60k+ were kept and averaged, so two 90k engineers made Minsait read 90k
    while fourteen seniors under 60k went unrecorded; the median now needs
    every one of them. A first-hand row is different: it vouches for 60k+.
    """
    print("fetch_spain keeps every engineer with 5+ years, whatever the pay")

    found = read(ladder(
        sample(100000, 8, level="SDE I"),
        sample(100000, 4, level="Senior Software Engineer"),
        sample(100000, "5-10", level=None),
        sample(100000, "2-4"),
        sample(50000, 12),
    ))
    check("years decide, level names and pay do not",
          sorted((e["years_experience"], e["base"], e["level"]) for e in found),
          [("12", 43000, "L4"), ("5-10", 86000, None), ("8", 86000, "SDE I")])
    check("a bucket counts from its low end", lib.years("5-10"), 5)
    check("an open bucket counts from its number", lib.years("11+"), 11)

    import validate
    for label, row, bad in (
        ("under five years", entry(PER_LOCATION, years_experience="4"), True),
        ("no years", entry(PER_LOCATION, years_experience=None), True),
        ("a first-hand entry under 60k", entry(None, source="community", base=55000), True),
        ("a Levels.fyi entry under 60k", entry(PER_LOCATION, base=55000), False),
    ):
        validate.errors.clear()
        validate.check_entry("test", row)
        check(f"validate.py {'rejects' if bad else 'keeps'} {label}", bool(validate.errors), bad)


def test_one_submission_is_one_entry() -> None:
    """The median record is usually one of the ladder's samples too.

    Read naively, Amazon's median would be listed twice, once at the page's rate
    and once at its own.
    """
    print("fetch_spain lists a submission once")

    shared = sample(81641.1, 6, uuid="same", baseSalaryCurrency="EUR", exchangeRate=0.857413)
    found = read(props(median=shared, averages=[{"samples": [dict(shared)]}]))
    check("one entry, at the submission's own rate", [e["base"] for e in found], [70000])


def test_foreign_samples_are_skipped() -> None:
    """The page is location-scoped, but every submission is checked anyway.

    This is the same guard that has had to be enforced twice elsewhere: a Berlin
    submission on a Spanish page is still a German salary.
    """
    print("fetch_spain skips a submission from outside Spain")

    found = read(ladder(sample(100000, 8, where="Berlin, BE, Germany"),
                        sample(90000, 7)))
    check("only the Spanish submission survives", [e["city"] for e in found], ["Madrid"])


def test_signed_in_table_is_read() -> None:
    """The public page hides most submissions; the signed-in table has them all.

    Fever's Spain page embedded one record (L3, 6 years, 48.7k) and the README
    said "none with 5+ years at 60k+". Its table, which the browser only loads
    with a session token, held 29 Spanish engineers, ten of them qualifying. The
    fetcher had never asked for it.
    """
    print("fetch_spain reads the signed-in table beside the page")
    import fetch_spain

    median = sample(56172.21, 6, level="L3", uuid="median", baseSalaryCurrency="EUR",
                    exchangeRate=0.85452)
    rows = [
        dict(median),
        sample(104584.28, 20, level="Staff", uuid="staff", baseSalaryCurrency="EUR",
               exchangeRate=0.86055),
        # The API sends the string "False" where the author left the level blank.
        sample(79835.77, "5-10", level="False", uuid="ml", baseSalaryCurrency="EUR",
               exchangeRate=0.8768),
        sample(120000, 10, level="L6", uuid="abroad", where="Lisbon, Portugal"),
    ]
    page = props(median=median, percentiles={"locationName": "Spain", "count": 14})

    found = read(page, rows=rows)
    check("table rows become entries, at their own rate, once each, Spain only",
          sorted((e["base"], e["years_experience"], e["level"]) for e in found),
          [(48000, "6", "L3"), (70000, "5-10", None), (90000, "20", "Staff")])
    check("a table read is labelled as the complete answer", label(page, rows), "Spain (table)")
    check("without the table the label stays partial", label(page), "Spain (aggregate)")
    check("an empty table does not claim completeness", label(page, []), "Spain (aggregate)")

    # The API wraps its answer the way the site's own JavaScript unwraps it.
    import base64, hashlib, json, subprocess, zlib
    key = base64.b64encode(hashlib.md5(b"levelstothemoon!!").digest())[:16]
    body = zlib.compress(json.dumps({"total": 1, "rows": [{"uuid": "x"}]}).encode())
    sealed = subprocess.run(["openssl", "enc", "-aes-128-ecb", "-K", key.hex()],
                            input=body, capture_output=True, check=True).stdout
    check("an encrypted answer is decoded", fetch_spain.decrypt(base64.b64encode(sealed).decode()),
          {"total": 1, "rows": [{"uuid": "x"}]})

    # A table that failed to load must not hand the company back to the page's
    # subset: write() would then replace last run's table entries with it.
    html = ('<script id="__NEXT_DATA__" type="application/json">'
            + json.dumps({"props": {"pageProps": page}}) + "</script>")
    original = fetch_spain.get, fetch_spain.table
    fetch_spain.get = lambda url, delay, attempts=3, headers=None: html
    fetch_spain.table = lambda bearer, delay, slug=None: None
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            served, parsed, _ = fetch_spain.spain_data("acme", 0, "token")
        check("an unread table makes the company unread", (served, parsed),
              ("table unreadable", None))
        fetch_spain.table = lambda bearer, delay, slug=None: rows
        with contextlib.redirect_stderr(io.StringIO()):
            served, parsed, _ = fetch_spain.spain_data("acme", 0, "token")
        check("a read table is merged with the page", (served, len(parsed["records"])),
              ("Spain (table)", 3))
        # Levels.fyi 404s the page of an employer with a submission or two. The
        # table still has them, and its rows carry their own euro rate, so a
        # dollar row is the only thing the missing page rate costs.
        fetch_spain.get = lambda url, delay, attempts=3, headers=None: (
            None if "levels.fyi/companies/" in url else "{}")
        fetch_spain.table = lambda bearer, delay, slug=None: rows + [
            sample(100000, 8, uuid="usd", baseSalaryCurrency="USD", exchangeRate=1)]
        with contextlib.redirect_stderr(io.StringIO()):
            served, parsed, _ = fetch_spain.spain_data("acme", 0, "token")
        check("no page but a table is still read",
              (served, sorted(e["base"] for e in fetch_spain.entries(parsed, "2026-09-21"))),
              ("Spain (table)", [48000, 70000, 90000]))
        fetch_spain.table = lambda bearer, delay, slug=None: []
        with contextlib.redirect_stderr(io.StringIO()):
            check("no page and an empty table is unreachable",
                  fetch_spain.spain_data("acme", 0, "token")[:2], ("unreachable", None))
        fetch_spain.get = lambda url, delay, attempts=3, headers=None: html
        # The country-wide feed names employers nobody has added by hand. A
        # few of its rows carry False for the company; they name nothing.
        feed = [dict(r, companySlug="acme", company="Acme") for r in rows[:2]] + [
            dict(rows[2], companySlug="newco", company="NewCo"),
            dict(rows[3], companySlug=False, company=False)]
        fetch_spain.table = lambda bearer, delay, slug=None: feed
        check("discovery lists only employers not on file",
              fetch_spain.discover("token", 0, {"acme"}), [("newco", "NewCo")])
    finally:
        fetch_spain.get, fetch_spain.table = original


def test_an_unread_page_changes_nothing() -> None:
    """A page that failed to load is not a page with no entries.

    write() used to replace the company's Levels.fyi figures with whatever the
    run found, and an unreachable page found nothing, so one network error was
    enough to empty a company.
    """
    print("fetch_spain.write() leaves a company alone when its page was not read")
    import fetch_spain

    with temp_data(acme(entry(PER_LOCATION))):
        outcome = fetch_spain.write("acme", [], "Acme", "2026-09-15", served=None)
        check("nothing is written", outcome, "skipped")
        check("the entry is still there",
              [e["source_url"] for e in stored()["entries"]], [PER_LOCATION])


def test_a_company_with_its_median_under_the_bar_is_not_listed() -> None:
    """A company is on the list only while its seniors' median base is 60k+.

    Until 2026-09-21 a company Levels.fyi had nothing Spanish for kept a row
    reading "no Spain data", and 112 of them sat under the table. The
    maintainer's rule: get rid of the companies that don't have Spanish data and
    that nobody has vouched for. For a day the rule was then "at least one
    senior at 60k+", which listed BBVA at a median of 55k; a reader pointed out
    that the company filter has to be on the aggregate, and on 2026-09-22 it
    became the median. So the fetcher removes a company whose median comes back
    under the bar, keeps one a first-hand entry vouches for, and validate.py
    refuses lasting rows with a median under it.
    """
    print("a company whose median is under 60k is removed, not listed")
    import fetch_spain
    import validate

    with temp_data(acme(entry(PER_LOCATION))):
        outcome = fetch_spain.write("acme", [], "Acme", "2026-09-21", served="Spain (table)")
        check("a company that comes back empty is removed", (outcome, stored()), ("removed", None))

    with temp_data(acme(entry(PER_LOCATION))):
        outcome = fetch_spain.write("acme", [entry(PER_LOCATION, base=45000)], "Acme", "2026-09-21",
                                    served="Spain (table)")
        check("so is one whose seniors are all under 60k", (outcome, stored()), ("removed", None))

    with temp_data(acme(entry(PER_LOCATION))):
        outcome = fetch_spain.write("acme", [entry(PER_LOCATION, base=45000), entry(PER_LOCATION, base=45000),
                                             entry(PER_LOCATION, base=120000)], "Acme", "2026-09-21",
                                    served="Spain (table)")
        check("and one with a well-paid senior but a median under 60k",
              (outcome, stored()), ("removed", None))

    with temp_data(acme(entry(None, source="community"))):
        outcome = fetch_spain.write("acme", [], "Acme", "2026-09-21", served="no data")
        check("a first-hand entry keeps it", (outcome, len(stored()["entries"])), ("skipped", 1))

    with temp_data():
        outcome = fetch_spain.write("acme", [], "Acme", "2026-09-21", served="United States")
        check("a new company with nothing is never added", (outcome, stored()), ("not listed", None))
        # An unread table used to create the company anyway, from the LinkedIn
        # handle the page had given: two empty rows, removed on the next run.
        outcome = fetch_spain.write("acme", [], "Acme", "2026-09-21",
                                    record={"linkedin": "company/acme"}, served=None)
        check("not even from a LinkedIn handle", (outcome, stored()), ("not listed", None))

    for label, company, refused in (
        ("an empty row", acme(), True),
        ("rows all under 60k", acme(entry(PER_LOCATION, base=45000)), True),
        ("one row at 60k+ among three", acme(entry(PER_LOCATION, base=45000),
                                             entry(PER_LOCATION, base=46000), entry(PER_LOCATION)), True),
        ("a median at 60k+", acme(entry(PER_LOCATION, base=45000), entry(PER_LOCATION)), False),
    ):
        validate.errors.clear()
        validate.check_company("acme", company)
        check(f"validate.py refuses {label}", any("not on the list" in e for e in validate.errors),
              refused)


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

    def named(name: str, *entries: dict) -> dict:
        return lib.blank_company(name) | {"entries": list(entries)}
    table = build.render_companies([
        named("Rare High", entry(PER_LOCATION, base=120000), entry(PER_LOCATION, base=40000)),
        named("Everyone", entry(PER_LOCATION, base=70000)),
        named("Everyone Paid More", entry(PER_LOCATION, base=90000)),
        named("Vouched", entry(None, source="community", base=65000)),
    ])
    check("rows sort by share, then median, first-hand first",
          [line.split(" | ")[0].lstrip("| ") for line in table.splitlines()[4:]],
          ["Vouched", "Everyone Paid More", "Everyone", "Rare High"])


def test_floor_aliases_and_exclusions() -> None:
    """The maintainer's hand on the data, 2026-09-23.

    "I don't wanna lose all those companies": a median between 50k and 60k is
    kept and shown under "Need to improve", below 50k is gone. "Timescale and
    Tiger Data are the same": an alias slug is read into the canonical company,
    each row keeping the page it came from. "Remove Abracadabra as we don't know
    what company it is": a struck-off slug is never written or discovered.
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
    check("under the floor is not listed", lib.listed(named("Low", entry(PER_LOCATION, base=49000))), False)
    check("at the floor is listed but not competitive",
          (lib.listed(named("Mid", entry(PER_LOCATION, base=55000))),
           lib.competitive(named("Mid", entry(PER_LOCATION, base=55000)))), (True, False))

    with temp_data(acme(entry(PER_LOCATION))):
        outcome = fetch_spain.write("acme", [entry(PER_LOCATION, base=55000)], "Acme", "2026-09-23",
                                    served="Spain (table)")
        check("a median of 55k stays on file", (outcome, [e["base"] for e in stored()["entries"]]),
              ("updated", [55000]))
        outcome = fetch_spain.write("acme", [entry(PER_LOCATION, base=45000)], "Acme", "2026-09-23",
                                    served="Spain (table)")
        check("a median of 45k is removed", (outcome, stored()), ("removed", None))

    # An alias is read with the canonical slug and filed under it.
    original = fetch_spain.read_slug
    pages = {
        "timescale": ("Spain (table)", {"rate": 0.86, "url": PER_LOCATION.replace("adyen", "timescale"),
                                        "records": [sample(120000, 8, uuid="a")]}, {}),
        "tiger-data": ("Spain (table)", {"rate": 0.86, "url": PER_LOCATION.replace("adyen", "tiger-data"),
                                         "records": [sample(120000, 8, uuid="a"), sample(150000, 9, uuid="b")]}, {}),
    }
    fetch_spain.read_slug = lambda slug, delay, bearer=None: pages[slug]
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            _, page, _ = fetch_spain.spain_data("timescale", 0, "token")
        found = fetch_spain.entries(page, "2026-09-23")
        check("alias rows join the canonical company, once each, with their own page",
              sorted((e["base"], e["source_url"].split("/companies/")[1].split("/")[0]) for e in found),
              [(103200, "timescale"), (129000, "tiger-data")])
        fetch_spain.read_slug = lambda slug, delay, bearer=None: (
            pages[slug] if slug == "timescale" else ("table unreadable", None, {}))
        with contextlib.redirect_stderr(io.StringIO()):
            check("an alias whose table failed makes the company unread",
                  fetch_spain.spain_data("timescale", 0, "token")[:2], ("table unreadable", None))
    finally:
        fetch_spain.read_slug = original

    with temp_data():
        check("a struck-off slug is never written",
              (fetch_spain.write("abracadabra", [entry(PER_LOCATION)], "Abracadabra", "2026-09-23",
                                 served="Spain (table)"), stored("abracadabra")), ("excluded", None))
    original = fetch_spain.table
    fetch_spain.table = lambda bearer, delay, slug=None: [
        dict(sample(1, 1), companySlug="tiger-data", company="Tiger Data"),
        dict(sample(1, 1), companySlug="abracadabra", company="Abracadabra"),
        dict(sample(1, 1), companySlug="newco", company="NewCo")]
    try:
        check("discovery skips aliases and struck-off slugs",
              fetch_spain.discover("token", 0, set()), [("newco", "NewCo")])
    finally:
        fetch_spain.table = original

    for label, company, message in (
        ("an alias slug's own row group", named("Tiger", entry(PER_LOCATION), levels_slug="tiger-data"),
         "is an alias of"),
        ("a struck-off slug", named("Abracadabra", entry(PER_LOCATION), levels_slug="abracadabra"),
         "struck off"),
    ):
        validate.errors.clear()
        validate.check_company("test", company)
        check(f"validate.py refuses {label}", any(message in e for e in validate.errors), True)


def main() -> int:
    for test in (test_location_guard, test_unscoped_classifier,
                 test_purge_runs_even_when_spain_data_exists,
                 test_figures_are_converted_to_euros,
                 test_seniority_is_years_not_titles,
                 test_one_submission_is_one_entry,
                 test_foreign_samples_are_skipped,
                 test_signed_in_table_is_read,
                 test_an_unread_page_changes_nothing,
                 test_a_company_with_its_median_under_the_bar_is_not_listed,
                 test_median_and_share_over_every_senior, test_floor_aliases_and_exclusions):
        test()
    if failures:
        print(f"\n{len(failures)} failed: {', '.join(failures)}")
        return 1
    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
