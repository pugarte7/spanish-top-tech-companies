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
    "spanish-payroll": "Spanish payroll",
    "eor": "Employer of record",
    "contractor": "Contractor",
    "freelance": "Freelance (autónomo)",
}
PRESENCE_LABELS = {
    "hq": "Headquarters",
    "hub": "Office",
    "remote-only": "No office",
    "eor": "Via EOR",
}
LANG_LABELS = {"es": "Spanish", "en": "English", "both": "Spanish / English"}

# The distribution bar is drawn on a fixed scale so every row is comparable.
BAR_LO, BAR_HI, BAR_WIDTH = 30_000, 150_000, 20


def replace_block(text: str, marker: str, body: str) -> str:
    pattern = re.compile(
        rf"(<!-- BEGIN:{marker} -->\n).*?(\n<!-- END:{marker} -->)", re.DOTALL
    )
    if not pattern.search(text):
        raise SystemExit(f"README.md is missing the {marker} markers")
    return pattern.sub(lambda m: m.group(1) + body + m.group(2), text)


# --------------------------------------------------------------------------- cells


def k(value) -> str:
    if value is None:
        return "—"
    return f"{value / 1000:.1f}k".replace(".0k", "k")


def exact(value) -> str:
    return "—" if value is None else f"{value:,}".replace(",", ".")


def money_cell(band: dict | None, formatter=k, suffix: str = "") -> str:
    """Range with the median in brackets, e.g. 62k–84k (72k)."""
    if not band:
        return "—"
    lo, p50, hi = band.get("min"), band.get("p50"), band.get("max")
    if lo is not None and hi is not None:
        core = f"{formatter(lo)}–{formatter(hi)}{suffix}"
        return f"{core} ({formatter(p50)})" if p50 is not None else core
    single = p50 if p50 is not None else (hi if hi is not None else lo)
    return f"{formatter(single)}{suffix}"


def bar_cell(band: dict | None) -> str:
    if not band:
        return "`" + "·" * BAR_WIDTH + "`"
    lo = band.get("min") or band.get("p50") or band.get("max")
    hi = band.get("max") or band.get("p50") or band.get("min")
    mid = band.get("p50")

    def pos(v):
        ratio = (v - BAR_LO) / (BAR_HI - BAR_LO)
        return max(0, min(BAR_WIDTH - 1, round(ratio * (BAR_WIDTH - 1))))

    start, end = pos(lo), pos(hi)
    marker = pos(mid) if mid is not None else None
    cells = []
    for i in range(BAR_WIDTH):
        if i == marker:
            cells.append("|")
        elif start <= i <= end:
            cells.append("=")
        else:
            cells.append("·")
    return "`" + "".join(cells) + "`"


def updated_cell(value) -> str:
    day = lib.parse_date(value)
    if day is None:
        return "—"
    stamp = f"{day:%Y-%m}"
    return f"{stamp} (stale)" if lib.is_stale(day) else stamp


def sources_cell(level: dict) -> str:
    parts = []
    for source in level.get("sources", []) or []:
        parts.append(f"[{source['name']}]({source['url']})" if source.get("url") else source["name"])
    return ", ".join(parts) or "—"


def anchor(company: dict) -> str:
    return f"[{company['name']}](#{company['slug']})"


def website_cell(company: dict) -> str:
    url = company.get("website")
    return f"[{company['name']}]({url})" if url else company["name"]


def work_model_cell(company: dict) -> str:
    model = (company.get("work_model") or "—").capitalize()
    if company.get("work_model") == "remote" and company.get("remote_within_spain"):
        return "Remote (anywhere in Spain)"
    if company.get("remote_within_spain") and company.get("work_model") == "hybrid":
        return "Hybrid (flexible location)"
    return model


def offices_cell(company: dict) -> str:
    offices = company.get("offices_es") or []
    if offices:
        return ", ".join(offices)
    return "None" if company.get("spain_presence") in {"remote-only", "eor"} else "—"


def careers_cell(company: dict) -> str:
    url = company.get("careers_url")
    return f"[Open positions]({url})" if url else "—"


# --------------------------------------------------------------------------- blocks


