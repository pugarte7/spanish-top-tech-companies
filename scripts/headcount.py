#!/usr/bin/env python3
"""Company sizes and published recruiting contacts, from a workbook.

    python3 scripts/headcount.py BOOK.xlsx             # data/sizes.json
    python3 scripts/headcount.py BOOK.xlsx --contacts  # and the private contacts.json

The workbook (2026-11-19) lists each company of data.json by name with a
headcount from public sources ("Empresas") and the people found for it with
whatever contact they published ("Contactos"). Read with the standard library:
an .xlsx is a zip of XML.

Sizes are public and go to data/sizes.json, keyed by Levels.fyi slug; site.py
adds them to data.json at build time, so --refresh never loses them.

Contacts are people, so they stay private: contacts.json is written beside
lib.DATA, kept encrypted in the private repo (private_data.sh) and bundled with
the MCP function by deploy.yml. Only the rows in RECRUITING are kept, as
recruiters; scripts/enrich.py adds the rest, one company at a time.
"""
from __future__ import annotations

import json
import re
import sys
import xml.etree.ElementTree as ET
import zipfile

import lib

M = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
R = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
SIZES = lib.ROOT / "data" / "sizes.json"
CONTACTS = lib.DATA.parent / "contacts.json"

# Upper bounds; LinkedIn's own ranges (11-50, 51-200, 201-500, 501-1000,
# 1001-5000, 5001-10000) each fall inside one bucket.
BUCKETS = [(50, "1-50"), (200, "51-200"), (1000, "201-1000"), (5000, "1001-5000"), (None, "5001+")]

# The figure is one office or the Spanish subsidiary of a much larger group:
# shown as it is, never bucketed, since the filter is about the employer.
BRANCH = {
    "CHECK24", "Experis", "Extia", "Huawei", "Infor", "ING", "Intel", "Intellias", "IQVIA", "JAKALA",
    "John Deere", "JOOR", "JTI", "Juniper Networks", "Kantar", "Keysight Technologies", "King", "Kiwi.com",
    "Korn Ferry", "Kyndryl", "L'Oréal", "McKinsey", "Mercedes-Benz", "MI-GSO", "Microsoft",
    "Milestone Systems", "Mitek Systems", "Monolithic Power Systems", "NEORIS", "Nestlé", "PlayStation",
    "Porsche Digital", "Roche", "Safran", "Scalian", "Schwarz IT", "SII Services",
}
# Cells the parser reads wrong: a year or a decimal beside the figure.
FIXES = {"Huawei": 543, "Lime": 2800}

# Contacts whose address the company, or its recruiter, published for
# candidates (a careers page, a recruiter's own call for CVs) since 2024, for
# Spain, EMEA or everywhere, with an unambiguous identity. Chosen by hand on
# 2026-11-19 from the 191 rows with an address: the rest were published for
# something else (press, investors, regulators, papers) and are not used.
RECRUITING = {
    "C-01401", "C-01403", "C-00715", "C-00716", "C-00722", "C-02593", "C-02594", "C-02606", "C-02638",
    "C-02676", "C-02756", "C-02830", "C-02854", "C-02907", "C-02939",
}
# The workbook does not tie the published address to the person's name.
UNNAMED = {"C-02756"}


