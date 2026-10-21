#!/usr/bin/env python3
"""Generate the static salary site from companies.csv.

    python3 scripts/site.py            # writes _site/
    python3 -m http.server -d _site    # then open http://localhost:8000/es/

The site publishes aggregates only: every number on it comes from at least
lib.MIN_GROUP people. The public CSV stays row-level; a city x role x years
cell of one or two would name a person.

Pages come in English and Spanish under /en/ and /es/. The page's look lives
in web/ (app.js, style.css); this script renders the HTML shell, the map of
Spain and /api/v1/data.json, which serves both the page and agents. Agents
that only read URLs get /llms.txt and /llms-full.txt (markdown, from the same
aggregates through query.py); agents that speak MCP get scripts/mcp_server.py.
Set SITE_URL to the public origin so those pages carry absolute links.
"""
from __future__ import annotations

import collections
import hashlib
import html
import itertools
import json
import math
import os
import shutil
import statistics
import sys
import urllib.request

import lib
import query
import taxonomy

OUT = lib.ROOT / "_site"
WEB = lib.ROOT / "web"
REPO = "https://github.com/pugarte7/spanish-top-tech-companies"
SITE = os.environ.get("SITE_URL", "").rstrip("/")

# Region outlines, fetched once into .cache/ (gitignored is fine: it is
# rebuilt from the pinned URL).
TOPO_URL = "https://unpkg.com/es-atlas@0.6.0/es/autonomous_regions.json"
TOPO = lib.ROOT / ".cache" / "es_autonomous_regions.json"
ES_ATLAS = {
    "Andalucía": "AN", "Aragón": "AR", "Principado de Asturias": "AS",
    "Cantabria": "CB", "Castilla y León": "CL", "Castilla-La Mancha": "CM",
    "Cataluña": "CT", "Comunidad de Madrid": "MD", "Comunitat Valenciana": "VC",
    "Comunidad Valenciana": "VC", "Extremadura": "EX", "Galicia": "GA",
    "Illes Balears": "IB", "Islas Baleares": "IB", "Canarias": "CN",
    "La Rioja": "RI", "Región de Murcia": "MU", "Comunidad Foral de Navarra": "NC",
    "País Vasco": "PV", "Ceuta": "CE", "Melilla": "ML",
}
# The Canaries sit far southwest; slide them into the usual inset corner.
CANARY_SHIFT = (5.5, 7.6)
MAP_W, MAP_H = 600, 470

REGIONS_ES = {
    "AN": "Andalucía", "AR": "Aragón", "AS": "Asturias", "CB": "Cantabria",
    "CE": "Ceuta", "CL": "Castilla y León", "CM": "Castilla-La Mancha",
    "CN": "Canarias", "CT": "Cataluña", "EX": "Extremadura", "GA": "Galicia",
    "IB": "Baleares", "MD": "Madrid", "ML": "Melilla", "MU": "Murcia",
    "NC": "Navarra", "PV": "País Vasco", "RI": "La Rioja", "VC": "C. Valenciana",
}

# A city has no region column on pre-2026-10 rows; this maps the observed
# spellings so the map works before the feed backfills `region`.
CITY_REGION = {
    "barcelona": "CT", "badalona": "CT", "reus": "CT", "girona": "CT",
    "lleida": "CT", "tarragona": "CT", "sabadell": "CT",
    "madrid": "MD", "alcobendas": "MD", "pozuelo de alarcon": "MD",
    "malaga": "AN", "sevilla": "AN", "granada": "AN", "cordoba": "AN",
    "marbella": "AN", "cadiz": "AN", "almeria": "AN", "jaen": "AN",
    "valencia": "VC", "alicante": "VC", "castellon": "VC", "elche": "VC",
    "bilbao": "PV", "san sebastian": "PV", "vitoria": "PV", "donostia": "PV",
    "getxo": "PV", "barakaldo": "PV",
    "zaragoza": "AR", "a coruna": "GA", "vigo": "GA", "santiago": "GA",
    "santiago de compostela": "GA", "oviedo": "AS", "gijon": "AS",
    "pontevedra": "GA", "ourense": "GA", "lugo": "GA", "ferrol": "GA",
    "santander": "CB", "valladolid": "CL", "salamanca": "CL", "leon": "CL",
    "burgos": "CL", "palma": "IB", "palma de mallorca": "IB",
    "las palmas": "CN", "las palmas de gran canaria": "CN",
    "santa cruz de tenerife": "CN", "tenerife": "CN",
    "torrevieja": "VC", "benidorm": "VC",
    "murcia": "MU", "cartagena": "MU", "pamplona": "NC", "logrono": "RI",
    "toledo": "CM", "albacete": "CM", "badajoz": "EX", "ceuta": "CE",
    "melilla": "ML",
}