def render_stats(companies: list[dict], backlog: int) -> str:
    listed = [c for c in companies if lib.qualifies(c)]
    bands = [lvl for c in companies for _, lvl in lib.iter_levels(c)]
    points = sum(lvl.get("sample_size") or 0 for lvl in bands)
    stale = sum(1 for lvl in bands if lib.is_stale(lvl.get("last_verified")))
    parts = [
        f"**{len(listed)} companies**",
        f"**{len(bands)} salary bands**",
    ]
    # The public route publishes no sample sizes, so don't advertise "0 data points".
    if points:
        parts.append(f"{points} data points")
    if stale:
        parts.append(f"{stale} stale")
    if backlog:
        parts.append(f"{backlog} companies not yet researched")
    freshest = max(
        (d for d in (lib.parse_date(lvl.get("last_verified")) for lvl in bands) if d),
        default=None,
    )
    if freshest:
        parts.append(f"newest data {freshest}")
    return " · ".join(parts)


def render_benchmarks() -> str:
    path = lib.ROOT / "data" / "benchmarks.json"
    if not path.exists():
        return "_No benchmarks yet._ Run `python3 scripts/fetch_levels_public.py`."
    payload = json.loads(path.read_text(encoding="utf-8"))
    rows = payload.get("benchmarks") or []
    if not rows:
        return "_No benchmarks yet._"

    rows.sort(key=lambda r: -(r.get("p50") or 0))
    out = [
        "| Role | Where | 25th pct | Median | 75th pct | 90th pct | Data points | Updated |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for row in rows:
        out.append(
            f"| [{row['role']}]({row['url']}) | {row.get('location') or '—'} | "
            f"{k(row.get('p25'))} | **{k(row.get('p50'))}** | {k(row.get('p75'))} | "
            f"{k(row.get('p90'))} | {row.get('data_points') or '—'} | "
            f"{row.get('last_updated', '—')} |"
        )
    out += [
        "",
        "<sub>**Total compensation** (base + bonus + annualised equity), gross annual, euros. "
        "Not directly comparable with the base-salary figures in the tables below. "
        "Data source: Levels.fyi (https://www.levels.fyi).</sub>",
    ]
    return "\n".join(out)


def render_companies(companies: list[dict]) -> str:
    listed = sorted(
        (c for c in companies if lib.qualifies(c)), key=lambda c: c["name"].lower()
    )
    if not listed:
        return (
            "_No companies documented yet._ Copy `data/companies/_template.yml`, "
            "fill it in, and run `python3 scripts/build.py`."
        )

    rows = [
        "| Company | Sector | Headquarters | Offices in Spain | Work model | Contract | Size | Careers |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for c in listed:
        hq = c.get("hq") or {}
        location = ", ".join(x for x in (hq.get("city"), hq.get("country")) if x) or "—"
        contract = ", ".join(CONTRACT_LABELS.get(x, x) for x in (c.get("contract") or [])) or "—"
        rows.append(
            f"| **{anchor(c)}** | {', '.join(c.get('sector') or []) or '—'} | {location} | "
            f"{offices_cell(c)} | {work_model_cell(c)} | {contract} | "
            f"{c.get('employees') or '—'} | {careers_cell(c)} |"
        )
    incomplete = sum(1 for c in listed if not c.get("website") or not c.get("hq"))
    rows.append("")
    if incomplete:
        rows.append(
            f"<sub>**{incomplete} of {len(listed)} companies were seeded from salary data "
            "and still need their details filled in** (website, offices, contract type). "
            "That is the easiest way to contribute — see "
            "[CONTRIBUTING.md](CONTRIBUTING.md).</sub>"
        )
        rows.append("")
    rows.append(
        "<sub>_Offices in Spain_ is `None` when the company hires here without a local "
        "office, either directly or through an employer of record. _Work model_ says "
        "whether you are tied to a city. Salary bands for each company are in "
        "[Company details](#company-details).</sub>"
    )
    return "\n".join(rows)


def render_salaries(companies: list[dict]) -> str:
    rows_data = []
    for c in companies:
        for role, level in lib.iter_levels(c):
            rows_data.append((c, role, level, lib.level_value(level) or 0))
    if not rows_data:
        return "_No salary data yet._"
    rows_data.sort(key=lambda r: -r[3])

    rows = [
        "| Company | Role | Level | Base salary | Total comp | Bonus | Equity | Data points | Source | Updated |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for c, role, level, _ in rows_data:
        bonus = f"{level['bonus_pct']:g}%" if level.get("bonus_pct") is not None else "—"
        rows.append(
            f"| {anchor(c)} | {role} | {level['level']} | "
            f"{money_cell(level.get('base'))} | {money_cell(level.get('total_comp'))} | "
            f"{bonus} | {level.get('equity', '—')} | {level.get('sample_size', '—')} | "
            f"{sources_cell(level)} | {updated_cell(level.get('last_verified'))} |"
        )
    rows.append("")
    rows.append(
        "<sub>Base salary shown as range with the median in brackets. "
        "Gross annual, in euros, before tax.</sub>"
    )
    return "\n".join(rows)


def render_by_role(companies: list[dict]) -> str:
    by_role: dict[str, list[tuple[dict, dict]]] = {}
    for c in companies:
        for role, level in lib.iter_levels(c):
            by_role.setdefault(role, []).append((c, level))
    if not by_role:
        return "_Nothing to show yet._"

    blocks = []
    for role in sorted(by_role, key=lambda r: (-len(by_role[r]), r)):
        entries = sorted(
            by_role[role],
            key=lambda e: (lib.level_rank(e[1]["level"]), -(lib.level_value(e[1]) or 0)),
        )
        medians = sorted(
            v for v in (lib.level_value(lvl) for _, lvl in entries) if v is not None
        )
        headline = k(medians[len(medians) // 2]) if medians else "—"
        companies_count = len({c["slug"] for c, _ in entries})

        lines = [
            "<details>",
            f"<summary><b>{role}</b> — {companies_count} "
            f"compan{'ies' if companies_count != 1 else 'y'}, "
            f"{len(entries)} band{'s' if len(entries) != 1 else ''}, median {headline}</summary>",
            "",
            "| Company | Level | Base salary | Distribution | Total comp | Data points | Updated |",
            "| --- | --- | --- | --- | --- | --- | --- |",
        ]
        for c, level in entries:
            lines.append(
                f"| {anchor(c)} | {level['level']} | {money_cell(level.get('base'))} | "
                f"{bar_cell(level.get('base') or level.get('total_comp'))} | "
                f"{money_cell(level.get('total_comp'))} | "
                f"{level.get('sample_size', '—')} | {updated_cell(level.get('last_verified'))} |"
            )
        lines += [
            "",
            f"<sub>Distribution scaled {k(BAR_LO)}–{k(BAR_HI)}, `|` marks the median.</sub>",
            "",
            "</details>",
            "",
        ]
        blocks.append("\n".join(lines))
    return "\n".join(blocks).rstrip()


def render_profiles(companies: list[dict]) -> str:
    listed = sorted(companies, key=lambda c: c["name"].lower())
    if not listed:
        return "_Nothing to show yet._"

    blocks = []
    for c in listed:
        best = lib.top_band(c)
        summary_tail = f"{best[0]} {best[1]['level']} {k(best[2])}" if best else "no bands yet"
        hq = c.get("hq") or {}
        hq_text = ", ".join(x for x in (hq.get("city"), hq.get("country")) if x) or "unknown"
        offices = ", ".join(c.get("offices_es") or [])
        presence = c.get("spain_presence")
        if presence == "hq":
            where = f"**Headquartered in {hq_text}**"
        elif presence == "hub":
            where = f"**Office in {offices or 'Spain'}** · HQ {hq_text}"
        elif presence == "eor":
            where = f"**Hires in Spain through an employer of record** · HQ {hq_text}"
        elif presence:
            where = f"**No office in Spain** · HQ {hq_text}"
        else:
            where = "**Location and contract not yet recorded**"
        facts = [
            where,
            work_model_cell(c) if c.get("work_model") else None,
            ", ".join(CONTRACT_LABELS.get(x, x) for x in (c.get("contract") or [])) or None,
        ]
        facts = [f for f in facts if f]
        if c.get("employees"):
            facts.append(f"{c['employees']} employees")
        if c.get("working_language"):
            facts.append(f"Working language: {LANG_LABELS.get(c['working_language'], c['working_language'])}")

        lines = [
            f'<a id="{c["slug"]}"></a>',
            "<details>",
            f"<summary><b>{c['name']}</b> — {summary_tail}</summary>",
            "",
            " · ".join(facts),
            "",
            "| Role | Level | Base salary | Total comp | Bonus | Equity | Data points | Source | Updated |",
            "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
        ]
        levels = sorted(lib.iter_levels(c), key=lambda e: (e[0], lib.level_rank(e[1]["level"])))
        for role, level in levels:
            bonus = f"{level['bonus_pct']:g}%" if level.get("bonus_pct") is not None else "—"
            lines.append(
                f"| {role} | {level['level']} | {money_cell(level.get('base'), exact, ' €')} | "
                f"{money_cell(level.get('total_comp'), exact, ' €')} | {bonus} | "
                f"{level.get('equity', '—')} | {level.get('sample_size', '—')} | "
                f"{sources_cell(level)} | {updated_cell(level.get('last_verified'))} |"
            )
        lines.append("")

        perks = c.get("perks") or {}
        if perks:
            readable = []
            for key, value in perks.items():
                label = key.replace("_", " ").capitalize()
                if value is True:
                    readable.append(label)
                elif value not in (False, None):
                    readable.append(f"{label}: {value}")
            if readable:
                lines += [f"**Benefits** — {' · '.join(readable)}", ""]
        if c.get("notes"):
            lines += [c["notes"], ""]

        links = [f"[Website]({c['website']})"] if c.get("website") else []
        if c.get("careers_url"):
            links.append(f"[Open positions]({c['careers_url']})")
        if c.get("linkedin_id"):
            links.append(f"[LinkedIn](https://www.linkedin.com/company/{c['linkedin_id']}/)")
            links.append(
                "[Jobs in Spain](https://www.linkedin.com/jobs/search/"
                f"?f_C={c['linkedin_id']}&geoId=105646813&f_TPR=r604800)"
            )
        links.append(
            "[Edit this entry](https://github.com/pugarte7/spanish-top-tech-companies"
            f"/edit/main/data/companies/{c['slug']}.yml)"
        )
        lines += [" · ".join(links), "", "</details>", ""]
        blocks.append("\n".join(lines))
    return "\n".join(blocks).rstrip()


# --------------------------------------------------------------------------- exports


def write_exports(companies: list[dict]) -> None:
    lib.EXPORTS_DIR.mkdir(exist_ok=True)

    payload = []
    for c in companies:
        record = {key: value for key, value in c.items() if not key.startswith("_")}
        best = lib.top_band(c)
        record["_computed"] = {
            "qualifies": lib.qualifies(c),
            "top_band_eur": best[2] if best else None,
            "top_band_role": best[0] if best else None,
            "top_band_level": best[1]["level"] if best else None,
        }
        payload.append(record)
    (lib.EXPORTS_DIR / "companies.json").write_text(
        json.dumps(payload, indent=2, ensure_ascii=False, default=str) + "\n", encoding="utf-8"
    )

    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([
        "slug", "name", "linkedin_id", "website", "careers_url", "hq_city", "hq_country",
        "spain_presence", "offices_es", "employees", "sector", "work_model",
        "remote_within_spain", "contract", "working_language",
        "role", "level", "base_min", "base_p50", "base_max",
        "tc_min", "tc_p50", "tc_max", "bonus_pct", "equity", "data_points",
        "sources", "last_verified",
    ])
    for c in companies:
        common = [
            c.get("slug"), c.get("name"), c.get("linkedin_id"), c.get("website"),
            c.get("careers_url"), c.get("hq", {}).get("city"), c.get("hq", {}).get("country"),
            c.get("spain_presence"), "|".join(c.get("offices_es") or []), c.get("employees"),
            "|".join(c.get("sector") or []), c.get("work_model"), c.get("remote_within_spain"),
            "|".join(c.get("contract", [])), c.get("working_language"),
        ]
        levels = list(lib.iter_levels(c))
        if not levels:
            writer.writerow(common + [""] * 13)
            continue
        for role, level in levels:
            base = level.get("base", {})
            tc = level.get("total_comp", {}) or {}
            writer.writerow(common + [
                role, level.get("level"),
                base.get("min"), base.get("p50"), base.get("max"),
                tc.get("min"), tc.get("p50"), tc.get("max"),
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
    text = replace_block(text, "BENCHMARKS", render_benchmarks())
    text = replace_block(text, "COMPANIES", render_companies(companies))
    text = replace_block(text, "SALARIES", render_salaries(companies))
    text = replace_block(text, "BY_ROLE", render_by_role(companies))
    text = replace_block(text, "PROFILES", render_profiles(companies))
    README.write_text(text, encoding="utf-8")
    write_exports(companies)
    print(f"Built README.md and exports/ from {len(companies)} companies.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
