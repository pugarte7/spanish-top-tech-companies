#!/usr/bin/env python3
"""Regressions that have actually happened here. Run:

    python3 tests/test_pipeline.py

No test framework on purpose: CI installs requirements.txt and nothing else.

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

import yaml

import lib

UNSCOPED = "https://www.levels.fyi/companies/adyen/salaries"
PER_LOCATION = ("https://www.levels.fyi/companies/adyen/salaries"
                "/software-engineer/locations/spain")
COUNTRY = "https://www.levels.fyi/t/data-scientist/locations/spain"

failures: list[str] = []


def check(label: str, got, want) -> None:
    if got == want:
        print(f"  pass  {label}")
    else:
        print(f"  FAIL  {label}\n          got  {got!r}\n          want {want!r}")
        failures.append(label)


def band(url: str, level: str = "all", notes: str = "") -> dict:
    return {
        "level": level,
        "base": {"p50": 80000},
        "notes": notes,
        "last_verified": "2026-08-31",
        "sources": [{"name": "levels.fyi", "url": url, "date": "2026-08-31"}],
    }


@contextlib.contextmanager
def temp_companies():
    """Point the scripts at a throwaway data/companies/ for the duration."""
    original = lib.COMPANIES_DIR
    with tempfile.TemporaryDirectory() as directory:
        lib.COMPANIES_DIR = pathlib.Path(directory)
        try:
            yield lib.COMPANIES_DIR
        finally:
            lib.COMPANIES_DIR = original


def test_location_guard() -> None:
    """A band must cite a URL that names a location, or validate.py fails."""
    print("validate.py rejects data that cannot prove it is Spanish")
    import validate

    for label, url, rejected in (
        ("unscoped company page is rejected", UNSCOPED, True),
        ("per-location company page is accepted", PER_LOCATION, False),
        ("country job-family page is accepted", COUNTRY, False),
    ):
        validate.errors.clear()
        validate.check_bands("test.yml", "software-engineer", band(url))
        check(label, any("not Spain-scoped" in e for e in validate.errors), rejected)

    # Someone reporting their own salary has no Levels.fyi URL to name.
    validate.errors.clear()
    validate.check_bands("test.yml", "software-engineer", {
        "level": "senior", "base": {"p50": 78000}, "last_verified": "2026-08-31",
        "sources": [{"name": "offer-letter", "date": "2026-08-31"}],
    })
    check("first-hand source needs no location",
          any("not Spain-scoped" in e for e in validate.errors), False)


def test_unscoped_classifier() -> None:
    print("fetch_spain.unscoped() reads the URL, not the notes")
    import fetch_spain

    check("unscoped company page", fetch_spain.unscoped(band(UNSCOPED)), True)
    check("per-location page", fetch_spain.unscoped(band(PER_LOCATION)), False)
    check("country page", fetch_spain.unscoped(band(COUNTRY)), False)

    # The wording of `notes` is not evidence of anything. Matching on it is
    # what let 173 of the 205 stale bands through: the purge looked for
    # "reports this as" and these two shapes never say it.
    for notes in ("Median across all levels.",
                  "Common Range Average across all levels."):
        check(f"unscoped despite notes {notes!r}",
              fetch_spain.unscoped(band(UNSCOPED, notes=notes)), True)


def test_purge_runs_even_when_spain_data_exists() -> None:
    """The second regression, exactly.

    The purge used to run only for companies with no Spanish figure, so any
    company that did have one kept its foreign bands sitting beside it. Adyen
    kept a Dutch product-designer band next to a Spanish software-engineer one.
    """
    print("fetch_spain.write() drops foreign bands beside a Spanish one")
    import fetch_spain

    with temp_companies() as directory:
        (directory / "acme.yml").write_text(yaml.safe_dump({
            "slug": "acme", "name": "Acme",
            "compensation": {"currency": "EUR", "basis": "gross_annual", "roles": [
                {"role": "software-engineer",
                 "levels": [band(UNSCOPED, "senior", "reports this as 'L3'.")]},
                {"role": "product-designer",
                 "levels": [band(UNSCOPED, "all", "Common Range Average across all levels.")]},
            ]},
        }, sort_keys=False))

        spanish = band(PER_LOCATION, "all", "Spain only.")
        fetch_spain.write("acme", [spanish], "Acme", "2026-09-02")

        result = yaml.safe_load((directory / "acme.yml").read_text())
        urls = {r["role"]: [lvl["sources"][0]["url"] for lvl in r["levels"]]
                for r in result["compensation"]["roles"]}
        check("only the Spanish band survives", urls, {"software-engineer": [PER_LOCATION]})

    with temp_companies() as directory:
        (directory / "acme.yml").write_text(yaml.safe_dump({
            "slug": "acme", "name": "Acme",
            "compensation": {"currency": "EUR", "basis": "gross_annual", "roles": [
                {"role": "data-scientist", "levels": [band(COUNTRY, "all", "Spain.")]},
            ]},
        }, sort_keys=False))

        fetch_spain.write("acme", [], "Acme", "2026-09-02")
        result = yaml.safe_load((directory / "acme.yml").read_text())
        kept = [r["role"] for r in result["compensation"]["roles"]]
        check("a Spain country-page band is left alone", kept, ["data-scientist"])


def test_import_skips_rows_with_no_band() -> None:
    """A name-only row used to leave a company file full of CHANGEME behind."""
    print("import_csv.py skips a row carrying no salary")
    import import_csv

    with tempfile.TemporaryDirectory() as directory:
        csv_path = pathlib.Path(directory) / "rows.csv"
        csv_path.write_text(
            "name,role,level,base_p50,source,source_date\n"
            "Real Co,software-engineer,senior,78000,community,2026-08-31\n"
            "Nameless Co,,,,job-posting,2026-08-31\n"
        )
        with temp_companies() as companies:
            with contextlib.redirect_stdout(io.StringIO()):
                import_csv.main([str(csv_path)])
            written = sorted(p.stem for p in companies.glob("*.yml"))
            check("only the row with a band creates a file", written, ["real-co"])

            # The file that does get written is a real record. CHANGEME in the
            # metadata is intended - a human fills those in - but the salary
            # has to have made it through.
            created = yaml.safe_load((companies / "real-co.yml").read_text())
            roles = created["compensation"]["roles"]
            check("the surviving row keeps its band",
                  [(r["role"], r["levels"][0]["level"], r["levels"][0]["base"]["p50"])
                   for r in roles],
                  [("software-engineer", "senior", 78000)])


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
        "generatedOccupationSchema": {"sampleSize": 429},
    }
    page.update(overrides)
    return page


def rung(level: str, titles: list[str], base: float, total: float, count: int,
         where: str = "Madrid, MD, Spain") -> dict:
    return {"level": level, "primaryLevelName": titles[0], "titles": titles,
            "base": base, "total": total, "count": count,
            "samples": [{"location": where}]}


def test_figures_are_converted_to_euros() -> None:
    """The payload is USD. Writing it into a EUR file overstated 141 bands.

    Levels.fyi stores every figure in USD and multiplies by
    locationExchangeRate to print euros - its own FAQ text on Glovo's Spanish
    page says the median total of 79710.65 is EUR 68.551. This script wrote the
    raw number under `compensation.currency: EUR`, so every figure it produced
    was about 16% high.
    """
    print("fetch_spain converts USD to EUR")
    import fetch_spain

    page = props(percentiles={
        "locationName": "Spain",
        "base_salary": {"p25": 62796.1, "p50": 73431.04, "p75": 84228.1},
        "tc": {"p25": 62796.1, "p50": 79710.65, "p75": 91621.8},
    })
    _, parsed, _ = fetch_spain.interpret(page, "glovo", PER_LOCATION)
    [aggregate] = fetch_spain.bands(parsed, "2026-09-10")
    check("aggregate base is euros", aggregate["base"]["p50"], 63151)
    check("aggregate total is euros", aggregate["total_comp"]["p50"], 68551)

    # A submission carries its own unrounded rate, and it round-trips to the
    # figure the person actually typed: exactly 55.000 EUR, not 55.099.
    page = props(median={"location": "Barcelona, CT, Spain", "level": "L2",
                         "exchangeRate": 0.85845, "baseSalary": 64068.9615,
                         "totalCompensation": 69893.4125, "yearsOfExperience": 6})
    _, parsed, _ = fetch_spain.interpret(page, "glovo", PER_LOCATION)
    [single] = fetch_spain.bands(parsed, "2026-09-10")
    check("submission uses its own rate", single["base"]["p50"], 55000)


def test_sample_size_is_not_a_spanish_count() -> None:
    """`sampleSize` is the global count when the Spanish ladder is empty.

    Amadeus serves sampleSize 429 next to an empty `averages` and a page that
    reads "Not enough data". Only the ladder counts are Spanish, so a band
    built from anything else carries no sample size at all.
    """
    print("fetch_spain ignores generatedOccupationSchema.sampleSize")
    import fetch_spain

    page = props(median={"location": "Madrid, MD, Spain", "level": "G8",
                         "baseSalary": 46638.5281, "totalCompensation": 46638.5281})
    _, parsed, _ = fetch_spain.interpret(page, "amadeus", PER_LOCATION)
    [single] = fetch_spain.bands(parsed, "2026-09-10")
    check("one submission is one data point", single.get("sample_size"), 1)

    page = props(percentiles={"locationName": "Spain",
                              "base_salary": {"p25": 1000, "p50": 2000, "p75": 3000},
                              "tc": {"p25": 1000, "p50": 2000, "p75": 3000}})
    _, parsed, _ = fetch_spain.interpret(page, "aily-labs", PER_LOCATION)
    [aggregate] = fetch_spain.bands(parsed, "2026-09-10")
    check("an aggregate with no ladder claims no count",
          aggregate.get("sample_size"), None)


def test_rung_names_decide_seniority() -> None:
    """A rung is senior when it says so, and only then.

    Amazon files its senior rung as `sde-iii` and only the third of its titles,
    "Senior SDE", names it - so every title is searched, not just the slug.
    Glovo's ladder runs L1 to L5 and says nothing, so none of it is senior:
    guessing there is how a list of Spanish salaries fills up with claims
    nobody can check.
    """
    print("fetch_spain maps rungs by name, and refuses to guess")
    import fetch_spain

    check("a third title still counts",
          fetch_spain.rung_level(rung("sde-iii", ["SDE III", "L6", "Senior SDE"],
                                      1, 1, 1))[0], "senior")
    check("manager beats senior",
          fetch_spain.rung_level(rung("sm", ["Senior Manager", "SM"],
                                      1, 1, 1))[0], "manager")
    check("principal beats senior",
          fetch_spain.rung_level(rung("l8", ["Senior Principal SDE", "L8"],
                                      1, 1, 1))[0], "principal")
    check("an opaque rung maps to nothing",
          fetch_spain.rung_level(rung("l3", ["L3", "Software Engineer III"],
                                      1, 1, 1))[0], None)

    page = props(averages=[rung("l1", ["L1"], 44025, 44025, 10),
                           rung("l3", ["L3"], 91281, 103880, 12)])
    _, parsed, _ = fetch_spain.interpret(page, "glovo", PER_LOCATION)
    bands = fetch_spain.bands(parsed, "2026-09-10")
    check("an unnamed ladder produces one pooled band",
          [b["level"] for b in bands], ["all"])
    check("pooled band counts every submission", bands[0]["sample_size"], 22)


def test_foreign_samples_drop_the_rung() -> None:
    """`averages` is location-scoped, but the samples are checked anyway.

    This is the same guard that has had to be enforced twice elsewhere: the
    count behind a rung listing a Berlin submission is not a Spanish count.
    """
    print("fetch_spain drops a ladder rung with a foreign sample")
    import fetch_spain

    page = props(averages=[
        rung("senior-software-engineer", ["Senior Software Engineer"],
             80000, 90000, 4, where="Berlin, BE, Germany"),
        rung("staff-software-engineer", ["Staff Software Engineer"],
             100000, 120000, 2),
    ])
    with contextlib.redirect_stderr(io.StringIO()):
        _, parsed, _ = fetch_spain.interpret(page, "acme", PER_LOCATION)
    bands = fetch_spain.bands(parsed, "2026-09-10")
    check("only the Spanish rung survives",
          sorted(b["level"] for b in bands), ["all", "staff"])


def test_a_country_page_band_gives_way() -> None:
    """One role, one band per level.

    The country page publishes a single median per company across every level;
    the company's Spain page publishes a range for the same role. Both landed
    at level `all` under one role, so eight companies carried two bands that
    disagreed. A first-hand figure at that level is never displaced.
    """
    print("fetch_spain.write() replaces a country-page band it supersedes")
    import fetch_spain

    with temp_companies() as directory:
        first_hand = {
            "level": "all", "base": {"p50": 70000}, "last_verified": "2026-08-31",
            "sources": [{"name": "community", "date": "2026-08-31"}],
        }
        (directory / "acme.yml").write_text(yaml.safe_dump({
            "slug": "acme", "name": "Acme",
            "compensation": {"currency": "EUR", "basis": "gross_annual", "roles": [
                {"role": "data-scientist", "levels": [band(COUNTRY), first_hand]},
            ]},
        }, sort_keys=False))

        fresh = band(PER_LOCATION, "all", "Spain only.")
        fetch_spain.write("acme", [fresh], "Acme", "2026-09-10", role="data-scientist",
                          served="Spain (aggregate)")

        levels = yaml.safe_load((directory / "acme.yml").read_text())
        levels = levels["compensation"]["roles"][0]["levels"]
        check("the country-page band is gone",
              [s["sources"][0]["name"] for s in levels], ["community", "levels.fyi"])
        check("and the survivor is the Spain-scoped one",
              [s["sources"][0].get("url") for s in levels], [None, PER_LOCATION])


def test_a_checked_company_says_so() -> None:
    """A blank row must distinguish "asked, nothing there" from "nobody looked".

    The front page reads `spain_check` for that, so the fetcher has to write a
    file even when it finds no pay, and has to take the role back out of the
    field the day that role does produce a band.
    """
    print("fetch_spain records that Levels.fyi was asked and had nothing")
    import fetch_spain

    company: dict = {}
    fetch_spain.note_check(company, "software-engineer", False, "United States", "2026-09-10")
    check("a miss is recorded", company["spain_check"],
          {"date": "2026-09-10", "roles": ["software-engineer"], "served": "United States"})

    fetch_spain.note_check(company, "data-scientist", False, "no data", "2026-09-11")
    check("a second miss joins the first", company["spain_check"]["roles"],
          ["data-scientist", "software-engineer"])

    fetch_spain.note_check(company, "software-engineer", True, "Spain (ladder)", "2026-09-12")
    check("a hit takes its role back out", company["spain_check"]["roles"], ["data-scientist"])
    check("and does not re-date the roles it says nothing about",
          company["spain_check"]["date"], "2026-09-11")

    fetch_spain.note_check(company, "data-scientist", True, "Spain (ladder)", "2026-09-12")
    check("the last hit drops the field", company.get("spain_check"), None)

    with temp_companies() as directory:
        fetch_spain.write("acme", [], "Acme", "2026-09-10", role="software-engineer",
                          served="United States")
        written = yaml.safe_load((directory / "acme.yml").read_text())
        check("a company with no pay still gets a file",
              written.get("spain_check", {}).get("roles"), ["software-engineer"])


def test_a_file_cannot_claim_both() -> None:
    """`spain_check` and a band for the same role contradict each other."""
    print("validate.py rejects a spain_check the bands disprove")
    import validate

    payload = {
        "slug": "acme", "name": "Acme",
        "spain_check": {"date": "2026-09-10", "roles": ["software-engineer"]},
        "compensation": {"currency": "EUR", "basis": "gross_annual", "roles": [
            {"role": "software-engineer", "levels": [band(PER_LOCATION)]},
        ]},
    }
    validate.errors.clear()
    validate.check_spain_check("acme.yml", payload)
    check("a contradicted check is an error",
          any("but a software-engineer band is on file" in e for e in validate.errors), True)

    payload["compensation"]["roles"] = []
    validate.errors.clear()
    validate.check_spain_check("acme.yml", payload)
    check("an uncontradicted one is fine", validate.errors, [])


def main() -> int:
    for test in (test_location_guard, test_unscoped_classifier,
                 test_purge_runs_even_when_spain_data_exists,
                 test_import_skips_rows_with_no_band,
                 test_figures_are_converted_to_euros,
                 test_sample_size_is_not_a_spanish_count,
                 test_rung_names_decide_seniority,
                 test_foreign_samples_drop_the_rung,
                 test_a_country_page_band_gives_way,
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