# The site covers companies whose median base, over every salary on file at
# any role and seniority, reaches this. The CSV keeps the rest.
COMPANY_FLOOR_EUR = 45_000

YEAR_BUCKETS = [(0, 2), (2, 5), (5, 8), (8, 12), (12, 20), (20, None)]
# Histogram bins of 10k; the ends are open so a lone outlier joins a crowd.
HIST_LOW, HIST_HIGH, HIST_STEP = 20_000, 150_000, 10_000

# GitHub's outline star (octicon star-16), the one on its Star button.
STAR_ICON = ('<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 .25a.75.75 0 0 1 '
             '.673.418l1.882 3.815 4.21.612a.75.75 0 0 1 .416 1.279l-3.046 2.97.719 4.192a.751.751 0 0 1-1.088.791'
             'L8 12.347l-3.766 1.98a.75.75 0 0 1-1.088-.79l.72-4.194L.818 6.374a.75.75 0 0 1 .416-1.28l4.21-.611'
             'L7.327.668A.75.75 0 0 1 8 .25Zm0 2.445L6.615 5.5a.75.75 0 0 1-.564.41l-3.097.45 2.24 2.184a.75.75 0 '
             '0 1 .216.664l-.528 3.084 2.769-1.456a.75.75 0 0 1 .698 0l2.77 1.456-.53-3.084a.75.75 0 0 1 .216-.664'
             'l2.24-2.183-3.096-.45a.75.75 0 0 1-.564-.41L8 2.694Z"/></svg>')
GITHUB_ICON = ('<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8'
               'c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94'
               '-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66'
               '.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12'
               ' 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16'
               ' 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01'
               ' 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>')
# Both glyphs ship; the stylesheet shows the moon in light mode and the sun in dark.
THEME_ICON = ('<svg class="moon" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" '
              'd="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
              '<svg class="sun" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" '
              'stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2'
              'M12 20.5v2M1.5 12h2M20.5 12h2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>')

