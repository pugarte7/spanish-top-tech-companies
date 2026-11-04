"""The pages search engines land on: one per role, region, role in a region
and company, in Spanish and English, written as static HTML from data.json.

The home page draws everything with JavaScript from the JSON, so a search
engine saw one page per language answering "best-paying tech companies" and
nothing for "salario programador", "cuánto cobra un programador" or
"software engineer salary madrid", which is what people type (Google Trends
and autocomplete, 2026-11-04; docs/CONTEXT.md, "Search traffic"). These
pages answer those in their first line with the figure itself.

Every figure here is a cell data.json already publishes: groups of
lib.MIN_GROUP or more people, rounded to lib.ROUND_EUR. Nothing reaches
below that, so a company page exists only for a company with MIN_GROUP
salaries, and lists only its roles and regions that have as many.

This module writes content only. site.py owns the page around it (head,
top bar, footer) and passes it in as `shell`.
"""
from __future__ import annotations

import html
import json
import unicodedata

import lib

SECTION = {"es": "salarios", "en": "salaries"}
COMPANIES = {"es": "empresas", "en": "companies"}

# How Spanish searches name each role. Levels.fyi's names are English, and
# nobody in Spain types "Software Engineer salario": they type "programador".
ROLE_ES = {
    "software-engineer": "programador",
    "data-scientist": "data scientist",
    "product-manager": "product manager",
    "software-engineering-manager": "engineering manager",
    "product-designer": "diseñador de producto",
    "solution-architect": "arquitecto de soluciones",
    "sales": "comercial",
    "data-analyst": "analista de datos",
    "project-manager": "jefe de proyecto",
    "business-analyst": "analista de negocio",
    "technical-program-manager": "technical program manager",
    "program-manager": "program manager",
    "accountant": "contable",
    "management-consultant": "consultor",
    "marketing": "profesional de marketing",
    "recruiter": "recruiter",
    "human-resources": "técnico de recursos humanos",
    "customer-service": "agente de atención al cliente",
    "bizops-manager": "business operations manager",
    "information-technologist": "técnico de sistemas",
    "security-analyst": "analista de ciberseguridad",
    "data-science-manager": "data science manager",
    "sales-engineer": "ingeniero de preventa",
    "financial-analyst": "analista financiero",
    "business-development": "business developer",
    "marketing-operations": "marketing operations",
    "mechanical-engineer": "ingeniero mecánico",
    "customer-success": "customer success manager",
    "hardware-engineer": "ingeniero de hardware",
    "ux-researcher": "UX researcher",
}
# The other words people use for the same job, said once on the page.
ROLE_ALSO = {
    "software-engineer": {"es": "desarrollador, ingeniero de software o software engineer",
                          "en": "software developer or programmer"},
    "data-scientist": {"es": "científico de datos"},
    "software-engineering-manager": {"es": "responsable de ingeniería", "en": "engineering manager"},
    "product-designer": {"es": "product designer o diseñador UX/UI", "en": "UX/UI designer"},
    "sales": {"es": "ventas", "en": "account executive"},
    "information-technologist": {"es": "técnico IT", "en": "IT specialist"},
}
# The city a region is searched by, where it is not the region's own name.
CITY = {"CT": "Barcelona", "VC": "Valencia", "PV": "Bilbao", "AR": "Zaragoza",
        "AN": {"es": "Málaga, Sevilla", "en": "Málaga, Seville"}, "GA": "Vigo, A Coruña",
        "CL": "Valladolid, León", "AS": "Oviedo, Gijón"}
# Names as they are searched, where data.json's differ ("software engineer
# salary madrid", not "community of madrid").
REGION_NAME = {"VC": {"es": "Comunidad Valenciana"}, "MD": {"en": "Madrid"}}
YEARS = {"es": {"0-1": "0–1 años", "2-4": "2–4 años", "5-7": "5–7 años", "8-11": "8–11 años",
                "12-19": "12–19 años", "20+": "20 años o más"},
         "en": {"0-1": "0–1 years", "2-4": "2–4 years", "5-7": "5–7 years", "8-11": "8–11 years",
                "12-19": "12–19 years", "20+": "20+ years"}}
TOP = 15

