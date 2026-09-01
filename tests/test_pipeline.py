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
        fetch_spain.write("acme", spanish, "Acme", "2026-09-02")

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

        fetch_spain.write("acme", None, "Acme", "2026-09-02")
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


def main() -> int:
    for test in (test_location_guard, test_unscoped_classifier,
                 test_purge_runs_even_when_spain_data_exists,
                 test_import_skips_rows_with_no_band):
        test()
    if failures:
        print(f"\n{len(failures)} failed: {', '.join(failures)}")
        return 1
    print("\nall checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