STRINGS = {
    "en": {
        "title": "Spanish Top Tech Companies", "theme": "Light or dark mode",
        "source": "Data: Levels.fyi",
        "floor": "Companies with a median base of 45k+",
        "all_roles": "All roles", "all_years": "Any",
        "years_label": "Experience", "years_unit": "yrs",
        "hero_label": "Median base salary",
        "kpi_total": "Median total comp", "kpi_people": "Salaries",
        "kpi_share": "60k+ base", "kpi_companies": "Companies",
        "map_title": "By region",
        "map_pay": "Median base", "map_count": "Salaries",
        "map_pay_sub": "Median gross yearly base salary of everyone reported in each region.",
        "map_count_sub": "How many salaries were reported in each region.",
        "map_empty": "Fewer than {min} salaries",
        "matrix_title": "Pay by role and experience",
        "matrix_sub": "Median gross yearly base salary for the roles with most data. "
                      "Click a cell to see which companies pay most there.",
        "sum_range": "Middle half earns",
        "companies_title": "Companies",
        "search": "Search",
        "col_company": "Company", "col_median": "Median base salary",
        "fixed": "Base only",
        "col_total": "Median total pay (base + bonus + stock)", "col_n": "Salaries reported",
        "col_share": "Earning 60k+",
        "tip_median": "Gross yearly base salary: half earn more, half earn less",
        "tip_share": "Share of salaries with a base of 60,000 € or more",
        "tip_n": "How many salaries this company has under the filters chosen",
        "fixed_tip": "None of these salaries reports a bonus or stock",
        "fixed_text": "None of its {n} salaries reports a bonus or stock: what you see is all you get.",
        "show_all": "Show all {n}", "show_less": "Show less",
        "none": "No group of {min} or more salaries.",
        "people": "salaries", "median": "Median", "range": "p25–p75",
        "updated": "Updated {date}",
        "data": "JSON", "csv": "CSV", "repo": "GitHub", "web": "Website",
        "star_title": "Finding this useful?",
        "star_text": "Give the repo a star on GitHub. It helps more people find it.",
        "star_button": "Star on GitHub", "star_close": "Close",
        "under": "Under", "over": "Over",
        "role_label": "Role", "mode_label": "Work",
        "mode_remote": "Remote", "mode_hybrid": "Hybrid", "mode_office": "Office",
        "any": "Any", "loading": "Loading…", "from": "From", "to": "To",
    },
    "es": {
        "title": "Spanish Top Tech Companies", "theme": "Modo claro u oscuro",
        "source": "Datos: Levels.fyi",
        "floor": "Empresas con base mediana de 45k+",
        "all_roles": "Todos los roles", "all_years": "Todas",
        "years_label": "Experiencia", "years_unit": "años",
        "hero_label": "Salario base mediano",
        "kpi_total": "Total mediano", "kpi_people": "Salarios",
        "kpi_share": "60k+ de base", "kpi_companies": "Empresas",
        "map_title": "Por comunidad",
        "map_pay": "Base mediana", "map_count": "Salarios",
        "map_pay_sub": "Salario base bruto anual mediano de todos los salarios de cada comunidad.",
        "map_count_sub": "Cuántos salarios se han recogido en cada comunidad.",
        "map_empty": "Menos de {min} salarios",
        "matrix_title": "Sueldo según rol y experiencia",
        "matrix_sub": "Sueldo base bruto anual mediano de los roles con más datos. "
                      "Pulsa una celda para ver qué empresas pagan más en ese caso.",
        "sum_range": "La mitad cobra entre",
        "companies_title": "Empresas",
        "search": "Buscar",
        "col_company": "Empresa", "col_median": "Sueldo base mediano",
        "fixed": "Solo sueldo base",
        "col_total": "Sueldo total mediano (base + bonus + acciones)", "col_n": "Nº de salarios",
        "col_share": "Cobran 60k o más",
        "tip_median": "Salario base bruto anual: la mitad cobra más y la mitad menos",
        "tip_share": "Porcentaje de salarios con una base de 60.000 € o más",
        "tip_n": "Cuántos salarios de esta empresa hay con los filtros elegidos",
        "fixed_tip": "Ninguno de estos salarios declara bonus ni acciones",
        "fixed_text": "Ninguno de sus {n} salarios declara bonus ni acciones: lo que ves es lo que hay.",
        "show_all": "Ver los {n}", "show_less": "Ver menos",
        "none": "Ningún grupo de {min} o más salarios.",
        "people": "salarios", "median": "Mediana", "range": "p25–p75",
        "updated": "Actualizado {date}",
        "data": "JSON", "csv": "CSV", "repo": "GitHub", "web": "Web",
        "star_title": "¿Te está sirviendo?",
        "star_text": "Dale una estrella al repo en GitHub. Ayuda a que lo encuentre más gente.",
        "star_button": "Dar una estrella en GitHub", "star_close": "Cerrar",
        "under": "Menos de", "over": "Más de",
        "role_label": "Rol", "mode_label": "Modalidad",
        "mode_remote": "Remoto", "mode_hybrid": "Híbrido", "mode_office": "Presencial",
        "any": "Cualquiera", "loading": "Cargando…", "from": "Desde", "to": "Hasta",
    },
}


def asset_version(name: str) -> str:
    """A short hash of a file in web/, put in its URL so a browser fetches it
    again whenever it changes instead of running a cached copy."""
    return hashlib.sha256((WEB / name).read_bytes()).hexdigest()[:10]


def year_bucket(years: int | None) -> str | None:
    if years is None:
        return None
    for low, high in YEAR_BUCKETS:
        if years >= low and (high is None or years < high):
            return f"{low}-{high - 1}" if high else f"{low}+"
    return None


def bucket_labels() -> list[str]:
    return [f"{low}-{high - 1}" if high else f"{low}+" for low, high in YEAR_BUCKETS]


def role_info(slug: str) -> dict:
    name, category = taxonomy.ROLES.get(slug, (slug.replace("-", " ").title(), "Other"))
    return {"slug": slug, "name": name, "category": category}


def region_of(entry: dict) -> str | None:
    if entry.get("region"):
        return lib.region_code(entry["region"]) or entry["region"]
    return CITY_REGION.get(lib._norm_words(entry.get("city")))