T = {
    "es": {
        "hub_title": "Salarios tech en España ({year}): por rol, comunidad y empresa",
        "hub_h1": "Salarios tech en España",
        "hub_lede": "Cuánto se cobra en tecnología en España según el rol, la comunidad autónoma y la "
                    "empresa, con {n} salarios reales de Levels.fyi.",
        "hub_desc": "Sueldos tech en España por rol, comunidad y empresa: cuánto cobra un programador, "
                    "un data scientist o un product manager, en Madrid, Barcelona y el resto.",
        "by_role": "Por rol", "by_region": "Por comunidad", "by_company": "Por empresa",
        "role_h1": "Salario de {role} en España ({year})",
        "role_title": "Salario de {role} en España ({year}): cuánto cobra por empresa y experiencia",
        "role_title_swe": "Salario de programador en España ({year}): cuánto cobra un software engineer",
        "role_desc": "Un {role} cobra en España {median} brutos al año de sueldo base mediano; la mitad "
                     "cobra entre {p25} y {p75}. Por experiencia, comunidad y empresa, con {n} salarios reales.",
        "region_h1": "Salarios tech en {place} ({year})",
        "region_title": "Salarios tech en {place} ({year}): cuánto se cobra por rol y empresa",
        "region_desc": "En {place} el sueldo base mediano en tecnología es de {median} brutos al año. "
                       "Cuánto cobra un programador y cada rol, y qué empresas pagan más, con {n} salarios reales.",
        "rr_h1": "Salario de {role} en {place} ({year})",
        "rr_title": "Salario de {role} en {place} ({year}): por empresa y experiencia",
        "rr_desc": "Un {role} cobra en {place} {median} brutos al año de sueldo base mediano; la mitad "
                   "cobra entre {p25} y {p75}. Por experiencia y empresa, con {n} salarios reales.",
        "co_h1": "Sueldos en {company} España ({year})",
        "co_title": "Sueldos en {company} España ({year}): cuánto paga por rol",
        "co_title_swe": "Sueldos en {company} España ({year}): cuánto paga a un programador",
        "co_desc": "{company} paga en España un sueldo base mediano de {median} brutos al año, con "
                   "{total} de total con bonus y acciones. Por rol, comunidad y experiencia, con {n} salarios.",
        "median": "Sueldo base mediano", "range": "La mitad cobra entre", "total": "Total mediano con bonus y acciones",
        "share": "Cobran {bar} o más de base", "n": "Salarios",
        "col_years": "Experiencia", "col_role": "Rol", "col_region": "Comunidad", "col_company": "Empresa",
        "col_median": "Base mediana", "col_range": "p25–p75", "col_total": "Total", "col_n": "Salarios",
        "t_years": "Según la experiencia", "t_regions": "Por comunidad", "t_roles": "Por rol",
        "t_companies": "Las empresas que más pagan", "t_faq": "Preguntas frecuentes",
        "t_more": "Más salarios", "t_links": "La empresa",
        "web": "Web", "linkedin": "LinkedIn", "levels": "Levels.fyi", "cities": "Oficinas en España",
        "cta": "Ver en el ranking interactivo",
        "home": "Inicio", "source": "Datos: salarios de Levels.fyi de gente que trabaja en España, "
                                    "agrupados de {min} en {min} o más y redondeados a 1.000 €. Actualizado el {date}.",
        "q_pay": "¿Cuánto cobra un {role} en España?",
        "a_pay": "El sueldo base mediano de un {role} en España es de {median} brutos al año: "
                 "{m12} al mes en 12 pagas o {m14} en 14. La mitad cobra entre {p25} y {p75}, y con bonus "
                 "y acciones el total mediano es de {total}. Sale de {n} salarios reales.",
        "q_junior": "¿Cuánto cobra un {role} junior en España?",
        "a_junior": "Con {years} de experiencia, el sueldo base mediano es de {median} brutos al año "
                    "({m14} al mes en 14 pagas).",
        "q_senior": "¿Cuánto cobra un {role} senior en España?",
        "a_senior": "Con {years} de experiencia, el sueldo base mediano es de {median} brutos al año, "
                    "y la mitad cobra entre {p25} y {p75}.",
        "q_where": "¿Dónde cobra más un {role} en España?",
        "a_where": "Por sueldo base mediano: {list}.",
        "q_who": "¿Qué empresas pagan más a un {role} en España?",
        "a_who": "Las que más pagan, por sueldo base mediano: {list}.",
        "q_who_place": "¿Qué empresas tech pagan más en {place}?",
        "swe_in": "Salario de programador por comunidad",
        "also": "También se le llama {also}.",
        "q_place": "¿Cuánto se cobra en tecnología en {place}?",
        "a_place": "El sueldo base mediano en {place} es de {median} brutos al año, y la mitad cobra "
                   "entre {p25} y {p75}. Un {bar} o más lo cobra el {share} de la gente.",
        "q_co": "¿Cuánto paga {company} en España?",
        "a_co": "{company} paga un sueldo base mediano de {median} brutos al año en España, y "
                "{total} de total con bonus y acciones. Sale de {n} salarios.",
        "q_co_role": "¿Cuánto paga {company} a un {role} en España?",
        "a_co_role": "Un sueldo base mediano de {median} brutos al año, con {n} salarios.",
        "home_faq": "Lo que más se pregunta",
        "guides": "Salarios por rol, comunidad y empresa",
        "all": "Ver todos",
    },
    "en": {
        "hub_title": "Tech Salaries in Spain ({year}): by Role, Region and Company",
        "hub_h1": "Tech salaries in Spain",
        "hub_lede": "What tech pays in Spain by role, region and company, from {n} real salaries on Levels.fyi.",
        "hub_desc": "Tech salaries in Spain by role, region and company: software engineer, data "
                    "scientist and product manager pay in Madrid, Barcelona and the rest of Spain.",
        "by_role": "By role", "by_region": "By region", "by_company": "By company",
        "role_h1": "{role} salary in Spain ({year})",
        "role_title": "{role} Salary in Spain ({year}): Pay by Company and Experience",
        "role_title_swe": "Software Engineer Salary in Spain ({year}): Pay by Company, City and Experience",
        "role_desc": "The median {role} base salary in Spain is {median} a year gross; half earn between "
                     "{p25} and {p75}. By experience, region and company, from {n} real salaries.",
        "region_h1": "Tech salaries in {place}, Spain ({year})",
        "region_title": "Tech Salaries in {place}, Spain ({year}): Pay by Role and Company",
        "region_desc": "The median tech base salary in {place} is {median} a year gross. What software "
                       "engineers and every role earn, and which companies pay most, from {n} real salaries.",
        "rr_h1": "{role} salary in {place}, Spain ({year})",
        "rr_title": "{role} Salary in {place}, Spain ({year}): Pay by Company and Experience",
        "rr_desc": "The median {role} base salary in {place} is {median} a year gross; half earn between "
                   "{p25} and {p75}. By experience and company, from {n} real salaries.",
        "co_h1": "{company} salaries in Spain ({year})",
        "co_title": "{company} Salaries in Spain ({year}): Pay by Role",
        "co_title_swe": "{company} Software Engineer Salary in Spain ({year})",
        "co_desc": "{company} pays a median base salary of {median} a year gross in Spain, {total} "
                   "in total pay with bonus and stock. By role, region and experience, from {n} salaries.",
        "median": "Median base salary", "range": "Half earn between", "total": "Median total pay with bonus and stock",
        "share": "Earn {bar} or more in base", "n": "Salaries",
        "col_years": "Experience", "col_role": "Role", "col_region": "Region", "col_company": "Company",
        "col_median": "Median base", "col_range": "p25–p75", "col_total": "Total", "col_n": "Salaries",
        "t_years": "By experience", "t_regions": "By region", "t_roles": "By role",
        "t_companies": "The companies that pay most", "t_faq": "Frequently asked questions",
        "t_more": "More salaries", "t_links": "The company",
        "web": "Website", "linkedin": "LinkedIn", "levels": "Levels.fyi", "cities": "Offices in Spain",
        "cta": "Open the interactive ranking",
        "home": "Home", "source": "Data: Levels.fyi salaries of people working in Spain, in groups of "
                                  "{min} or more, rounded to €1,000. Updated {date}.",
        "q_pay": "What is the average {role} salary in Spain?",
        "a_pay": "The median {role} base salary in Spain is {median} a year gross, about {m12} a month. "
                 "Half earn between {p25} and {p75}, and with bonus and stock the median total is {total}. "
                 "From {n} real salaries.",
        "q_junior": "What does a junior {role} earn in Spain?",
        "a_junior": "With {years} of experience the median base salary is {median} a year gross.",
        "q_senior": "What does a senior {role} earn in Spain?",
        "a_senior": "With {years} of experience the median base salary is {median} a year gross, and "
                    "half earn between {p25} and {p75}.",
        "q_where": "Where in Spain do {role}s earn most?",
        "a_where": "By median base salary: {list}.",
        "q_who": "Which companies pay {role}s most in Spain?",
        "a_who": "The best-paying, by median base salary: {list}.",
        "q_who_place": "Which tech companies pay most in {place}?",
        "swe_in": "{role} salary by region",
        "also": "Also called {also}.",
        "q_place": "What does tech pay in {place}?",
        "a_place": "The median base salary in {place} is {median} a year gross, and half earn between "
                   "{p25} and {p75}. {share} of people earn {bar} or more.",
        "q_co": "How much does {company} pay in Spain?",
        "a_co": "{company} pays a median base salary of {median} a year gross in Spain, and {total} in "
                "total pay with bonus and stock. From {n} salaries.",
        "q_co_role": "What is the {company} {role} salary in Spain?",
        "a_co_role": "A median base salary of {median} a year gross, from {n} salaries.",
        "home_faq": "What people ask",
        "guides": "Salaries by role, region and company",
        "all": "See all",
    },
}


