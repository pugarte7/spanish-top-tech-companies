# What each company does

Each issue labelled `about` lists companies that employ people in Spain. For
each one, write one sentence saying what the company does, in Spanish and in
English, for someone who has never heard of it and is deciding whether to
apply there. Answer with one comment holding one JSON block that follows
`schema.json`, with one item per company of the issue, in any order. Never
guess: a company you cannot place gets `about: null` and a `notes` saying why,
which is a valid answer.

## Input (issue body)

```json
{
  "companies": [
    {
      "slug": "acme",
      "name": "Acme",
      "website": "https://acme.com",
      "linkedin": "https://www.linkedin.com/company/acme"
    },
    {
      "slug": "initech",
      "name": "Initech",
      "website": "https://jobs.example.com/initech",
      "linkedin": null
    }
  ]
}
```

`website` and `linkedin` fix the identity. If they disagree, or the name
belongs to several companies and you cannot tell which, that company's `about`
is null. A `website` that is only a job board says who is hiring, not what
they do: look the company up.

To correct an answer, comment again with the items to replace, in the same
shape: the newest comment replaces the earlier one for those companies, also
after the issue is closed (for 14 days).

## Output (comment)

```json
{
  "companies": [
    {
      "slug": "acme",
      "about": {
        "es": "Plataforma de reparto a domicilio de comida y compras para particulares.",
        "en": "On-demand delivery platform for food and groceries, for consumers."
      },
      "source_url": "https://acme.com/about",
      "notes": null
    },
    {
      "slug": "initech",
      "about": null,
      "source_url": null,
      "notes": "Two unrelated companies use this name and the issue gives no website of its own."
    }
  ]
}
```

## about

- What the company makes or sells, and for whom. Its business, not its
  mission.
- One sentence in each language, the same content in both, between 10 and
  140 characters each.
- A noun phrase that does not start with the company's name: "Software de
  nóminas y RR. HH. para pymes.", not "Acme es una empresa que...".
- Concrete: "Banco digital con cuenta, tarjeta e inversión desde el móvil",
  not "Soluciones digitales innovadoras".
- Neutral. No praise ("leading", "innovative", "líder", "world-class"), no
  slogan, no figures, no founding year, no headquarters, no customers named.
- A subsidiary or a brand of a group is described by what that unit does,
  with the group named only if the unit is otherwise unclear ("Consultora
  tecnológica del grupo Indra").
- Spanish as written in Spain.

`source_url`: the page that says what the company does: its own site first,
then its LinkedIn page, then an encyclopedia or the press. Null only when
`about` is null.

`notes`: null, or one line a human should read: an ambiguous name, a company
that closed or was absorbed, a website that no longer answers.

## Never

- Describe anything else: news, funding, layoffs, lawsuits, investigations,
  reviews, pay, culture, or whether it is a good place to work.
- Copy the company's own tagline or marketing sentence.
- Name a person.
- Log in to any site, or read anything behind a login.