def histogram(bases: list[int]) -> list[int | None]:
    """Counts per band; a band of one or two people is withheld as None."""
    bands = (HIST_HIGH - HIST_LOW) // HIST_STEP + 2
    counts = [0] * bands
    for b in bases:
        i = 0 if b < HIST_LOW else min(bands - 1, 1 + (b - HIST_LOW) // HIST_STEP)
        counts[i] += 1
    return [c if c == 0 or c >= lib.MIN_GROUP else None for c in counts]


def aggregate(entries: list[dict], hist: bool = False) -> dict | None:
    """Median, quartiles and share at the bar, or None under MIN_GROUP."""
    bases = sorted(e["base"] for e in entries if e.get("base"))
    if len(bases) < lib.MIN_GROUP:
        return None
    totals = [e["total"] for e in entries if e.get("total")]
    p25, _, p75 = statistics.quantiles(bases, n=4, method="inclusive")
    at_bar = sum(1 for b in bases if b >= lib.THRESHOLD_EUR)
    out = {
        "n": len(bases),
        "median": round(statistics.median(bases)),
        "p25": round(p25),
        "p75": round(p75),
        "total": round(statistics.median(totals)) if len(totals) >= lib.MIN_GROUP else None,
        "share": round(at_bar / len(bases), 3),
    }
    if hist:
        out["hist"] = histogram(bases)
    return out


def fixed_pay(entries: list[dict]) -> bool:
    """No salary in the group reports a bonus or stock: total is the base."""
    return all(e.get("total") == e["base"] for e in entries)


def pays_enough(company: dict) -> bool:
    bases = [e["base"] for e in company["entries"] if e.get("base")]
    return bool(bases) and statistics.median(bases) >= COMPANY_FLOOR_EUR


def build_data(companies: list[dict]) -> dict:
    """Every publishable aggregate, keyed "role|region|years" ("" = all)."""
    return _build(companies)[0]


def build_site(companies: list[dict]) -> tuple[dict, dict[str, dict]]:
    """data.json, and the companies table's own files, one per role."""
    data, rows, index = _build(companies)
    return data, company_filters(rows, index)


def _build(companies: list[dict]) -> tuple[dict, list, dict, dict]:
    rows = []
    for i, company in enumerate(companies):
        if not pays_enough(company):
            continue
        for e in company["entries"]:
            if e.get("base"):
                rows.append((i, e.get("role") or "", region_of(e) or "",
                             year_bucket(lib.years(e.get("years_experience"))) or "", e))

    cells: dict[str, list[dict]] = collections.defaultdict(list)
    by_company: dict[str, dict[int, list[dict]]] = collections.defaultdict(
        lambda: collections.defaultdict(list))
    for i, role, region, bucket, e in rows:
        for r in {"", role}:
            for g in {"", region}:
                for y in {"", bucket}:
                    key = f"{r}|{g}|{y}"
                    cells[key].append(e)
                    by_company[key][i].append(e)

    stats = {k: a for k, v in cells.items() if (a := aggregate(v, hist=True))}
    company_stats = {}
    for key in stats:
        found = []
        for i, entries in by_company[key].items():
            if a := aggregate(entries):
                found.append({"c": i, **a})
        found.sort(key=lambda a: (-a["median"], -a["share"]))
        company_stats[key] = found

    role_counts = collections.Counter(r for _, r, _, _, _ in rows if r)
    used = sorted({i for v in company_stats.values() for a in v for i in [a["c"]]})
    index = {old: new for new, old in enumerate(used)}
    for found in company_stats.values():
        for a in found:
            a["c"] = index[a["c"]]

    data = {
        "generated": lib.today_utc().isoformat(),
        "min_group": lib.MIN_GROUP,
        "threshold": lib.THRESHOLD_EUR,
        "company_floor": COMPANY_FLOOR_EUR,
        "hist": {"low": HIST_LOW, "high": HIST_HIGH, "step": HIST_STEP},
        "roles": [role_info(r) for r, _ in role_counts.most_common() if f"{r}||" in stats],
        "years": [b for b in bucket_labels() if f"||{b}" in stats],
        "regions": {code: {"en": name, "es": REGIONS_ES[code]}
                    for code, name in lib.REGIONS.items()},
        "companies": [company_info(companies[i]) for i in used],
        "cells": stats,
        "company_cells": company_stats,
    }
    return data, rows, index


def _subsets(values: list[str]) -> list[tuple[str, ...]]:
    """Every non-empty choice of values, in their own order; all of them is ""."""
    return [c for n in range(1, len(values)) for c in itertools.combinations(values, n)]


def _spans(values: list[str]) -> list[tuple[str, ...]]:
    """Every run of consecutive values, short of all of them."""
    return [tuple(values[i:j]) for i in range(len(values))
            for j in range(i + 1, len(values) + 1) if j - i < len(values)]


def company_filters(rows: list, index: dict) -> dict[str, dict]:
    """The companies table for any role or specialization, any span of
    experience bands and any set of work arrangements.

    One file per role ("" = every role) and per role/specialization, keyed
    "arrangements|bands" (comma-joined, "" = all). Rows are arrays in
    `fields` order: objects would double the size of a file the page has to
    load.

    The page lets a reader pick a span of years and several arrangements, and
    a median of a union cannot be built from the medians of its parts, so
    every combination is aggregated here. Each is still a group of MIN_GROUP
    or more people, the same rule as data.json; region is left out, which
    keeps the files small.
    """
    bands, modes = bucket_labels(), list(lib.WORK_ARRANGEMENTS)
    band_sets = [("",)] + _spans(bands)
    mode_sets = [("",)] + _subsets(modes)
    groups: dict[str, dict[str, dict[int, list]]] = collections.defaultdict(
        lambda: collections.defaultdict(lambda: collections.defaultdict(list)))
    counts = collections.Counter()
    for i, role, _, bucket, e in rows:
        spec = e.get("specialization") or ""
        tables = {"", role, f"{role}/{spec}" if role and spec else ""}
        counts.update(t for t in tables if t)
        mode = e.get("work_arrangement") or ""
        for ms in mode_sets:
            if ms != ("",) and mode not in ms:
                continue
            for bs in band_sets:
                if bs != ("",) and bucket not in bs:
                    continue
                key = f"{','.join(m for m in ms if m)}|{','.join(b for b in bs if b)}"
                for t in tables:
                    groups[t][key][i].append(e)

    files = {}
    fields = ["c", "n", "median", "p25", "p75", "total", "share", "fixed"]
    # The summary above the table: everyone under the same filters, one
    # aggregate per key, with its histogram.
    summary_fields = ["n", "median", "p25", "p75", "share", "hist"]
    for name, cells in groups.items():
        out, summary = {}, {}
        for key, by_company in cells.items():
            if a := aggregate([e for entries in by_company.values() for e in entries], hist=True):
                summary[key] = [a[f] for f in summary_fields]
            found = []
            for i, entries in by_company.items():
                if a := aggregate(entries):
                    a["fixed"] = int(fixed_pay(entries))
                    found.append({"c": index[i], **a})
            if found:
                found.sort(key=lambda a: (-a["median"], -a["share"]))
                out[key] = [[a[f] for f in fields] for a in found]
        if out:
            files[name] = {"fields": fields, "cells": out,
                           "summary_fields": summary_fields, "summary": summary}

    # The role menu, most salaries first, each role with its specializations.
    # Only tables that exist are offered.
    def entry(slug: str, name: str) -> dict:
        return {"slug": slug, "name": name, "n": counts[slug]}
    menu = []
    for role in sorted((t for t in files if t and "/" not in t), key=lambda t: -counts[t]):
        specs = taxonomy.SPECIALIZATIONS.get(role, {})
        item = entry(role, role_info(role)["name"])
        item["specs"] = [entry(t, specs.get(t.split("/")[1], (t.split("/")[1],))[0])
                         for t in sorted((t for t in files if t.startswith(role + "/")),
                                         key=lambda t: -counts[t])]
        menu.append(item)
    files[""]["roles"] = menu
    files[""]["bands"] = bands
    return files


def company_info(company: dict) -> dict:
    cities = collections.Counter(e["city"] for e in company["entries"] if e.get("city"))
    # "-" means checked and there is none. The careers page first: it is where to apply.
    web = next((u for u in (company.get("careers_url"), company.get("website")) if u and u != "-"), None)
    url = web
    if not url and company.get("levels_slug"):
        url = f"https://www.levels.fyi/companies/{company['levels_slug']}/salaries"
    return {"name": company["company"], "url": url, "web": web,
            "levels": company.get("levels_slug"),
            "linkedin": company.get("linkedin_url"),
            "cities": [c for c, _ in cities.most_common(3)]}


# --- Map ---------------------------------------------------------------------

def topojson() -> dict:
    if not TOPO.exists():
        TOPO.parent.mkdir(exist_ok=True)
        with urllib.request.urlopen(TOPO_URL, timeout=30) as r:
            TOPO.write_bytes(r.read())
    return json.loads(TOPO.read_text())


def decoded_regions(topo: dict) -> list[tuple[str, list]]:
    """[(code, polygons)], each polygon a list of rings of (lon, lat)."""
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x, y = x + dx, y + dy
            points.append((x * sx + tx, y * sy + ty))
        arcs.append(points)

    def stitch(indices):
        ring = []
        for i in indices:
            arc = arcs[i] if i >= 0 else arcs[~i][::-1]
            ring += arc[1:] if ring else arc
        return ring

    out = []
    for g in topo["objects"]["autonomous_regions"]["geometries"]:
        code = ES_ATLAS.get(g["properties"].get("name"))
        if not code:
            continue
        polys = g["arcs"] if g["type"] == "MultiPolygon" else [g["arcs"]]
        out.append((code, [[stitch(part) for part in poly] for poly in polys]))
    return out


def project(lon: float, lat: float, code: str) -> tuple[float, float]:
    if code == "CN":
        lon, lat = lon + CANARY_SHIFT[0], lat + CANARY_SHIFT[1]
    return (lon + 4.0) * math.cos(math.radians(39.5)), -lat


def spain_svg() -> str:
    regions = [(code, [[[project(lon, lat, code) for lon, lat in ring] for ring in poly]
                       for poly in polys]) for code, polys in decoded_regions(topojson())]
    xy = [p for _, polys in regions for poly in polys for ring in poly for p in ring]
    minx, maxx = min(p[0] for p in xy), max(p[0] for p in xy)
    miny, maxy = min(p[1] for p in xy), max(p[1] for p in xy)
    pad = 8
    scale = min((MAP_W - 2 * pad) / (maxx - minx), (MAP_H - 2 * pad) / (maxy - miny))
    ox = (minx + maxx) / 2 - MAP_W / (2 * scale)
    oy = (miny + maxy) / 2 - MAP_H / (2 * scale)

    def pt(p):
        return (p[0] - ox) * scale, (p[1] - oy) * scale

    paths = []
    for code, polys in regions:
        d = "".join("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in map(pt, ring)) + "Z"
                    for poly in polys for ring in poly)
        paths.append(f'<path class="region" data-code="{code}" d="{d}"/>')
    return (f'<svg id="map" viewBox="0 0 {MAP_W} {MAP_H}" role="img">'
            f'{"".join(paths)}</svg>')


# --- Page --------------------------------------------------------------------

def strings(lang: str) -> dict:
    return {k: v.replace("{min}", str(lib.MIN_GROUP)) for k, v in STRINGS[lang].items()}


def page(lang: str, svg: str) -> str:
    s = strings(lang)
    e = {k: html.escape(v) for k, v in s.items()}
    other = "es" if lang == "en" else "en"
    levels = '<a href="https://www.levels.fyi" target="_blank" rel="noopener">Levels.fyi</a>'
    lang_links = "".join(
        f'<a class="on" aria-current="page">{code.upper()}</a>' if code == lang
        else f'<a href="/{code}/" hreflang="{code}">{code.upper()}</a>'
        for code in ("es", "en"))
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e['title']}</title>
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f5f5f7" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">
<script>try {{ const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; }} catch (_) {{}}</script>
<link rel="alternate" hreflang="{other}" href="/{other}/">
<link rel="alternate" type="application/json" href="/api/v1/data.json" title="Salary aggregates">
<link rel="alternate" type="text/markdown" href="/llms-full.txt" title="Salary aggregates for agents">
<script type="application/ld+json">{json_ld(lang)}</script>
<link rel="stylesheet" href="/style.css?v={asset_version("style.css")}">
</head>
<body data-lang="{lang}">
<nav class="topbar">
  <div class="topbar-in">
    <a class="brand" href="/{lang}/">{e['title']}</a>
    <div class="topbar-end">
      <a class="icon-btn" href="{REPO}" target="_blank" rel="noopener" title="GitHub" aria-label="GitHub">{GITHUB_ICON}</a>
      <div class="seg" role="group">{lang_links}</div>
      <button class="icon-btn" id="theme" type="button" title="{e['theme']}" aria-label="{e['theme']}">{THEME_ICON}</button>
    </div>
  </div>
