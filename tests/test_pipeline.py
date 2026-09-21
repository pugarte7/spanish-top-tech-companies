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
    """
    print("fetch_spain keeps 5+ years at 60k+, and nothing else")

    found = read(ladder(
        sample(100000, 8, level="SDE I"),
        sample(100000, 4, level="Senior Software Engineer"),
        sample(100000, "5-10", level=None),
        sample(100000, "2-4"),
        sample(69766, 12),
        sample(69768, 12),
    ))
    check("years decide, level names do not",
          sorted((e["years_experience"], e["base"], e["level"]) for e in found),
          [("12", 60000, "L4"), ("5-10", 86000, None), ("8", 86000, "SDE I")])
    check("a bucket counts from its low end", lib.years("5-10"), 5)
    check("an open bucket counts from its number", lib.years("11+"), 11)

    import validate
    for label, bad in (("under 60k", entry(PER_LOCATION, base=59999)),
                       ("under five years", entry(PER_LOCATION, years_experience="4")),
                       ("no years", entry(PER_LOCATION, years_experience=None))):
        validate.errors.clear()
        validate.check_entry("test", bad)
        check(f"validate.py rejects an entry {label}", bool(validate.errors), True)


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
          [(70000, "5-10", None), (90000, "20", "Staff")])
    check("a table read is labelled as the complete answer", label(page, rows), "Spain (table)")
    check("without the table the label stays partial", label(page), "Spain (aggregate)")
    check("an empty table does not claim completeness", label(page, []), "Spain (aggregate)")

    import build
    for served, wording in (("Spain (table)", "none with 5+"),
                            ("Spain (aggregate)", "none published with 5+")):
        company = acme(spain_check_date="2026-09-21", spain_check_served=served)
        check(f"README words {served!r} as {wording!r}",
              wording in build.status_cell(company), True)

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
    fetch_spain.table = lambda slug, bearer, delay: None
    try:
        with contextlib.redirect_stderr(io.StringIO()):
            served, parsed, _ = fetch_spain.spain_data("acme", 0, "token")
        check("an unread table makes the company unread", (served, parsed),
              ("table unreadable", None))
        fetch_spain.table = lambda slug, bearer, delay: rows
        with contextlib.redirect_stderr(io.StringIO()):
            served, parsed, _ = fetch_spain.spain_data("acme", 0, "token")
        check("a read table is merged with the page", (served, len(parsed["records"])),
              ("Spain (table)", 3))
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


def test_a_checked_company_says_so() -> None:
    """A blank row must distinguish "asked, nothing there" from "nobody looked".

    The front page reads the spain_check columns for that, so the fetcher has
    to write a row even when nothing qualifies, and has to clear it the day an
    entry turns up.
    """
    print("fetch_spain records that Levels.fyi was asked and had nothing")
    import fetch_spain

    def recorded(company: dict) -> tuple:
        return company["spain_check_date"], company["spain_check_served"]

    company = lib.blank_company("Acme")
    fetch_spain.note_check(company, False, "Spain (ladder)", "2026-09-15")
    check("a miss is recorded with what the page had", recorded(company),
          ("2026-09-15", "Spain (ladder)"))
    fetch_spain.note_check(company, True, "Spain (ladder)", "2026-09-16")
    check("a hit clears it", recorded(company), (None, None))

    with temp_data():
        fetch_spain.write("acme", [], "Acme", "2026-09-15", served="United States")
        written = stored()
        check("a company with nothing qualifying still gets a row",
              written and recorded(written), ("2026-09-15", "United States"))


def test_a_file_cannot_claim_both() -> None:
    """`spain_check` and a Levels.fyi entry contradict each other."""
    print("validate.py rejects a spain_check the entries disprove")
    import validate

    for label, entries, contradicted in (
        ("a Levels.fyi entry contradicts it", [entry(PER_LOCATION)], True),
        ("a first-hand entry does not", [entry(None, source="community")], False),
        ("no entry does not", [], False),
    ):
        validate.errors.clear()
        validate.check_spain_check("acme", acme(*entries, spain_check_date="2026-09-10",
                                                spain_check_served="no data"))
        check(label, any("levels.fyi entry is on file" in e for e in validate.errors),
              contradicted)


def main() -> int:
    for test in (test_location_guard, test_unscoped_classifier,
                 test_purge_runs_even_when_spain_data_exists,
                 test_figures_are_converted_to_euros,
                 test_seniority_is_years_not_titles,
                 test_one_submission_is_one_entry,
                 test_foreign_samples_are_skipped,
                 test_signed_in_table_is_read,
                 test_an_unread_page_changes_nothing,
                 test_a_checked_company_says_so,
                 test_a_file_cannot_claim_both):
        test()
    if failures:
        print(f"\n{len(failures)} failed: {', '.join(failures)}")
        return 1
    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