def slug(text: str) -> str:
    text = "".join(c for c in unicodedata.normalize("NFD", text.lower()) if not unicodedata.combining(c))
    return "-".join("".join(c if c.isalnum() else " " for c in text).split())


def eur(n: int, lang: str) -> str:
    return f"{n:,} €".replace(",", ".") if lang == "es" else f"€{n:,}"


def pct(share: float, lang: str) -> str:
    return f"{round(share * 100)} %" if lang == "es" else f"{round(share * 100)}%"


class Site:
    """data.json read once into what the pages need: names, paths and lookups."""

    def __init__(self, data: dict):
        self.data = data
        self.year = (data.get("data_as_of") or "")[:4]
        self.cells = data["cells"]
        self.companies = data["companies"]
        self.roles = {r["slug"]: r for r in data["roles"]}
        # company_cells: key -> {company index: cell}
        self.cc = {k: {x["c"]: x for x in v} for k, v in data.get("company_cells", {}).items()}
        self.role_slugs = sorted((r for r in self.roles if self.cell(r)), key=lambda r: -self.cell(r)["n"])
        self.region_codes = sorted((g for g in data["regions"] if self.cell("", g)),
                                   key=lambda g: -self.cell("", g)["n"])
        self.listed = sorted(self.cc.get("||", {}), key=lambda c: self.companies[c]["name"].lower())
        self.co_slug = {c: slug(self.companies[c].get("levels") or self.companies[c]["name"]) for c in self.listed}

    def cell(self, role: str = "", region: str = "", years: str = "") -> dict | None:
        return self.cells.get(f"{role}|{region}|{years}")

    def company_cells(self, role: str = "", region: str = "", years: str = "") -> dict:
        return self.cc.get(f"{role}|{region}|{years}", {})

    # --- names ---
    def role(self, r: str, lang: str) -> str:
        return ROLE_ES.get(r, self.roles[r]["name"]) if lang == "es" else self.roles[r]["name"]

    def role_heading(self, r: str, lang: str) -> str:
        name = self.role(r, lang)
        return name[:1].upper() + name[1:]

    def region(self, g: str, lang: str) -> str:
        return REGION_NAME.get(g, {}).get(lang) or self.data["regions"][g][lang]

    def place(self, g: str, lang: str) -> str:
        """Madrid, or Cataluña (Barcelona): the region with the city people search."""
        city = CITY.get(g)
        city = city.get(lang) if isinstance(city, dict) else city
        return f"{self.region(g, lang)} ({city})" if city else self.region(g, lang)

    def title_place(self, g: str, lang: str) -> str:
        """Barcelona y Cataluña: a region's one searched city first, for titles."""
        city = CITY.get(g)
        if not isinstance(city, str) or "," in city:
            return self.region(g, lang)
        return f"{city} {'y' if lang == 'es' else 'and'} {self.region(g, lang)}"

    # --- paths ---
    def hub(self, lang: str) -> str:
        return f"/{lang}/{SECTION[lang]}/"

    def role_path(self, r: str, lang: str, g: str = "") -> str:
        return self.hub(lang) + f"{r}/" + (f"{slug(self.region(g, lang))}/" if g else "")

    def region_path(self, g: str, lang: str) -> str:
        return self.hub(lang) + f"{slug(self.region(g, lang))}/"

    def company_path(self, c: int, lang: str) -> str:
        return f"/{lang}/{COMPANIES[lang]}/{self.co_slug[c]}/"

    def has_company_page(self, c: int) -> bool:
        return c in self.co_slug