</nav>

<header class="hero">
  <p class="eyebrow" id="eyebrow"></p>
  <div class="hero-stat">
    <span class="hero-value" id="k-median"></span>
    <span class="hero-label">{e['hero_label']}</span>
  </div>
  <dl class="stats">
    <div><dt>{e['kpi_total']}</dt><dd id="k-total"></dd></div>
    <div><dt>{e['kpi_share']}</dt><dd id="k-share"></dd></div>
    <div><dt>{e['kpi_people']}</dt><dd id="k-people"></dd></div>
    <div><dt>{e['kpi_companies']}</dt><dd id="k-companies"></dd></div>
  </dl>
  <p class="source">{e['source'].replace('Levels.fyi', levels)} · {e['floor']}</p>
</header>

<main class="bento">
  <section class="tile wide map-tile">
    <div class="tile-head">
      <div><h2>{e['map_title']}</h2><p class="lede" id="map-sub"></p></div>
      <div class="seg" id="map-metric" role="group" aria-label="{e['map_title']}">
        <button data-m="pay">{e['map_pay']}</button><button data-m="count">{e['map_count']}</button>
      </div>
    </div>
    <div class="map-grid">
      <div class="map-box">{svg}<div class="legend" id="legend"></div></div>
      <ol class="ranking" id="ranking"></ol>
    </div>
  </section>

  <section class="tile wide" id="matrix-card">
    <h2>{e['matrix_title']}</h2>
    <p class="lede">{e['matrix_sub']}</p>
    <div class="matrix-wrap"><table class="matrix" id="matrix"></table></div>
    <div class="legend" id="matrix-legend"></div>
  </section>

  <section class="tile wide" id="companies-card">
    <h2>{e['companies_title']}</h2>
    <div class="filter-row">
      <div class="filters" id="filters"></div>
      <input id="search" type="search" placeholder="{e['search']}" aria-label="{e['search']}" autocomplete="off">
    </div>
    <div class="summary" id="summary" aria-live="polite"></div>
    <div class="table-wrap"><table id="companies"></table></div>
    <button class="more" id="more" hidden></button>
  </section>
