#!/usr/bin/env python3
"""Regenerate the README tables and the exports/ files from data/companies/."""
from __future__ import annotations

import csv
import datetime as dt
import io
import json
import re
import sys

import lib

README = lib.ROOT / "README.md"

CONTRACT_LABELS = {
    "spanish-payroll": "nómina",
    "eor": "EOR",
    "contractor": "contractor",
    "freelance": "autónomo",
}
PRESENCE_LABELS = {
    "hq": "HQ in Spain",
    "hub": "Office in Spain",
    "remote-only": "Remote, no office",
    "eor": "Via EOR only",
}


def replace_block(text: str, marker: str, body: str) -> str:
    pattern = re.compile(
        rf"(<!-- BEGIN:{marker} -->\n).*?(\n<!-- END:{marker} -->)",
        re.DOTALL,
    )
    if not pattern.search(text):
        raise SystemExit(f"README.md is missing the {marker} markers")
    return pattern.sub(lambda m: m.group(1) + body + m.group(2), text)


def verified_cell(value) -> str:
    day = lib.parse_date(value)
    if day is None:
        return "—"
    return f"⚠️ {day}" if lib.is_stale(day) else str(day)


def company_link(company: dict) -> str:
    return f"[{company['name']}]({company['website']})"


def render_stats(companies: list[dict], backlog: int) -> str:
    listed = [c for c in companies if lib.qualifies(c)]
    bands = sum(1 for c in companies for _ in lib.iter_levels(c))
    stale = sum(
        1 for c in companies for _, lvl in lib.iter_levels(c)
        if lib.is_stale(lvl.get("last_verified"))
    )
    return (
        f"**{len(listed)} companies** above {lib.THRESHOLD_EUR // 1000}k · "
        f"**{bands} salary bands** · {stale} stale · "
        f"{backlog} companies still unresearched · "
        f"updated {dt.date.today()}"
    )


def render_companies(companies: list[dict]) -> str:
    listed = sorted(
        (c for c in companies if lib.qualifies(c)),
        key=lambda c: -lib.top_band(c)[2],
    )
    if not listed:
        return (
            "_No companies documented yet._ Copy `data/companies/_template.yml`, "
            "fill it in, and run `python3 scripts/build.py`."
        )

    rows = [
        "| Company | Presence | Model | Paid as | Top band | Role / level | Verified |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for company in listed:
        role, level, _ = lib.top_band(company)
        where = PRESENCE_LABELS.get(company["spain_presence"], company["spain_presence"])
        if company.get("hq", {}).get("city"):
            where += f" ({company['hq']['city']})"
        model = company.get("work_model", "—")
        if company.get("remote_within_spain"):
            model += " · anywhere in ES"
        paid = ", ".join(CONTRACT_LABELS.get(c, c) for c in company.get("contract", []))
        rows.append(
            f"| {company_link(company)} | {where} | {model} | {paid} | "
            f"{lib.fmt_band(level['base'])} | {role} / {level['level']} | "
            f"{verified_cell(level.get('last_verified'))} |"
        )

    undocumented = [c for c in companies if not lib.qualifies(c)]
    if undocumented:
        names = ", ".join(sorted(c["name"] for c in undocumented))
        rows.append("")
        rows.append(f"<sub>Listed but not yet documented above the threshold: {names}</sub>")
    return "\n".join(rows)


def render_by_role(companies: list[dict]) -> str:
    by_role: dict[str, list[tuple[dict, dict]]] = {}
    for company in companies:
        for role, level in lib.iter_levels(company):
            by_role.setdefault(role, []).append((company, level))
    if not by_role:
        return "_Nothing to show yet._"

    blocks = []
    for role in sorted(by_role, key=lambda r: (-len(by_role[r]), r)):
        entries = sorted(
            by_role[role],
            key=lambda e: (lib.level_rank(e[1]["level"]), -(lib.reference_base(e[1]["base"]) or 0)),
        )
        lines = [
            f"<details>",
            f"<summary><b>{role}</b> — {len(entries)} band{'s' if len(entries) != 1 else ''}</summary>",
            "",
            "| Company | Level | Base | Bonus | Equity | n | Source | Verified |",
            "| --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        for company, level in entries:
            bonus = f"{level['bonus_pct']:g}%" if level.get("bonus_pct") is not None else "—"
            sources = " ".join(
                f"[{s['name']}]({s['url']})" if s.get("url") else s["name"]
                for s in level.get("sources", [])
            )
            lines.append(
                f"| {company_link(company)} | {level['level']} | {lib.fmt_band(level['base'])} | "
                f"{bonus} | {level.get('equity', '—')} | {level.get('sample_size', '—')} | "
                f"{sources or '—'} | {verified_cell(level.get('last_verified'))} |"
            )
        lines += ["", "</details>", ""]
        blocks.append("\n".join(lines))
    return "\n".join(blocks).rstrip()


def write_exports(companies: list[dict]) -> None:
    lib.EXPORTS_DIR.mkdir(exist_ok=True)

    payload = []
    for company in companies:
        record = {k: v for k, v in company.items() if not k.startswith("_")}
        best = lib.top_band(company)
        record["_computed"] = {
            "qualifies": lib.qualifies(company),
            "top_band_eur": best[2] if best else None,
            "top_band_role": best[0] if best else None,
            "top_band_level": best[1]["level"] if best else None,
        }
        payload.append(record)
    (lib.EXPORTS_DIR / "companies.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, default=str) + "\n",
        encoding="utf-8",
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([
        "slug", "name", "linkedin_id", "website", "hq_city", "hq_country",
        "spain_presence", "work_model", "remote_within_spain", "contract",
        "role", "level", "base_min", "base_p50", "base_max", "bonus_pct",
        "equity", "sample_size", "sources", "last_verified",
    ])
    for company in companies:
        common = [
            company.get("slug"), company.get("name"), company.get("linkedin_id"),
            company.get("website"), company.get("hq", {}).get("city"),
            company.get("hq", {}).get("country"), company.get("spain_presence"),
            company.get("work_model"), company.get("remote_within_spain"),
            "|".join(company.get("contract", [])),
        ]
        levels = list(lib.iter_levels(company))
        if not levels:
            writer.writerow(common + [""] * 10)
            continue
        for role, level in levels:
            base = level.get("base", {})
            writer.writerow(common + [
                role, level.get("level"), base.get("min"), base.get("p50"), base.get("max"),
                level.get("bonus_pct"), level.get("equity"), level.get("sample_size"),
                "|".join(s["name"] for s in level.get("sources", [])),
                level.get("last_verified"),
            ])
    (lib.EXPORTS_DIR / "companies.csv").write_text(buffer.getvalue(), encoding="utf-8")


def count_backlog() -> int:
    path = lib.ROOT / "data" / "backlog.csv"
    if not path.exists():
        return 0
    with path.open(encoding="utf-8") as fh:
        return sum(1 for row in csv.DictReader(fh) if row.get("status") == "unresolved")


def main() -> int:
    companies = lib.load_companies()
    text = README.read_text(encoding="utf-8")
    text = replace_block(text, "STATS", render_stats(companies, count_backlog()))
    text = replace_block(text, "COMPANIES", render_companies(companies))
    text = replace_block(text, "BY_ROLE", render_by_role(companies))
    README.write_text(text, encoding="utf-8")
    write_exports(companies)
    print(f"Built README.md and exports/ from {len(companies)} companies.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