def both(fn) -> dict:
    return {lang: fn(lang) for lang in ("es", "en")}


def fill(text: str, **kw) -> str:
    for k, v in kw.items():
        text = text.replace("{" + k + "}", str(v))
    return text


def figures(cell: dict, lang: str) -> dict:
    return {"median": eur(cell["median"], lang), "p25": eur(cell["p25"], lang), "p75": eur(cell["p75"], lang),
            "total": eur(cell["total"], lang), "n": f"{cell['n']:,}".replace(",", "." if lang == "es" else ","),
            "share": pct(cell["share"], lang), "bar": eur(lib.THRESHOLD_EUR, lang),
            # Monthly gross from the rounded yearly figure, to the nearest 10.
            "m12": eur(int(round(cell["median"] / 12, -1)), lang), "m14": eur(int(round(cell["median"] / 14, -1)), lang)}


# --- HTML pieces ---------------------------------------------------------------

def esc(s) -> str:
    return html.escape(str(s))


def link(href: str, text: str) -> str:
    return f'<a href="{esc(href)}">{esc(text)}</a>'


def hero(cell: dict, lang: str) -> str:
    t, f = T[lang], figures(cell, lang)
    return f"""<article class="hero-card guide-card" aria-label="{esc(t['median'])}">
    <div class="hero-card-head"><span>{esc(t['median'])}</span></div>
    <p class="hero-median">{esc(f['median'])}</p>
    <p class="guide-range">{esc(t['range'])} <b>{esc(f['p25'])}</b> – <b>{esc(f['p75'])}</b></p>
    <dl class="hero-stats">
      <div><dt>{esc(fill(t['share'], bar=f['bar']))}</dt><dd>{esc(f['share'])}</dd></div>
      <div><dt>{esc(t['total'])}</dt><dd>{esc(f['total'])}</dd></div>
      <div><dt>{esc(t['n'])}</dt><dd>{esc(f['n'])}</dd></div>
    </dl>
  </article>"""


