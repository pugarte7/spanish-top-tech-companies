# Style

How the site looks and reads. Anything new on it (a page, a section, an image,
a line of copy) follows this, so it all reads as one thing. The tokens live in
`web/landing.css` and the words in `scripts/landing.py`: this file says which
to reach for and why.

## In one line

Minimal, white, black and one blue. One column, a lot of air, a hand-drawn
mascot, and copy that says one thing per sentence.

## Colour

Three colours and two greys. Nothing else: no gradients, no second accent, no
tinted backgrounds.

| Token | Light | Dark | For |
| --- | --- | --- | --- |
| `--paper` | `#ffffff` | `#0a0a0a` | The page |
| `--ink` | `#0a0a0a` | `#f4f4f4` | Text, dark buttons, step numbers |
| `--blue` | `#0000f2` | `#6060ff` | The main button's fill |
| `--accent` | `#0000f2` | `#6060ff` | Blue text: key words, links |
| `--grey` | `#6b6b6b` | `#9a9a9a` | Secondary text |
| `--line` | `#e6e6e6` | `#262626` | Hairlines and borders |

- Light is the default. Dark only when the reader picks it.
- Blue is scarce: one filled button per screen, and the few words a reader
  should see first.
- Separate with a 1px `--line` or with space, not with shadows or fills.
- A logo that is dark on transparent gets a white backing in dark mode.

## Type

- Inter Tight for everything, self-hosted. No second typeface. Monospace only
  for something the reader copies (the `/mcp` link).
- Weights: 400 for text, 500 for headings and titles, 600 for buttons and the
  brand. Nothing heavier.
- Sentence case everywhere. No capitals for emphasis, no uppercase labels.
- Headings are tight: letter-spacing `-.025em`, line-height about 1.06,
  `text-wrap: balance`.

| Use | Size |
| --- | --- |
| Headline | `clamp(34px, 6.2vw, 56px)` |
| Sentence under it | `clamp(17px, 2.4vw, 20px)`, grey |
| Section title | 22px |
| Text | 17px |
| Notes and labels | 13 to 15px, grey |
| Figures | `clamp(24px, 4.5vw, 34px)`, tabular numbers |

## Layout

- One centred column: 780px for content, 1040px for the top bar and the
  footer, 16px of gutter on a phone.
- About 104px between sections. When in doubt, more space, not a divider.
- The top of the page is centred (mascot, headline, sentence, buttons,
  figures). Sections under it are left-aligned.
- Everything works at 320px wide with no sideways scroll. Rows of buttons
  stack on a phone.
- The footer sits at the end of the page, or at the bottom of the window on a
  page shorter than it, with its links centred. It never follows the scroll.

## Components

- **Main button**: blue fill, white text, 10px radius, an arrow after the
  label. One per screen.
- **Second button**: same size and radius, 1px border, no fill. Buttons side
  by side are the same width.
- **Card**: 1px border, 16px radius, no shadow.
- **Switch**: show both states and ink the one in use (`ES / EN`, sun / moon).
  Never a single icon that swaps.
- **Steps**: a vertical list, a black numbered square each, a hairline joining
  them, a short title and one sentence.
- **Questions**: an accordion between hairlines, a `+` that turns on opening.
- **Figures**: three at most, a number and a short grey label. Only real
  numbers, read live. A figure with no data is left out, never shown as zero
  or a placeholder.
- **Agent logos**: the icon alone, with no name beside it.

## The mascot

- Mainland Spain with two big oval eyes and six arms, in black line on white
  (white on black in dark mode). No mouth, no other face.
- Drawn by `web/mascot.js` in the "Trazos" hand: every line twice, freehand,
  hatched shadow. Do not redraw it by hand or restyle it.
- At work, it sits centred above the headline. As the logo it is the body and
  the eyes alone. On a phone the top bar has neither logo nor name, only the
  languages on the left and the theme on the right.
- Under about 48px (the tab icon) use the clean-line version in
  `web/favicon.svg`: the freehand line and the hatching turn to noise.
- Images for sharing and icons come from `npm run og`. Do not make them by
  hand.

## Motion

- Motion says something happened: a press, a change, a number going up. No
  decoration, nothing that loops for its own sake except the mascot.
- Quick and soft: 160ms for a press (`scale(.97)`), 200 to 380ms for a change,
  easing `cubic-bezier(0.23, 1, 0.32, 1)`.
- Slow when it repeats: the swapping logo changes every 3.5 seconds.
- Animate `transform` and `opacity` only, and honour
  `prefers-reduced-motion`.

## Writing

The page is written in Spanish first and in English beside it, saying the same
thing.

- Short sentences, one idea each. Address the reader as "tú" ("you").
- Say what the reader gets, then that it is free. No adjectives doing the
  work of a fact ("potente", "revolucionario", "seamless").
- Commas and full stops. No semicolons, no dashes used as punctuation, no
  exclamation marks, no emoji.
- No number in a headline: it goes stale. "Miles de trabajos", and the exact
  count in the live figures.
- A promise is one the product keeps: it asks before sending, it fills in only
  what the CV says, it stores nothing about the person.
- Never repeat a line or a call to action further down the page.
- Blue marks the words to read first: in the headline, in the sentence under
  it, one phrase per step, the reassurance under the link. Not in the answers
  to the questions, and never more than one phrase per sentence.
- A question is written as the reader would ask it ("¿Es gratis?"), and its
  answer starts with the answer ("Sí.", "No.", "Ninguno.").
- Buttons say what happens: "Conéctalo a tu agente", "Ver en GitHub",
  "Copiar".

## Do not

- Add a second accent colour, a gradient, a shadow or a background pattern.
- Add a badge or a pill above the headline.
- Put a name beside an agent's logo, or make anything change faster than a
  reader can follow.
- Show salaries, rankings or tables on the site: they are in the MCP.
- Pin anything to the window while the reader scrolls.
