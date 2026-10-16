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
import html
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

YEAR_BUCKETS = [(0, 2), (2, 5), (5, 8), (8, 12), (12, 20), (20, None)]
# Histogram bins of 10k; the ends are open so a lone outlier joins a crowd.
HIST_LOW, HIST_HIGH, HIST_STEP = 20_000, 150_000, 10_000

STRINGS = {
    "en": {
        "title": "Tech salaries in Spain",
        "source": "Data: Levels.fyi",
        "all_roles": "All roles", "all_years": "Any",
        "years_label": "Experience", "years_unit": "yrs",
        "hero_label": "Median base salary",
        "kpi_total": "Median total comp", "kpi_people": "Salaries",
        "kpi_share": "60k+ base", "kpi_companies": "Companies",
        "map_title": "Median base by region",
        "map_empty": "Fewer than {min} salaries",
        "years_title": "Median base by years of experience",
        "hist_title": "Base salary distribution",
        "roles_title": "Median base by role",
        "companies_title": "Companies",
        "search": "Search",
        "col_company": "Company", "col_median": "Median base",
        "col_vs": "vs market", "col_total": "Total", "col_n": "Salaries",
        "col_share": "60k+",
        "vs_tip": "Median of each salary against the Spain median for its role and years",
        "show_all": "Show all {n}", "show_less": "Show less",
        "none": "No group of {min} or more salaries.",
        "people": "salaries", "median": "Median", "range": "p25–p75",
        "updated": "Updated {date}",
        "data": "JSON", "csv": "CSV", "repo": "GitHub",
        "under": "Under", "over": "Over",
    },
    "es": {
        "title": "Salarios tech en España",
        "source": "Datos: Levels.fyi",
        "all_roles": "Todos los roles", "all_years": "Todas",
        "years_label": "Experiencia", "years_unit": "años",
        "hero_label": "Salario base mediano",
        "kpi_total": "Total mediano", "kpi_people": "Salarios",
        "kpi_share": "60k+ de base", "kpi_companies": "Empresas",
        "map_title": "Base mediana por comunidad",
        "map_empty": "Menos de {min} salarios",
        "years_title": "Base mediana por años de experiencia",
        "hist_title": "Distribución de la base",
        "roles_title": "Base mediana por rol",
        "companies_title": "Empresas",
        "search": "Buscar",
        "col_company": "Empresa", "col_median": "Base mediana",
        "col_vs": "vs mercado", "col_total": "Total", "col_n": "Salarios",
        "col_share": "60k+",
        "vs_tip": "Mediana de cada salario frente a la mediana de España para su rol y años",
        "show_all": "Ver los {n}", "show_less": "Ver menos",
        "none": "Ningún grupo de {min} o más salarios.",
        "people": "salarios", "median": "Mediana", "range": "p25–p75",
        "updated": "Actualizado {date}",
        "data": "JSON", "csv": "CSV", "repo": "GitHub",
        "under": "Menos de", "over": "Más de",
    },
}


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


def build_data(companies: list[dict]) -> dict:
    """Every publishable aggregate, keyed "role|region|years" ("" = all)."""
    rows = []
    for i, company in enumerate(companies):
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
    # "vs market": each salary against the Spain-wide median of its own role
    # and years, so a company of juniors is not read as one that pays less.
    market = {}
    for _, role, _, bucket, e in rows:
        reference = stats.get(f"{role}||{bucket}") if role and bucket else None
        if reference:
            market[id(e)] = e["base"] / reference["median"]
    company_stats = {}
    for key in stats:
        found = []
        for i, entries in by_company[key].items():
            if a := aggregate(entries):
                ratios = [market[id(e)] for e in entries if id(e) in market]
                a["vs"] = (round(statistics.median(ratios) - 1, 3)
                           if len(ratios) >= lib.MIN_GROUP else None)
                found.append({"c": i, **a})
        found.sort(key=lambda a: (-a["median"], -a["share"]))
        company_stats[key] = found

    role_counts = collections.Counter(r for _, r, _, _, _ in rows if r)
    used = sorted({i for v in company_stats.values() for a in v for i in [a["c"]]})
    index = {old: new for new, old in enumerate(used)}
    for found in company_stats.values():
        for a in found:
            a["c"] = index[a["c"]]

    return {
        "generated": lib.today_utc().isoformat(),
        "min_group": lib.MIN_GROUP,
        "threshold": lib.THRESHOLD_EUR,
        "hist": {"low": HIST_LOW, "high": HIST_HIGH, "step": HIST_STEP},
        "roles": [role_info(r) for r, _ in role_counts.most_common() if f"{r}||" in stats],
        "years": [b for b in bucket_labels() if f"||{b}" in stats],
        "regions": {code: {"en": name, "es": REGIONS_ES[code]}
                    for code, name in lib.REGIONS.items()},
        "companies": [company_info(companies[i]) for i in used],
        "cells": stats,
        "company_cells": company_stats,
    }