def table(lang: str, first: str, rows: list[tuple[str, dict]], total: bool = True) -> str:
    """rows: (label html, cell). Label is already HTML (it may be a link)."""
    t = T[lang]
    head = f"<th>{esc(t[first])}</th><th class='num'>{esc(t['col_median'])}</th><th class='num'>{esc(t['col_range'])}</th>"
    head += (f"<th class='num'>{esc(t['col_total'])}</th>" if total else "") + f"<th class='num'>{esc(t['col_n'])}</th>"
    body = ""
    for label, c in rows:
        f = figures(c, lang)
        body += (f"<tr><td>{label}</td><td class='num'><b>{esc(f['median'])}</b></td>"
                 f"<td class='num'>{esc(f['p25'])} – {esc(f['p75'])}</td>"
                 + (f"<td class='num'>{esc(f['total'])}</td>" if total else "")
                 + f"<td class='num'>{esc(f['n'])}</td></tr>")
    return f'<div class="table-wrap"><table class="guide-table"><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def tile(title: str, body: str, lede: str = "") -> str:
    lede = f'<p class="lede">{esc(lede)}</p>' if lede else ""
    return f'<section class="tile wide"><h2>{esc(title)}</h2>{lede}{body}</section>'


def faq_html(lang: str, qa: list[tuple[str, str]]) -> str:
    items = "".join(f"<div><dt>{esc(q)}</dt><dd>{esc(a)}</dd></div>" for q, a in qa)
    return tile(T[lang]["t_faq"], f'<dl class="faq">{items}</dl>')


def faq_ld(qa: list[tuple[str, str]]) -> dict:
    return {"@context": "https://schema.org", "@type": "FAQPage",
            "mainEntity": [{"@type": "Question", "name": q,
                            "acceptedAnswer": {"@type": "Answer", "text": a}} for q, a in qa]}


def crumbs_ld(public: str, crumbs: list[tuple[str, str]]) -> dict:
    return {"@context": "https://schema.org", "@type": "BreadcrumbList",
            "itemListElement": [{"@type": "ListItem", "position": i + 1, "name": name, "item": public + path}
                                for i, (name, path) in enumerate(crumbs)]}


def link_list(items: list[tuple[str, str]], cls: str = "guide-links") -> str:
    return f'<ul class="{cls}">' + "".join(f"<li>{link(h, t)}</li>" for h, t in items) + "</ul>"


def listing(lang: str, names: list[str]) -> str:
    if len(names) < 2:
        return "".join(names)
    joiner = " y " if lang == "es" else " and "
    return ", ".join(names[:-1]) + joiner + names[-1]


# --- pages -----------------------------------------------------------------------

