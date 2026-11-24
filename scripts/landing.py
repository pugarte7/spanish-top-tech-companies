"""The home page: a funnel into the MCP server, in Spanish and English.

One minimalist page (white, black and the blue) that gets a reader to connect
their agent: the mascot above a headline with no figure in it, one agent's
logo swapping inside the sentence, the button going down to the link, GitHub
beside it, three figures, three steps, the questions. The page is whole
without JavaScript; web/landing.js adds the mascot, the swapping logo, the
live figures, the copy button and the theme.

site.py owns the head (icons, analytics, link previews) and passes it in, so
this module needs nothing from it and can be previewed on its own.
"""

from __future__ import annotations

import html
import re

REPO = "https://github.com/pugarte7/spanish-top-tech-companies"
MCP = "spanishtoptechcompanies.com/mcp"

# (name, logo in web/agents/), in the order the maintainer ranks them at applying.
AGENTS = [("Instinct", "instinct.jpg"), ("Claude Code", "claude-code.png"), ("Codex", "codex.png"),
          ("Cursor", "cursor.png"), ("Hermes", "hermes.png"), ("Grok", "grok.jpg")]

GITHUB_ICON = ('<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8'
               'c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94'
               '-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66'
               '.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12'
               ' 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82'
               ' 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46'
               '.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>')
STAR_ICON = ('<svg viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" '
             'd="M8 .8l2.2 4.6 5 .7-3.6 3.5.9 5L8 12.2l-4.5 2.4.9-5L.8 6.1l5-.7Z"/></svg>')
ARROW_ICON = ('<svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" '
              'stroke-linecap="round" stroke-linejoin="round"><path d="M3 8h10M9 4l4 4-4 4"/></svg>')
SUN_ICON = ('<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" '
            'stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 '
            '4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>')
MOON_ICON = ('<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" '
             'stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>')