def sheets(path: str) -> dict[str, list[dict]]:
    """Each sheet as rows keyed by its header; a cell with a link also gives
    "<header> URL"."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.parse(z.open("xl/sharedStrings.xml")).getroot().findall(M + "si"):
            shared.append("".join(t.text or "" for t in si.iter(M + "t")))
    book = ET.parse(z.open("xl/workbook.xml")).getroot()
    rels = {r.get("Id"): r.get("Target") for r in ET.parse(z.open("xl/_rels/workbook.xml.rels")).getroot()}
    out = {}
    for sheet in book.find(M + "sheets"):
        target = "xl/" + rels[sheet.get(R + "id")].lstrip("/").removeprefix("xl/")
        root = ET.parse(z.open(target)).getroot()
        links = {}
        rel_path = target.replace("worksheets/", "worksheets/_rels/") + ".rels"
        if rel_path in z.namelist():
            targets = {r.get("Id"): r.get("Target") for r in ET.parse(z.open(rel_path)).getroot()}
            for h in root.iter(M + "hyperlink"):
                if h.get(R + "id") in targets:
                    links[h.get("ref")] = targets[h.get(R + "id")]
        rows = []
        for row in root.find(M + "sheetData").findall(M + "row"):
            cells = {}
            for c in row.findall(M + "c"):
                v, kind, ref = c.find(M + "v"), c.get("t"), c.get("r")
                if kind == "s" and v is not None:
                    value = shared[int(v.text)]
                elif kind == "inlineStr":
                    value = "".join(t.text or "" for t in c.iter(M + "t"))
                else:
                    value = v.text if v is not None else ""
                cells[re.match(r"[A-Z]+", ref).group()] = (value.strip(), links.get(ref))
            rows.append(cells)
        if not rows:
            continue
        head = {col: text for col, (text, _) in rows[0].items()}
        table = []
        for cells in rows[1:]:
            record = {name: "" for name in head.values()}
            for col, (text, link) in cells.items():
                if col in head:
                    record[head[col]] = text
                    if link:
                        record[head[col] + " URL"] = link
            table.append(record)
        out[sheet.get("name")] = table
    return out


def number(text: str) -> int:
    return int(re.sub(r"[.,\s]", "", text))


def headcount(cell: str) -> tuple[int | None, int | None]:
    """(employees, the figure to bucket by) of a headcount cell.

    "51-200" is a range: no figure, bucketed by its top. Several figures (a
    subsidiary and its group, two sources) give the largest, the group's.
    "700+" and ">700" are bucketed as 701."""
    text = re.sub(r"\([^)]*\)", " ", cell)
    span = re.fullmatch(r"\s*[~≈]?\s*(\d[\d.,]*)\s*[-–]\s*(\d[\d.,]*)\s*", text)
    if span:
        return None, number(span[2])
    found = [(number(m[0]), m) for m in re.finditer(r"\d{1,3}(?:[.,]\d{3})+|\d+", text)]
    if not found:
        return None, None
    n, m = max(found, key=lambda f: f[0])
    more = text[m.end():m.end() + 1] == "+" or bool(re.search(r"[>+]\s*$", text[:m.start()]))
    return n, n + 1 if more else n


def bucket(n: int | None) -> str | None:
    if n is None:
        return None
    return next(label for top, label in BUCKETS if top is None or n <= top)


def sizes(book: dict, slugs: dict[str, str]) -> dict:
    companies = {}
    for row in book["Empresas"]:
        name, cell = row["Empresa"], row["Dato de plantilla"]
        if name not in slugs:
            print(f"not in data.json: {name}", file=sys.stderr)
            continue
        employees, by = headcount(cell)
        if name in FIXES:
            employees = by = FIXES[name]
        if by is None:
            continue
        branch = name in BRANCH
        # [bucket, employees, 1 when the figure is a branch's]: null bucket for a branch.
        companies[slugs[name]] = [None if branch else bucket(by), employees, *([1] if branch else [])]
    return {"as_of": "2026-11-19",
            "note": "Headcounts from public sources (annual reports, company pages, third-party "
                    "estimates), for the whole company or group unless marked as a branch.",
            "buckets": [label for _, label in BUCKETS],
            "companies": dict(sorted(companies.items()))}


def contacts(book: dict, slugs: dict[str, str]) -> dict:
    out: dict[str, list] = {}
    seen = set()
    for row in book["Contactos"]:
        if row["ID"] not in RECRUITING:
            continue
        email = (row["Email profesional publicado"] or row["Contacto por función"]).strip()
        if not email or email.lower() in seen:
            continue
        seen.add(email.lower())
        source = (row.get("Fuente del email URL") or row.get("Fuente del contacto por función URL")
                  or row["Fuente del email"] or row["Fuente del contacto por función"])
        out.setdefault(slugs[row["Empresa del censo"]], []).append({
            "kind": "recruiter", "name": None if row["ID"] in UNNAMED else row["Nombre"],
            "role": row["Cargo o indicio"], "email": email, "linkedin": None, "jobs": [],
            "scope": row["Ámbito"],
            "published": row["Contexto / finalidad del email"],
            "source": source if source.startswith("http") else None,
        })
    return {"as_of": "2026-11-19", "companies": dict(sorted(out.items()))}


def main(argv: list[str]) -> int:
    paths = [a for a in argv if not a.startswith("--")]
    if len(paths) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    book = sheets(paths[0])
    data = json.loads((lib.ROOT / "data" / "data.json").read_text(encoding="utf-8"))
    slugs = {c["name"]: c["levels"] for c in data["companies"]}
    found = sizes(book, slugs)
    SIZES.write_text(json.dumps(found, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    counts = {}
    for b, *_ in found["companies"].values():
        counts[b or "branch"] = counts.get(b or "branch", 0) + 1
    print(f"{SIZES.relative_to(lib.ROOT)}: {len(found['companies'])} of {len(slugs)} companies, {counts}")
    if "--contacts" in argv:
        people = contacts(book, slugs)
        CONTACTS.write_text(json.dumps(people, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
        CONTACTS.chmod(0o600)
        print(f"{CONTACTS}: {sum(map(len, people['companies'].values()))} contacts at "
              f"{len(people['companies'])} companies (private, never committed)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