class Builder:
    def __init__(self, data: dict, shell, public: str):
        self.s = Site(data)
        self.shell = shell
        self.public = public
        self.pages: list[dict] = []  # {"paths": {lang: path}, "html": {lang: str}}

    def add(self, paths: dict, render) -> None:
        self.pages.append({"paths": paths, "html": {lang: render(lang, paths) for lang in paths}})

    def page(self, lang: str, paths: dict, *, title: str, desc: str, h1: str, lede: str,
             cell: dict | None, crumbs: list[tuple[str, str]], body: list[str],
             qa: list[tuple[str, str]], cta: str) -> str:
        t, s = T[lang], self.s
        crumbs = [(t["home"], f"/{lang}/")] + crumbs
        nav = " › ".join(link(p, n) for n, p in crumbs[:-1]) + f" › <span>{esc(crumbs[-1][0])}</span>"
        date = s.data.get("data_as_of", "")
        head = f"""<div class="pitch veil">
    <nav class="crumbs" aria-label="breadcrumb">{nav}</nav>
    <h1>{esc(h1)}</h1>
    <p class="hero-lede">{esc(lede)}</p>
    <nav class="cta"><a class="btn main wide" href="{esc(cta)}">{esc(t['cta'])}</a></nav>
  </div>
  {hero(cell, lang) if cell else ''}"""
        main = "".join(body) + (faq_html(lang, qa) if qa else "")
        main += f'<p class="guide-source">{esc(fill(t["source"], min=lib.MIN_GROUP, date=date))}</p>'
        ld = [crumbs_ld(self.public, crumbs)] + ([faq_ld(qa)] if qa else [])
        return self.shell(lang=lang, path=paths[lang], alternates=paths, title=title, description=desc,
                          header=head, main=main, ld=ld)

    # The rows of the tables every page has.
    def years_rows(self, lang: str, role: str = "", region: str = "") -> list:
        return [(esc(YEARS[lang][y]), c) for y in self.s.data["years"]
                if (c := self.s.cell(role, region, y))]

    def company_rows(self, lang: str, role: str = "", region: str = "", limit: int = TOP) -> list:
        s = self.s
        got = sorted(s.company_cells(role, region).items(), key=lambda kv: (-kv[1]["median"], -kv[1]["n"]))
        return [(link(s.company_path(c, lang), s.companies[c]["name"]) if s.has_company_page(c)
                 else esc(s.companies[c]["name"]), cell) for c, cell in got[:limit]]

    def top_names(self, role: str = "", region: str = "", k: int = 3) -> list[str]:
        got = sorted(self.s.company_cells(role, region).items(), key=lambda kv: (-kv[1]["median"], -kv[1]["n"]))
        return [self.s.companies[c]["name"] for c, _ in got[:k]]

    def related(self, lang: str, skip_role: str = "", skip_region: str = "") -> str:
        s, t = self.s, T[lang]
        roles = [(s.role_path(r, lang), s.role_heading(r, lang)) for r in s.role_slugs[:16] if r != skip_role]
        regions = [(s.region_path(g, lang), s.place(g, lang)) for g in s.region_codes if g != skip_region]
        return tile(t["t_more"], f"<h3>{esc(t['by_role'])}</h3>{link_list(roles)}"
                                 f"<h3>{esc(t['by_region'])}</h3>{link_list(regions)}"
                                 f"<p>{link(s.hub(lang), t['all'] + ' →')}</p>")

    # --- role ---
    def role_page(self, r: str) -> None:
        s = self.s

        def render(lang: str, paths: dict) -> str:
            t, cell = T[lang], s.cell(r)
            name, f = s.role(r, lang), figures(cell, lang)
            also = ROLE_ALSO.get(r, {}).get(lang)
            lede = fill(t["role_desc"], role=name, **f) + (" " + fill(t["also"], also=also) if also else "")
            title = fill(t["role_title_swe" if r == "software-engineer" else "role_title"],
                         role=name if lang == "es" else s.role_heading(r, lang), year=s.year)
            body = [tile(t["t_years"], table(lang, "col_years", self.years_rows(lang, r)))]
            regions = [(link(s.role_path(r, lang, g), s.place(g, lang)) if s.cell(r, g) else esc(s.place(g, lang)), c)
                       for g in s.region_codes if (c := s.cell(r, g))]
            if regions:
                body.append(tile(t["t_regions"], table(lang, "col_region", regions)))
            if rows := self.company_rows(lang, r):
                body.append(tile(t["t_companies"], table(lang, "col_company", rows)))
            body.append(self.related(lang, skip_role=r))
            return self.page(lang, paths, title=title, desc=fill(t["role_desc"], role=name, **f),
                             h1=fill(t["role_h1"], role=name, year=s.year), lede=lede, cell=cell,
                             crumbs=[(T[lang]["hub_h1"], s.hub(lang)), (s.role_heading(r, lang), paths[lang])],
                             body=body, qa=self.role_qa(lang, r), cta=f"/{lang}/#role={r}")

        self.add(both(lambda lang: s.role_path(r, lang)), render)

    def role_qa(self, lang: str, r: str, g: str = "") -> list[tuple[str, str]]:
        s, t = self.s, T[lang]
        name, cell = s.role(r, lang), s.cell(r, g)
        def loc(text: str) -> str:
            if not g:
                return text
            where = s.region(g, lang)
            return text.replace(" en España", f" en {where}").replace(" in Spain", f" in {where}")
        qa = [(loc(fill(t["q_pay"], role=name)), loc(fill(t["a_pay"], role=name, **figures(cell, lang))))]
        for key, bands in (("junior", ("0-1", "2-4")), ("senior", ("8-11", "5-7", "12-19"))):
            if c := next((s.cell(r, g, y) for y in bands if s.cell(r, g, y)), None):
                y = next(y for y in bands if s.cell(r, g, y))
                qa.append((loc(fill(t[f"q_{key}"], role=name)),
                           fill(t[f"a_{key}"], years=YEARS[lang][y], **figures(c, lang))))
        if not g:
            regions = sorted(((g2, c) for g2 in s.region_codes if (c := s.cell(r, g2))), key=lambda x: -x[1]["median"])
            if len(regions) > 1:
                qa.append((fill(t["q_where"], role=name), fill(t["a_where"], list=listing(
                    lang, [f"{s.place(g2, lang)}, {eur(c['median'], lang)}" for g2, c in regions[:4]]))))
        if names := self.top_names(r, g):
            qa.append((loc(fill(t["q_who"], role=name)), fill(t["a_who"], list=listing(lang, names))))
        return qa

    # --- role in a region ---
    def role_region_page(self, r: str, g: str) -> None:
        s = self.s

        def render(lang: str, paths: dict) -> str:
            t, cell = T[lang], s.cell(r, g)
            name, place, f = s.role(r, lang), s.title_place(g, lang), figures(cell, lang)
            body = []
            if rows := self.years_rows(lang, r, g):
                body.append(tile(t["t_years"], table(lang, "col_years", rows)))
            if rows := self.company_rows(lang, r, g):
                body.append(tile(t["t_companies"], table(lang, "col_company", rows)))
            body.append(self.related(lang))
            heading = name if lang == "es" else s.role_heading(r, lang)
            return self.page(lang, paths, title=fill(t["rr_title"], role=heading, place=place, year=s.year),
                             desc=fill(t["rr_desc"], role=name, place=place, **f),
                             h1=fill(t["rr_h1"], role=name, place=place, year=s.year),
                             lede=fill(t["rr_desc"], role=name, place=place, **f), cell=cell,
                             crumbs=[(t["hub_h1"], s.hub(lang)), (s.role_heading(r, lang), s.role_path(r, lang)),
                                     (s.region(g, lang), paths[lang])],
                             body=body, qa=self.role_qa(lang, r, g), cta=f"/{lang}/#role={r}&loc={g}")

        self.add(both(lambda lang: s.role_path(r, lang, g)), render)

    # --- region ---
    def region_page(self, g: str) -> None:
        s = self.s

        def render(lang: str, paths: dict) -> str:
            t, cell = T[lang], s.cell("", g)
            place, f = s.title_place(g, lang), figures(cell, lang)
            roles = [(link(s.role_path(r, lang, g), s.role_heading(r, lang)), c)
                     for r in s.role_slugs if (c := s.cell(r, g))]
            body = [tile(t["t_roles"], table(lang, "col_role", roles))] if roles else []
            if rows := self.years_rows(lang, "", g):
                body.append(tile(t["t_years"], table(lang, "col_years", rows)))
            if rows := self.company_rows(lang, "", g):
                body.append(tile(t["t_companies"], table(lang, "col_company", rows)))
            body.append(self.related(lang, skip_region=g))
            qa = [(fill(t["q_place"], place=place), fill(t["a_place"], place=place, **f))]
            if s.cell("software-engineer", g):
                qa += self.role_qa(lang, "software-engineer", g)[:1]
            if names := self.top_names("", g):
                qa.append((fill(t["q_who_place"], place=s.region(g, lang)),
                           fill(t["a_who"], list=listing(lang, names))))
            return self.page(lang, paths, title=fill(t["region_title"], place=place, year=s.year),
                             desc=fill(t["region_desc"], place=place, **f),
                             h1=fill(t["region_h1"], place=place, year=s.year),
                             lede=fill(t["region_desc"], place=place, **f), cell=cell,
                             crumbs=[(t["hub_h1"], s.hub(lang)), (s.region(g, lang), paths[lang])],
                             body=body, qa=qa, cta=f"/{lang}/#loc={g}")

        self.add(both(lambda lang: s.region_path(g, lang)), render)

    # --- company ---
    def company_page(self, c: int) -> None:
        s = self.s
        co = s.companies[c]

        def render(lang: str, paths: dict) -> str:
            t, cell = T[lang], s.company_cells()[c]
            name, f = co["name"], figures(cell, lang)
            roles = [(r, cc) for r in s.role_slugs if (cc := s.company_cells(r).get(c))]
            regions = [(g, cc) for g in s.region_codes if (cc := s.company_cells("", g).get(c))]
            years = [(y, cc) for y in s.data["years"] if (cc := s.company_cells("", "", y).get(c))]
            swe = s.company_cells("software-engineer").get(c)
            body = []
            if roles:
                body.append(tile(t["t_roles"], table(lang, "col_role", [
                    (link(s.role_path(r, lang), s.role_heading(r, lang)), cc) for r, cc in roles])))
            if regions:
                body.append(tile(t["t_regions"], table(lang, "col_region", [
                    (link(s.region_path(g, lang), s.place(g, lang)), cc) for g, cc in regions])))
            if years:
                body.append(tile(t["t_years"], table(lang, "col_years", [(esc(YEARS[lang][y]), cc) for y, cc in years])))
            links = [(u, t[k]) for k, u in (("web", co.get("web")), ("linkedin", co.get("linkedin")),
                                             ("levels", f"https://www.levels.fyi/companies/{co['levels']}/salaries"
                                              if co.get("levels") else None)) if u and u != "-"]
            info = ""
            if co.get("cities"):
                info += f"<p><b>{esc(t['cities'])}:</b> {esc(', '.join(co['cities']))}</p>"
            info += ('<ul class="guide-links">' + "".join(
                f'<li><a href="{esc(u)}" rel="noopener nofollow" target="_blank">{esc(label)}</a></li>'
                for u, label in links) + "</ul>")
            body.append(tile(t["t_links"], info))
            qa = [(fill(t["q_co"], company=name), fill(t["a_co"], company=name, **f))]
            for r, cc in roles[:3]:
                qa.append((fill(t["q_co_role"], company=name, role=s.role(r, lang)),
                           fill(t["a_co_role"], **figures(cc, lang))))
            title = fill(t["co_title_swe" if swe else "co_title"], company=name, year=s.year)
            return self.page(lang, paths, title=title, desc=fill(t["co_desc"], company=name, **f),
                             h1=fill(t["co_h1"], company=name, year=s.year),
                             lede=fill(t["co_desc"], company=name, **f), cell=cell,
                             crumbs=[(t["by_company"], s.hub(lang) + "#all-companies"), (name, paths[lang])],
                             body=body, qa=qa, cta=f"/{lang}/#companies-card")

        self.add(both(lambda lang: s.company_path(c, lang)), render)

    # --- hub ---
    def hub_page(self) -> None:
        s = self.s

        def render(lang: str, paths: dict) -> str:
            t, cell = T[lang], s.cell()
            roles = [(link(s.role_path(r, lang), s.role_heading(r, lang)), c) for r in s.role_slugs if (c := s.cell(r))]
            regions = [(link(s.region_path(g, lang), s.place(g, lang)), c) for g in s.region_codes if (c := s.cell("", g))]
            companies = [(s.company_path(c, lang), s.companies[c]["name"]) for c in s.listed]
            body = [tile(t["by_role"], table(lang, "col_role", roles)),
                    tile(t["by_region"], table(lang, "col_region", regions)),
                    f'<section class="tile wide" id="all-companies"><h2>{esc(t["by_company"])}</h2>'
                    f'{link_list(companies, "guide-links cols")}</section>']
            qa = self.role_qa(lang, "software-engineer")[:3] if s.cell("software-engineer") else []
            n = figures(cell, lang)["n"]
            return self.page(lang, paths, title=fill(t["hub_title"], year=s.year), desc=t["hub_desc"],
                             h1=t["hub_h1"], lede=fill(t["hub_lede"], n=n), cell=cell,
                             crumbs=[(t["hub_h1"], paths[lang])], body=body, qa=qa, cta=f"/{lang}/")

        self.add(both(s.hub), render)

    def build(self) -> list[dict]:
        s = self.s
        self.hub_page()
        for r in s.role_slugs:
            self.role_page(r)
            for g in s.region_codes:
                if s.cell(r, g):
                    self.role_region_page(r, g)
        for g in s.region_codes:
            self.region_page(g)
        for c in s.listed:
            self.company_page(c)
        return self.pages


