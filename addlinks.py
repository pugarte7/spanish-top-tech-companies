"""One-off: record LinkedIn pages the maintainer supplied by hand."""
import pathlib

import yaml
from new_company import SKELETON_ORDER

GIVEN = {
    "aily-labs": "https://www.linkedin.com/company/ailylabs",
    "semrush": "https://www.linkedin.com/company/semrush",
    "stenn": "https://www.linkedin.com/company/stenn-financial-services",
    "perk": "https://www.linkedin.com/company/perk",
    "hpe": "https://www.linkedin.com/company/hewlett-packard-enterprise",
    "edreams-odigeo": "https://www.linkedin.com/company/edreamsodigeo",
    "basf": "https://www.linkedin.com/company/basf",
    "novakid": "https://www.linkedin.com/company/novakid",
    "semidynamics": "https://www.linkedin.com/company/semidynamics",
    "d-edge": "https://www.linkedin.com/company/d-edge-hospitality-solutions",
}

for slug, url in GIVEN.items():
    root = pathlib.Path(__file__).resolve().parent
    path = root / "data" / "companies" / f"{slug}.yml"
    if not path.exists():
        print(f"  {slug}: no company file")
        continue
    company = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    before = company.get("linkedin_url")
    company["linkedin_url"] = url
    rest = {k: v for k, v in company.items() if k not in SKELETON_ORDER}
    ordered = {k: company[k] for k in SKELETON_ORDER if k in company}
    ordered.update(rest)
    path.write_text(
        yaml.safe_dump(ordered, sort_keys=False, allow_unicode=True, width=100),
        encoding="utf-8")
    print(f"  {slug}: {'replaced' if before else 'added'} {url}")