# The page's words. **Two asterisks** around words put them in the blue; the
# answers under `faq` take none. `sub` holds {agent} where the swapping logo
# goes; an answer may hold {readme}, the link to the README.
TEXT = {
    "es": {
        "name": "Spanish Top Tech Companies",
        "title": "Aplica a miles de trabajos en tech con tu agente · Spanish Top Tech Companies",
        "description": ("Un servidor MCP gratuito: tu agente (Claude Code, Codex, Cursor y los demás) busca "
                        "entre miles de ofertas tech en España y aplica por ti, con tu visto bueno."),
        "h1": "Aplica a **miles de trabajos** en tech con tu agente",
        "sub": "Haz que {agent} aplique por ti. **Gratis.**",
        "agents": "tu agente", "cta": "Conéctalo a tu agente", "github": "Ver en GitHub",
        "stars": "{n} estrellas en GitHub", "theme": "Modo claro u oscuro", "mascot": "Mascota: España con dos ojos y seis brazos que envían CVs",
        "stats": ("llamadas de agentes, en directo", "ofertas abiertas hoy", "empresas"),
        "connect": ("Conéctalo", "Un minuto, con el agente que ya usas.",
                    "Pégalo en el chat de tu agente, o añádelo como servidor MCP. **Sin registro ni claves.**"),
        "copy": "Copiar", "copied": "Copiado",
        "how": ("Cómo funciona", "Tu agente hace el trabajo, tú decides."),
        "steps": (("Conéctalo", "Un enlace en tu agente. **Sin registro, sin claves y sin instalar nada.**"),
                  ("Pídele ofertas", "«Backend en remoto por encima de 60k»: busca entre las ofertas de hoy y te "
                                     "dice **lo que paga cada empresa**."),
                  ("Aplica con tu sí", "Rellena el formulario con tu CV, te pregunta lo que no sabe y envía **solo "
                                       "cuando lo apruebas**.")),
        "faq_title": "Preguntas frecuentes",
        "faq": (("¿Es gratis?", "Sí. No hay registro, claves ni nada que instalar: es un enlace que añades a tu agente."),
                ("¿Para qué roles hay ofertas?", "Para todos los que las empresas tienen abiertos: ingeniería, datos, "
                 "producto, diseño, ventas, marketing y los demás."),
                ("¿Qué empresas salen?", "Las que tienen posiciones para España y hemos podido encontrar en "
                 "Levels.fyi, o que publican el salario en la oferta."),
                ("¿Envía candidaturas sin preguntarme?", "No. Te enseña la candidatura completa y solo la envía "
                 "cuando dices que sí."),
                ("¿Se inventa respuestas?", "No. Rellena con lo que dice tu CV y te pregunta lo que falta, las "
                 "preguntas de opinión son tuyas."),
                ("¿Qué datos míos se guardan?", "Ninguno. Tu CV, tus respuestas y tus candidaturas se quedan en tu "
                 "agente, de cada llamada solo se cuenta una estadística anónima."),
                ("¿De dónde salen las ofertas?", "De los portales de empleo de las propias empresas, más de 400, "
                 "leídos cada día: puestos en España o en remoto abiertos a España o Europa."),
                ("¿Con qué agentes funciona?", "Con cualquiera que admita MCP: Claude Code, Codex, Cursor, Hermes, "
                 "Grok, Instinct y los demás."),
                ("No me funciona, ¿qué hago?", "En {readme} está explicado paso a paso cómo conectarlo y cómo "
                 "usarlo bien.")),
        "readme": "GitHub", "legal": "Aviso legal y privacidad",
    },
    "en": {
        "name": "Spanish Top Tech Companies",
        "title": "Apply to thousands of tech jobs with your agent · Spanish Top Tech Companies",
        "description": ("A free MCP server: your agent (Claude Code, Codex, Cursor and the rest) searches "
                        "thousands of tech openings in Spain and applies for you, with your approval."),
        "h1": "Apply to **thousands of tech jobs** with your agent",
        "sub": "Have {agent} apply for you. **Free.**",
        "agents": "your agent", "cta": "Connect it to your agent", "github": "See it on GitHub",
        "stars": "{n} stars on GitHub", "theme": "Light or dark mode", "mascot": "Mascot: Spain with two eyes and six arms sending CVs",
        "stats": ("agent calls, live", "open postings today", "companies"),
        "connect": ("Connect it", "One minute, with the agent you already use.",
                    "Paste it into your agent's chat, or add it as an MCP server. **No sign-up, no keys.**"),
        "copy": "Copy", "copied": "Copied",
        "how": ("How it works", "Your agent does the work, you decide."),
        "steps": (("Connect it", "One link in your agent. **No sign-up, no keys, nothing to install.**"),
                  ("Ask it for jobs", "“Remote backend above 60k”: it searches today's postings and tells you **what "
                                      "each company pays**."),
                  ("Apply with your yes", "It fills in the form from your CV, asks you what it does not know and "
                                          "sends **only when you approve**.")),
        "faq_title": "Questions",
        "faq": (("Is it free?", "Yes. No sign-up, no keys and nothing to install: it is a link you add to your agent."),
                ("Which roles are there postings for?", "Every role the companies have open: engineering, data, "
                 "product, design, sales, marketing and the rest."),
                ("Which companies are in it?", "Those with positions for Spain that we could find on Levels.fyi, "
                 "or that state the salary in the posting."),
                ("Does it send applications without asking me?", "No. It shows you the whole application and sends "
                 "it only when you say yes."),
                ("Does it make up answers?", "No. It fills in what your CV says and asks you for the rest, opinion "
                 "questions are yours to answer."),
                ("What data of mine is stored?", "None. Your CV, your answers and your applications stay with your "
                 "agent, each call is only counted as an anonymous statistic."),
                ("Where do the postings come from?", "From the companies' own job boards, more than 400, read "
                 "every day: roles in Spain or remote ones open to Spain or Europe."),
                ("Which agents does it work with?", "Any that supports MCP: Claude Code, Codex, Cursor, Hermes, "
                 "Grok, Instinct and the rest."),
                ("It is not working. What do I do?", "{readme} explains step by step how to connect it and how "
                 "to use it well.")),
        "readme": "GitHub", "legal": "Legal and privacy",
    },
}


def ink(text: str) -> str:
    """Escaped, with **words** in the blue."""
    return re.sub(r"\*\*(.+?)\*\*", r"<mark>\1</mark>", html.escape(text))


def grouped(n: int, lang: str) -> str:
    return f"{n:,}".replace(",", "." if lang == "es" else ",")


def faq_ld(lang: str) -> dict:
    """The questions as schema.org FAQPage, answers in plain text."""
    t = TEXT[lang]
    return {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": q,
         "acceptedAnswer": {"@type": "Answer", "text": a.replace("{readme}", f"GitHub ({REPO})")}}
        for q, a in t["faq"]]}