def pages(data: dict, shell, public: str) -> list[dict]:
    """Every search page, as {"paths": {lang: path}, "html": {lang: html}}."""
    return Builder(data, shell, public).build()


def home_extra(data: dict, lang: str) -> tuple[str, list[tuple[str, str]]]:
    """The home page's links into these pages and the questions it answers
    in plain text, so a search engine reading it without JavaScript finds both."""
    b = Builder(data, None, "")
    s, t = b.s, T[lang]
    qa = b.role_qa(lang, "software-engineer")[:4] if s.cell("software-engineer") else []
    roles = [(s.role_path(r, lang), s.role_heading(r, lang)) for r in s.role_slugs[:12]]
    places = [(s.role_path("software-engineer", lang, g), s.place(g, lang)) for g in s.region_codes
              if s.cell("software-engineer", g)]
    top = [c for c, _ in sorted(s.company_cells().items(), key=lambda kv: -kv[1]["n"])[:24] if s.has_company_page(c)]
    companies = [(s.company_path(c, lang), s.companies[c]["name"]) for c in top]
    body = (f"<h3>{esc(t['by_role'])}</h3>{link_list(roles)}"
            f"<h3>{esc(fill(t['swe_in'], role=s.role_heading('software-engineer', lang)))}</h3>{link_list(places)}"
            f"<h3>{esc(t['by_company'])}</h3>{link_list(companies)}"
            f"<p>{link(s.hub(lang), t['all'] + ' →')}</p>")
    items = "".join(f"<div><dt>{esc(q)}</dt><dd>{esc(a)}</dd></div>" for q, a in qa)
    section = (f'\n  <section class="tile wide" id="guides"><h2>{esc(t["guides"])}</h2>{body}</section>'
               + (f'\n  <section class="tile wide" id="faq"><h2>{esc(t["home_faq"])}</h2><dl class="faq">{items}</dl></section>'
                  if qa else ""))
    return section, qa


def faq_json_ld(qa: list[tuple[str, str]]) -> str:
    return json.dumps(faq_ld(qa), ensure_ascii=False).replace("</", "<\\/")
