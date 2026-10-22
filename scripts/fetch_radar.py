#!/usr/bin/env python3
"""Enrich salary-bearing companies from Spain Tech Radar's open dataset.

    python3 scripts/fetch_radar.py            # enrich every company on file
    python3 scripts/fetch_radar.py --dry-run  # print the matches, write nothing

https://www.spaintechradar.com/datos/empresas.json is a public download
(CC BY 4.0) of ~4.900 companies with a tech team in Spain: website, careers
page, offices with coordinates, stack, CIF, whether they call themselves a
product company or a consultancy, and their remote policy. Only companies
with salaries on file are enriched - the site shows those, not the whole
radar - and only empty fields are filled, so a value set by hand, and a "-"
meaning "checked, there is none", are never overwritten.

Matching is by dominio (a company's own domain), then by LinkedIn URL, then
by exact normalized name, weakest last because two companies can share one.
Every name match is printed for review.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.error
import urllib.request

import lib

DATASET = "https://www.spaintechradar.com/datos/empresas.json"
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

TIPO = {"producto": "product", "consultora": "consultancy", "no_tech": "no-tech"}
REMOTO = {"remoto": "remote", "hibrido": "hybrid", "presencial": "office"}
# Company-name suffixes that make two spellings of one employer differ, and
# occasionally two employers collide anyway, so name matches print for review.
NAME_NOISE = re.compile(
    r"\b(s\.?\s?l\.?|s\.?\s?a\.?|s\.?\s?l\.?u\.?|inc|ltd|gmbh|b\.?v\.?|spa|corp)\b")


def download() -> list[dict]:
    request = urllib.request.Request(DATASET, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            return json.load(response)
    except (urllib.error.URLError, OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Spain Tech Radar unreadable: {exc}") from exc


def norm_name(name) -> str:
    return NAME_NOISE.sub("", lib._norm_words(name)).strip()


def domain(url_or_domain) -> str | None:
    """"https://www.acme.com/jobs" or "acme.com" to "acme.com"."""
    text = str(url_or_domain or "").strip().lower()
    text = re.sub(r"^https?://", "", text)
    text = re.sub(r"^www\.", "", text)
    host = text.split("/")[0]
    return host if "." in host else None


def linkedin_slug(url) -> str | None:
    found = re.search(r"linkedin\.com/company/([^/?\s]+)", str(url or ""))
    return found.group(1).rstrip("/").lower() if found else None


def fields(empresa: dict) -> dict:
    """What one radar company would fill, keyed by our column."""
    enlaces = empresa.get("enlaces") or {}
    out = {"radar_slug": empresa.get("slug")}
    if enlaces.get("web"):
        out["website"] = enlaces["web"]
    if enlaces.get("empleo"):
        out["careers_url"] = enlaces["empleo"]
    if enlaces.get("github"):
        out["github_url"] = enlaces["github"]
    if empresa.get("cif"):
        out["cif"] = empresa["cif"]
    if TIPO.get(empresa.get("tipo")):
        out["company_type"] = TIPO[empresa["tipo"]]
    if REMOTO.get(empresa.get("remoto")):
        out["remote_policy"] = REMOTO[empresa["remoto"]]
    offices = [lib.office_str(of["municipio"], lib.region_code(of.get("comunidad")),
                              of.get("lat"), of.get("lon"))
               for of in empresa.get("oficinas") or [] if of.get("municipio")]
    if offices:
        out["offices"] = offices
    stack = [item["tecnologia"].replace("|", "/") for item in empresa.get("stack") or []
             if item.get("tecnologia")]
    if stack:
        out["stack"] = stack
    return out


def fill(company: dict, wanted: dict) -> int:
    """Write wanted fields the company lacks. "-" means "none, on purpose"."""
    written = 0
    for column, value in wanted.items():
        if value in (None, []) or company.get(column) not in (None, []):
            continue
        company[column] = value
        written += 1
    return written


def match(companies: list[dict], dataset: list[dict]) -> dict:
    """{company name: (empresa, how)} for companies that have salaries."""
    by_domain = {domain(e.get("dominio")): e for e in dataset if domain(e.get("dominio"))}
    by_linkedin = {linkedin_slug((e.get("enlaces") or {}).get("linkedin")): e
                   for e in dataset if linkedin_slug((e.get("enlaces") or {}).get("linkedin"))}
    by_name: dict[str, list[dict]] = {}
    for e in dataset:
        by_name.setdefault(norm_name(e.get("nombre")), []).append(e)

    found = {}
    for company in companies:
        if not lib.salaries(company):
            continue
        ours_domain = domain(company.get("website"))
        ours_linkedin = linkedin_slug(company.get("linkedin_url"))
        if ours_domain and ours_domain in by_domain:
            found[company["company"]] = (by_domain[ours_domain], "domain")
        elif ours_linkedin and ours_linkedin in by_linkedin:
            found[company["company"]] = (by_linkedin[ours_linkedin], "linkedin")
        else:
            candidates = by_name.get(norm_name(company["company"]), [])
            if len(candidates) == 1:
                found[company["company"]] = (candidates[0], "name")
            elif len(candidates) > 1:
                print(f"  {company['company']}: {len(candidates)} radar companies share "
                      "the name; leaving unmatched", file=sys.stderr)
    return found


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true",
                        help="Print the matches and fields, write nothing.")
    args = parser.parse_args(argv)

    dataset = download()
    companies = lib.load_companies()
    matched = match(companies, dataset)
    how = {"domain": 0, "linkedin": 0, "name": 0}
    filled = 0
    for name, (empresa, way) in sorted(matched.items()):
        company = next(c for c in companies if c["company"] == name)
        wanted = fields(empresa)
        how[way] += 1
        if args.dry_run:
            print(f"  {name} -> {empresa['slug']} ({way}): "
                  f"{', '.join(k for k, v in wanted.items() if v not in (None, []))}")
            continue
        filled += fill(company, wanted)
        if way == "name":
            print(f"  {name} -> {empresa['slug']} matched on name alone; check it",
                  file=sys.stderr)
    print(f"{len(matched)} of {sum(1 for c in companies if lib.salaries(c))} companies with "
          f"salaries matched "
          f"({how['domain']} by domain, {how['linkedin']} by LinkedIn, {how['name']} by name)")
    if args.dry_run:
        return 0
    if matched:
        lib.save_companies(companies)
    print(f"{filled} fields filled")
    print("Next: python3 scripts/validate.py && python3 scripts/build.py")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