</main>

<footer>
  <p>{e['source'].replace('Levels.fyi', levels)} · <span id="updated"></span> ·
     <a href="/api/v1/data.json" target="_blank" rel="noopener">{e['data']}</a> ·
     <a href="{REPO}/blob/main/companies.csv" target="_blank" rel="noopener">{e['csv']}</a> ·
     <a href="{REPO}" target="_blank" rel="noopener">{e['repo']}</a></p>
</footer>
<div id="tip" role="tooltip" hidden></div>
<aside class="star-pop" id="star" role="dialog" aria-labelledby="star-title" hidden>
  <button class="star-x" id="star-close" type="button" aria-label="{e['star_close']}">×</button>
  <p class="star-title" id="star-title">{e['star_title']}</p>
  <p class="star-text">{e['star_text']}</p>
  <a class="star-btn" id="star-go" href="{REPO}" target="_blank" rel="noopener" aria-label="{e['star_button']}" title="{e['star_button']}">{STAR_ICON}</a>
</aside>
<script>window.S={json.dumps(s, ensure_ascii=False)};</script>
<script src="/app.js?v={asset_version("app.js")}"></script>
</body>
</html>
"""


def main(argv: list[str]) -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "api" / "v1").mkdir(parents=True)
    svg = spain_svg()
    for lang in ("en", "es"):
        (OUT / lang).mkdir()
        (OUT / lang / "index.html").write_text(page(lang, svg), encoding="utf-8")
    (OUT / "index.html").write_text(
        '<!doctype html><meta charset="utf-8"><script>location.replace('
        '(navigator.language || "").startsWith("es") ? "/es/" : "/en/")</script>'
        '<a href="/es/">ES</a> · <a href="/en/">EN</a>', encoding="utf-8")
    for name in ("app.js", "style.css"):
        shutil.copy(WEB / name, OUT / name)

    data, tables = build_site(lib.load_companies())
    (OUT / "api" / "v1" / "data.json").write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    (OUT / "api" / "v1" / "companies").mkdir()
    for name, table in tables.items():
        path = OUT / "api" / "v1" / "companies" / f"{name or 'all'}.json"
        path.parent.mkdir(exist_ok=True)
        path.write_text(json.dumps(table, ensure_ascii=False, separators=(",", ":")),
                        encoding="utf-8")
    (OUT / "llms.txt").write_text(llms_txt(data), encoding="utf-8")
    (OUT / "llms-full.txt").write_text(llms_full(data), encoding="utf-8")
    print(f"Built _site/: {len(data['companies'])} companies, {len(data['cells'])} cells "
          f"of {lib.MIN_GROUP}+ people.")
    return 0


# --- Agents ------------------------------------------------------------------

def json_ld(lang: str) -> str:
    # Its own wording, not STRINGS: the page copy changes without the dataset changing.
    description = {
        "en": "Median yearly gross salaries in euros of people working in Spain, by role, "
              "region and years of experience, each from 3 or more people.",
        "es": "Salarios brutos anuales medianos en euros de gente que trabaja en España, por "
              "rol, comunidad y años de experiencia, cada uno de 3 personas o más.",
    }[lang]
    dataset = {
        "@context": "https://schema.org", "@type": "Dataset",
        "name": "Spanish Top Tech Companies", "description": description, "inLanguage": lang,
        "url": SITE + "/" if SITE else REPO, "isAccessibleForFree": True,
        "license": "https://creativecommons.org/licenses/by-sa/4.0/",
        "dateModified": lib.today_utc().isoformat(),
        "spatialCoverage": {"@type": "Country", "name": "Spain"},
        "variableMeasured": ["median base salary (EUR)", "median total compensation (EUR)"],
        "distribution": [
            {"@type": "DataDownload", "encodingFormat": "application/json",
             "contentUrl": SITE + "/api/v1/data.json"},
            {"@type": "DataDownload", "encodingFormat": "text/csv",
             "contentUrl": f"{REPO}/blob/main/companies.csv"},
        ],
    }
    return json.dumps(dataset, ensure_ascii=False).replace("</", "<\\/")


def _k(n: int | None) -> str:
    return "-" if n is None else f"{n / 1000:.1f}k"


def _table(head: list[str], rows: list[list]) -> str:
    lines = ["| " + " | ".join(head) + " |", "|" + "---|" * len(head)]
    lines += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(lines)


def _stat_row(label: str, r: dict) -> list:
    return [label, _k(r["median_base_eur"]),
            f"{_k(r['p25_base_eur'])} - {_k(r['p75_base_eur'])}",
            _k(r["median_total_eur"]), f"{round(r['share_at_60k_base'] * 100)}%", r["people"]]


STAT_HEAD = ["", "Median base", "Middle half", "Median total", "60k+ base", "People"]


def llms_txt(data: dict) -> str:
    return f"""# Tech Pay Spain

