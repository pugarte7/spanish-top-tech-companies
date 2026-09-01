# spanish-top-tech-companies

Companies paying senior software engineers 60k+ **in Spain**. Read
[docs/CONTEXT.md](docs/CONTEXT.md) before changing anything in the data
pipeline — it records why several obvious-looking approaches are wrong.

The three things that will bite you:

1. **Levels.fyi serves another country's salaries when it has no Spanish data**,
   and the page currency stays EUR for Germany, the Netherlands, France and
   Ireland. Guard on `percentiles.locationName`, never on currency and never on
   `locationMeta`. `scripts/fetch_spain.py` is the only script that writes pay;
   `scripts/fetch_company.py` is metadata-only for exactly this reason.
   `validate.py` rejects any levels.fyi source URL without `/locations/` in it,
   which is the backstop that catches whatever a fetcher gets wrong — leave it
   in place. This trap has been paid for twice: 682 foreign bands, then 205
   more carried in by a branch cut before the first fix.
2. **The per-location page has two independent sources.** `percentiles` is an
   aggregate that falls back to another country; `median` is one real Spanish
   submission that survives when the aggregate does not. Read both or you lose
   most of the data.
3. **`sampleSize > 0` does not mean a figure is published.** Many companies
   report a count with every percentile null. The site's submissions table is
   client-side and unreachable from the server HTML.

All Levels.fyi fetching must run from Spain; the pages are IP-scoped. Keep
`--delay` at 2.5s or more, and treat 403/405/429/503 as throttling rather than
as "not found".

A row should ideally mean the maintainer knows someone in Spain doing that job,
or was offered the position. Crowdsourced figures are placeholders; first-hand
entries (`community`, `offer-letter`) sort above them.

After any data change: `python3 scripts/validate.py && python3 scripts/build.py`,
and commit the regenerated `README.md` and `exports/` — CI fails otherwise.