def page(lang: str, *, head: str, stars: int | None, version: str) -> str:
    """One language's page. `head` is everything site.py puts in <head> after
    the title and description; `stars` is the repo's count at build time (the
    script brings it up to date); `version` goes on the asset URLs."""
    t = TEXT[lang]
    e = html.escape
    logos = "".join(f'<span{" data-on" if i == 0 else ""}><img src="/agents/{file}" alt="{e(name)}" '
                    f'width="32" height="32"></span>' for i, (name, file) in enumerate(AGENTS))
    agent = f'<span class="rot" data-rot role="img" aria-label="{e(t["agents"])}">{logos}</span>'
    go = f'<a class="cta" href="#conectar" data-track="cta">{e(t["cta"])} {ARROW_ICON}</a>'
    count = (f'<em title="{e(t["stars"].replace("{n}", grouped(stars, lang)))}">{STAR_ICON}'
             f'<span data-stars>{grouped(stars, lang)}</span></em>') if stars else ""
    github = (f'<a class="btn2" href="{REPO}#readme" target="_blank" rel="noopener" data-track="github">'
              f'{GITHUB_ICON}{e(t["github"])}{count}</a>')
    langs = " / ".join(f'<b>{code.upper()}</b>' if code == lang else f'<a href="/{code}/" hreflang="{code}">{code.upper()}</a>'
                       for code in ("es", "en"))
    stat = lambda key, label: f'<div data-stat="{key}"><b>&nbsp;</b><span>{e(label)}</span></div>'
    steps = "".join(f'<li><i>{k}</i><div><b>{e(a)}</b><p>{ink(b)}</p></div></li>'
                    for k, (a, b) in enumerate(t["steps"], 1))
    readme = f'<a href="{REPO}#readme" target="_blank" rel="noopener">{t["readme"]}</a>'
    faq = "".join(f'<details><summary>{e(q)}</summary><p>{e(a).replace("{readme}", readme)}</p></details>'
                  for q, a in t["faq"])
    return f"""<!doctype html>
<html lang="{lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(t['title'])}</title>
<meta name="description" content="{e(t['description'])}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="{e(t['name'])}">
<meta property="og:title" content="{e(t['title'])}">
<meta property="og:description" content="{e(t['description'])}">
<meta name="color-scheme" content="light dark">
<script>try {{ const t = localStorage.getItem("theme"); if (t) document.documentElement.dataset.theme = t; }} catch (_) {{}}</script>
{head}
<link rel="preload" href="/fonts/InterTight-Variable.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/landing.css?v={version}">
</head>
<body data-lang="{lang}" data-say-copy="{e(t['copy'])}" data-say-copied="{e(t['copied'])}" data-mascot="{e(t['mascot'])}">
<div class="page">
<nav class="nav wrap">
  <span class="langs">{langs}</span>
  <a class="brand" href="/{lang}/">{e(t['name'])}</a>
  <button type="button" id="theme" title="{e(t['theme'])}" aria-label="{e(t['theme'])}"><span class="sun">{SUN_ICON}</span>/<span class="moon">{MOON_ICON}</span></button>
</nav>
<header class="center">
  <div class="scene" data-scene></div>
  <h1>{ink(t['h1'])}</h1>
  <p class="sub">{ink(t['sub']).replace("{agent}", agent)}</p>
  <div class="btns">{go}{github}</div>
  <div class="stats">{stat("calls", t['stats'][0])}{stat("postings", t['stats'][1])}{stat("companies", t['stats'][2])}</div>
</header>
<main>
<section class="block" id="conectar">
  <h2>{e(t['connect'][0])}</h2><p>{e(t['connect'][1])}</p>
  <div class="one">
    <button class="copy" type="button" data-copy="https://{MCP}"><code>{MCP}</code><span>{e(t['copy'])}</span></button>
    <small>{ink(t['connect'][2])}</small>
    <div class="logos">{"".join(f'<img src="/agents/{file}" alt="{e(name)}" title="{e(name)}" width="28" height="28" loading="lazy">' for name, file in AGENTS)}</div>
  </div>
</section>
<section class="block">
  <h2>{e(t['how'][0])}</h2><p>{e(t['how'][1])}</p>
  <ol class="steps">{steps}</ol>
</section>
<section class="block faq">
  <h2>{e(t['faq_title'])}</h2>
  {faq}
</section>
</main>
<footer class="foot wrap"><span>{e(t['name'])}</span><span><a href="{REPO}" target="_blank" rel="noopener">GitHub</a><a href="/{lang}/legal/">{e(t['legal'])}</a></span></footer>
</div>
<script src="/mascot.js?v={version}" defer></script>
<script src="/landing.js?v={version}" defer></script>
</body>
</html>
"""