> What tech and other professional jobs pay in Spain: medians of yearly gross
> salaries in euros, by role, region and years of experience, from Levels.fyi
> submissions and first-hand reports. Every figure comes from {data['min_group']}
> or more people. Data as of {data['generated']}.

Base is gross yearly salary; total adds bonus and stock. Spain only: no
salary from another country is ever mixed in. A selection with fewer than
{data['min_group']} people has no figure; widen it rather than estimate.
{_coverage(data)}
## Data

- [All aggregates for agents (markdown)]({SITE}/llms-full.txt): national, per role, region, experience and the best-paying companies
- [All aggregates (JSON)]({SITE}/api/v1/data.json): `cells["role|region|years"]` (empty part = all) gives n, median, p25, p75, total, share at 60k+; `company_cells` the same per company, `c` indexing `companies`
- [Row-level CSV]({REPO}/blob/main/companies.csv): one salary per row, CC BY-SA 4.0

## Tools

- [MCP server]({SITE}/mcp): Streamable HTTP, no sign-in; or run [mcp_server.py]({REPO}/blob/main/scripts/mcp_server.py) locally over stdio; tools `salary_stats`, `top_companies`, `company_salaries`, `list_filters`
- [Agent skill]({REPO}/tree/main/skills/tech-pay-spain): SKILL.md for Hermes and other agentskills.io agents

