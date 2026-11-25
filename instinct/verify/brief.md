# Which company is this

Each issue labelled `verify` lists names that people gave as their employer
in Spain and that we could not tie to a company: we hold no website and no
LinkedIn page for them, so nothing of them is published. For each one, find
the company's own website and its LinkedIn company page. Answer with one
comment holding one JSON block that follows `schema.json`, with one item per
name of the issue, in any order.

Never guess. A name several companies share, with nothing in the input to
tell which, gets both fields null and a `notes` saying which companies it
could be: that is a valid answer, and it is then not asked again for months.

## Input (issue body)

```json
{
  "companies": [
    {
      "slug": "acme",
      "name": "Acme",
      "levels": "https://www.levels.fyi/companies/acme/salaries",
      "roles": ["software-engineer", "product-designer"],
      "cities": ["Málaga"],
      "salaries": 5
    }
  ]
}
```

`levels` is the company's page on Levels.fyi, where the name comes from; its
company profile, when public, often names the website. `roles` and `cities`
are what its people in Spain do and where: the company has staff there.

## Output (comment)

```json
{
  "companies": [
    {
      "slug": "acme",
      "website": "https://www.acme.com",
      "linkedin": "https://www.linkedin.com/company/acme",
      "evidence": "acme.com/contact lists an office in Málaga; its LinkedIn page links to acme.com",
      "notes": null
    }
  ]
}
```

- `website`: the company's own site, its home page. Not a job board, a
  directory, a profile on another site or a parent group's site.
- `linkedin`: its company page (`linkedin.com/company/...`), found through a
  web search or the company's own site. Never a person's profile, and never
  read behind a login.
- One of the two is enough; give both when you find both, and null for the
  one you do not find.
- `evidence`: one line on what ties this company to the name and to Spain
  (an office there, postings there, its Levels.fyi profile naming the site).
  Required whenever `website` or `linkedin` is given.
- `notes`: why nothing was found, or anything the maintainer should know
  (the company closed, it was renamed, it is a brand of another).