def company_info(company: dict) -> dict:
    cities = collections.Counter(e["city"] for e in company["entries"] if e.get("city"))
    url = company.get("careers_url") or company.get("website")
    if not url and company.get("levels_slug"):
        url = f"https://www.levels.fyi/companies/{company['levels_slug']}/salaries"
    return {"name": company["company"], "url": url,
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
    levels = '<a href="https://www.levels.fyi" rel="noopener">Levels.fyi</a>'
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e['title']}</title>
<meta name="color-scheme" content="light">
<meta name="theme-color" content="#f5f5f7">
<link rel="alternate" hreflang="{other}" href="/{other}/">
<link rel="alternate" type="application/json" href="/api/v1/data.json" title="Salary aggregates">
<link rel="alternate" type="text/markdown" href="/llms-full.txt" title="Salary aggregates for agents">
<script type="application/ld+json">{json_ld(lang)}</script>
<link rel="stylesheet" href="/style.css">
</head>
<body data-lang="{lang}">
<nav class="bar">
  <div class="bar-in">
    <a class="brand" href="/{lang}/">{e['title']}</a>
    <div class="controls">
      <label class="pill-select"><select id="f-role" aria-label="{e['all_roles']}"></select></label>
      <div class="seg" id="f-years" role="group" aria-label="{e['years_label']}"></div>
      <button class="chip" id="f-region" hidden></button>
    </div>
    <a class="lang" href="/{other}/" hreflang="{other}">{other.upper()}</a>
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
  <p class="source">{e['source'].replace('Levels.fyi', levels)}</p>
</header>

<main class="bento">
  <section class="tile wide map-tile">
    <h2>{e['map_title']}</h2>
    <div class="map-grid">
      <div class="map-box">{svg}<div class="legend" id="legend"></div></div>
      <ol class="ranking" id="ranking"></ol>
    </div>
  </section>

  <section class="tile">
    <h2>{e['years_title']}</h2>
    <div id="years-chart" class="chart"></div>
  </section>
  <section class="tile">
    <h2>{e['hist_title']}</h2>
    <div id="hist-chart" class="chart"></div>
  </section>

  <section class="tile wide" id="roles-card" hidden>
    <h2>{e['roles_title']}</h2>
    <div id="roles-chart"></div>
    <button class="more" id="roles-more" hidden></button>
  </section>

  <section class="tile wide">
    <div class="tile-head">
      <h2>{e['companies_title']}</h2>
      <input id="search" type="search" placeholder="{e['search']}" autocomplete="off">
    </div>
    <div class="table-wrap"><table id="companies"></table></div>
    <button class="more" id="more" hidden></button>
  </section>
</main>

<footer>
  <p>{e['source'].replace('Levels.fyi', levels)} · <span id="updated"></span> ·
     <a href="/api/v1/data.json">{e['data']}</a> ·
     <a href="{REPO}/blob/main/companies.csv">{e['csv']}</a> ·
     <a href="{REPO}">{e['repo']}</a></p>
</footer>
<div id="tip" role="tooltip" hidden></div>
<script>window.S={json.dumps(s, ensure_ascii=False)};</script>
<script src="/app.js"></script>
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

    data = build_data(lib.load_companies())
    (OUT / "api" / "v1" / "data.json").write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
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
        "name": "Tech Pay Spain", "description": description, "inLanguage": lang,
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