## Optional

- [Web page, Spanish]({SITE}/es/)
- [Web page, English]({SITE}/en/)
- [Methodology]({REPO}/blob/main/METHODOLOGY.md)
"""


def _coverage(data: dict) -> str:
    floor = data.get("company_floor")
    if not floor:
        return ""
    return (f"\nOnly companies whose median base, over all their salaries at any role and\n"
            f"seniority, is {_k(floor)} or more are counted, so every figure here leaves\n"
            f"out the lowest-paying employers. Say so when quoting a figure for Spain.\n")


def llms_full(data: dict) -> str:
    parts = [llms_txt(data).split("\n## Data")[0].rstrip()]

    overall = query.stats(data)["result"]
    parts.append("## Spain, every role\n\n" + _table(STAT_HEAD, [_stat_row("All", overall)]))

    rows = [_stat_row(f"{r['name']} (`{r['slug']}`)", res)
            for r in data["roles"] if (res := query.stats(data, role=r["slug"])["result"])]
    parts.append("## By role\n\n" + _table(STAT_HEAD, rows))

    rows = [_stat_row(f"{names['es']} (`{code}`)", res) for code, names in data["regions"].items()
            if (res := query.stats(data, region=code)["result"])]
    rows.sort(key=lambda r: -r[-1])
    parts.append("## By region\n\n" + _table(STAT_HEAD, rows))

    for role in ("", "software-engineer"):
        rows = [_stat_row(f"{y} years", res) for y in data["years"]
                if (res := query.stats(data, role=role, years=y)["result"])]
        title = "software engineers" if role else "every role"
        parts.append(f"## By years of experience, {title}\n\n" + _table(STAT_HEAD, rows))

    head = ["Company", "Median base", "Median total", "60k+ base", "People"]
    for role, title in (("", "every role"), ("software-engineer", "software engineers")):
        top = query.top_companies(data, role=role, limit=50)["result"]
        rows = [[f"[{c['company']}]({c['url']})" if c["url"] else c["company"],
                 _k(c["median_base_eur"]), _k(c["median_total_eur"]),
                 f"{round(c['share_at_60k_base'] * 100)}%", c["people"]] for c in top]
        parts.append(f"## Best-paying companies, {title} (top {len(rows)})\n\n"
                     + _table(head, rows))

    parts.append("Narrower selections (a role in a region, a company by role) are in "
                 f"[data.json]({SITE}/api/v1/data.json) and through the MCP server.")
    return "\n\n".join(parts) + "\n"

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
