# Salario de programador en España: las empresas tech que más pagan

**[spanishtoptechcompanies.com](https://spanishtoptechcompanies.com/es/)** · Spanish Top Tech Companies · [English](#english)

¿Cuánto gana un programador en España? Aquí lo ves con salarios reales de gente que trabaja en España, sacados de Levels.fyi: el sueldo base mediano de cada empresa tecnológica, el total con bonus y acciones y cuánta gente cobra 60.000 € o más. Filtra por rol (desarrollador de software, data scientist, product manager y más de 30), por años de experiencia, de junior a senior, por modalidad (remoto, híbrido o presencial) y por comunidad autónoma en un mapa. Y conecta tu agente de IA al servidor MCP de la web para que [busque ofertas de empleo en estas empresas y aplique por ti](#deja-que-tu-agente-aplique-por-ti), sin instalar nada.

**[Ver el ranking de empresas →](https://spanishtoptechcompanies.com/es/)**

### Salario de programador por rol, ciudad y empresa

Cada rol, comunidad y empresa tiene su página con el sueldo base mediano, la horquilla, el total con bonus y acciones y lo que se cobra según los años de experiencia:

- **Por rol**: [salario de programador o desarrollador de software](https://spanishtoptechcompanies.com/es/salarios/software-engineer/), [data scientist](https://spanishtoptechcompanies.com/es/salarios/data-scientist/), [product manager](https://spanishtoptechcompanies.com/es/salarios/product-manager/), [engineering manager](https://spanishtoptechcompanies.com/es/salarios/software-engineering-manager/), [diseñador de producto](https://spanishtoptechcompanies.com/es/salarios/product-designer/), [analista de datos](https://spanishtoptechcompanies.com/es/salarios/data-analyst/), [arquitecto de soluciones](https://spanishtoptechcompanies.com/es/salarios/solution-architect/) y [todos los roles](https://spanishtoptechcompanies.com/es/salarios/).
- **Programador por ciudad**: [Madrid](https://spanishtoptechcompanies.com/es/salarios/software-engineer/madrid/), [Barcelona](https://spanishtoptechcompanies.com/es/salarios/software-engineer/cataluna/), [Valencia](https://spanishtoptechcompanies.com/es/salarios/software-engineer/comunidad-valenciana/), [Málaga y Sevilla](https://spanishtoptechcompanies.com/es/salarios/software-engineer/andalucia/), [Bilbao](https://spanishtoptechcompanies.com/es/salarios/software-engineer/pais-vasco/) y [Zaragoza](https://spanishtoptechcompanies.com/es/salarios/software-engineer/aragon/).
- **Por comunidad**, todos los roles: [Madrid](https://spanishtoptechcompanies.com/es/salarios/madrid/), [Cataluña](https://spanishtoptechcompanies.com/es/salarios/cataluna/), [Comunidad Valenciana](https://spanishtoptechcompanies.com/es/salarios/comunidad-valenciana/), [Andalucía](https://spanishtoptechcompanies.com/es/salarios/andalucia/) y [País Vasco](https://spanishtoptechcompanies.com/es/salarios/pais-vasco/).
- **Por empresa**: [Revolut](https://spanishtoptechcompanies.com/es/empresas/revolut/), [Glovo](https://spanishtoptechcompanies.com/es/empresas/glovo/), [Amazon](https://spanishtoptechcompanies.com/es/empresas/amazon/), [Datadog](https://spanishtoptechcompanies.com/es/empresas/datadog/), [N26](https://spanishtoptechcompanies.com/es/empresas/n26/), [TravelPerk](https://spanishtoptechcompanies.com/es/empresas/travelperk/), [Cabify](https://spanishtoptechcompanies.com/es/empresas/cabify/) y [el resto de empresas tecnológicas en España](https://spanishtoptechcompanies.com/es/salarios/#all-companies).

### Deja que tu agente aplique por ti

Un agente de IA para buscar trabajo sin rellenar formularios. Cada día la web recoge las ofertas de empleo abiertas de las empresas de la lista en sus portales públicos (Greenhouse, Lever, Ashby, Workday y otros), en España o en remoto desde España. Tu agente busca entre ellas con el sueldo mediano de cada empresa al lado, lee el formulario de la oferta, escribe la carta y las respuestas a partir de tu CV, te enseña la solicitud completa y la envía cuando le dices que sí.

Funciona con cualquier agente que admita MCP. Quienes lo usan lo hacen sobre todo con Codex y Cursor; también sirven Claude Code, Claude, Instinct o Hermes.

1. **Pídele que se conecte.** Pégale esto en el chat. Él mismo añade el servidor MCP, sin registro ni nada que instalar:

   > Conéctate a este servidor MCP: https://spanishtoptechcompanies.com/mcp

   Trae las herramientas de sueldos y las de ofertas (`find_jobs`, `job_questions`, `application_guide` y `report_application`). Si te pide abrir una sesión nueva para cargarlo, hazlo.

2. **Dale tu CV y lo que buscas.** Una sola vez, en el chat: tu CV, dónde y cómo quieres trabajar y el sueldo que pides. Tu perfil se queda en tu agente, en su memoria o en un archivo como `~/job-search.md`; la web no guarda nada tuyo. Envía cada solicitud con su propio navegador, y si no tiene navegador te da el enlace y las respuestas para que la envíes tú. Si una empresa manda un código por correo, lo lee de tu correo si se lo conectas, o te lo pide.

3. **Dile que aplique.** Por ejemplo:

   > Aplica por mí a las ofertas de las empresas de spanishtoptechcompanies.com que pagan 60.000 € o más a alguien con mi experiencia en Madrid.

   O: «Aplica a 5 ofertas de backend en Barcelona», «Busca ofertas en remoto que pueda hacer desde España», «¿Cuánto paga Revolut a un programador senior?». Las preguntas delicadas, como sueldo o permiso de trabajo, te las hace una vez, todas en un mensaje, y los consentimientos de privacidad los aceptas tú. Si un formulario pide un CAPTCHA, te pasa la página: lo resuelves y envía la solicitud.

<details>
<summary>Configurarlo a mano</summary>

- Codex: `codex mcp add tech-pay-spain --url https://spanishtoptechcompanies.com/mcp`
- Claude Code: `claude mcp add --transport http tech-pay-spain https://spanishtoptechcompanies.com/mcp`
- Cursor, en `~/.cursor/mcp.json`: `{"mcpServers": {"tech-pay-spain": {"url": "https://spanishtoptechcompanies.com/mcp"}}}`
- Claude o Instinct: añade la URL como conector personalizado.
- Hermes y otros agentes de [agentskills.io](https://agentskills.io): la skill [tech-pay-spain](skills/tech-pay-spain/SKILL.md).

</details>

### Preguntas frecuentes

**¿Cuánto cobra un programador en España?** Depende sobre todo de la empresa, la experiencia y la ciudad. La [página del salario de programador](https://spanishtoptechcompanies.com/es/salarios/software-engineer/) da el sueldo base mediano bruto al año, la horquilla y lo que se cobra de junior a senior, con salarios actualizados cada semana.

**¿Qué empresas tecnológicas pagan más en España?** El [ranking](https://spanishtoptechcompanies.com/es/) ordena todas las empresas por sueldo base mediano, y se filtra por rol, experiencia, ciudad y remoto. Sirve para ver cuáles son las mejores empresas tecnológicas para trabajar en España según lo que pagan.

**¿Cuánto gana un programador junior o senior?** Cada página de rol desglosa el sueldo por años de experiencia: de 0 a 1, de 2 a 4, de 5 a 7, de 8 a 11, de 12 a 19 y más de 20.

**¿Y en Madrid o en Barcelona?** Hay una página por rol y comunidad, como [programador en Madrid](https://spanishtoptechcompanies.com/es/salarios/software-engineer/madrid/) o [en Barcelona y Cataluña](https://spanishtoptechcompanies.com/es/salarios/software-engineer/cataluna/).

**¿Es lo mismo que Levels.fyi o Glassdoor?** Los salarios vienen de Levels.fyi, pero aquí solo cuentan los de personas que trabajan en España, resumidos por empresa, rol, ciudad y experiencia, en euros y en español. No se mezcla ningún salario de otro país.

### Qué hay en la web

- **Ranking de empresas tech** en España ordenado por sueldo base mediano, con buscador.
- **Salarios por rol**: ingeniería de software, producto, datos, diseño, gestión y más de 30 roles.
- **Salarios por comunidad autónoma** en un mapa: Madrid, Cataluña (Barcelona), País Vasco, Comunidad Valenciana, Andalucía y el resto.
- **Sueldo según la experiencia**, de programador junior a más de 20 años.
- **Remoto, híbrido o presencial**.
- **Ofertas de empleo tech** abiertas en estas empresas, recogidas cada día, en [JSON](https://spanishtoptechcompanies.com/api/v1/jobs.json) y en el servidor MCP.
- **Para desarrolladores**: los datos en [JSON](https://spanishtoptechcompanies.com/api/v1/data.json), un resumen en [llms.txt](https://spanishtoptechcompanies.com/llms.txt) y el [servidor MCP](https://spanishtoptechcompanies.com/mcp).

### Cómo se calcula

Cada salario viene de [Levels.fyi](https://www.levels.fyi) y solo cuenta si la ubicación de esa persona está en España. Aparecen todas las empresas, paguen lo que paguen, ordenadas por la mediana de su sueldo base; cada una tiene página de LinkedIn o web, y tiene en Levels.fyi al menos 5 salarios de cualquier país sumando todos los roles: una empresa que nadie más ha reportado no aparece. Las empresas con menos de 3 salarios se listan después de las demás. Los salarios se resumen por empresa, rol, región y experiencia, y los importes de la web se redondean a 1.000 €. Los detalles están en [METHODOLOGY.md](METHODOLOGY.md#the-website-and-the-mcp-server).

### Añade tu salario

Súbelo a [Levels.fyi](https://www.levels.fyi/salaries/add). La lista se rehace con los salarios de España que hay allí, así que cuenta desde la siguiente actualización. Es anónimo. Si sabes de primera mano lo que paga una empresa, o tienes una oferta por escrito, abre un [issue](../../issues/new?template=update-band.yml).

## English

**Software engineer salary in Spain**: what developers earn at the **top tech companies in Spain**, ranked at [spanishtoptechcompanies.com](https://spanishtoptechcompanies.com/en/). Real salaries from people working in Spain: each company's median base salary, total pay with bonus and stock, and how many earn €60,000 or more. Filter by role (software developer, data scientist, product manager and 30+ more), by years of experience from junior to senior, by remote, hybrid or office work, and by region on a map. And connect your AI agent to the site's MCP server so it [searches tech jobs in Spain at these companies and applies for you](#let-your-agent-apply-for-you), with nothing to install.

**[See the company ranking →](https://spanishtoptechcompanies.com/en/)**

### Developer salaries by role, city and company

Every role, region and company has its own page with the median base salary, the range, total pay with bonus and stock, and pay by years of experience:

- **By role**: [software engineer and developer salary in Spain](https://spanishtoptechcompanies.com/en/salaries/software-engineer/), [data scientist](https://spanishtoptechcompanies.com/en/salaries/data-scientist/), [product manager](https://spanishtoptechcompanies.com/en/salaries/product-manager/), [engineering manager](https://spanishtoptechcompanies.com/en/salaries/software-engineering-manager/), [product designer](https://spanishtoptechcompanies.com/en/salaries/product-designer/), [data analyst](https://spanishtoptechcompanies.com/en/salaries/data-analyst/), [solution architect](https://spanishtoptechcompanies.com/en/salaries/solution-architect/) and [every role](https://spanishtoptechcompanies.com/en/salaries/).
- **Software engineers by city**: [Madrid](https://spanishtoptechcompanies.com/en/salaries/software-engineer/madrid/), [Barcelona](https://spanishtoptechcompanies.com/en/salaries/software-engineer/catalonia/), [Valencia](https://spanishtoptechcompanies.com/en/salaries/software-engineer/valencian-community/), [Málaga and Seville](https://spanishtoptechcompanies.com/en/salaries/software-engineer/andalusia/), [Bilbao](https://spanishtoptechcompanies.com/en/salaries/software-engineer/basque-country/) and [Zaragoza](https://spanishtoptechcompanies.com/en/salaries/software-engineer/aragon/).
- **By region**, every role: [Madrid](https://spanishtoptechcompanies.com/en/salaries/madrid/), [Catalonia](https://spanishtoptechcompanies.com/en/salaries/catalonia/), [Valencia](https://spanishtoptechcompanies.com/en/salaries/valencian-community/), [Andalusia](https://spanishtoptechcompanies.com/en/salaries/andalusia/) and [the Basque Country](https://spanishtoptechcompanies.com/en/salaries/basque-country/).
- **By company**: [Revolut](https://spanishtoptechcompanies.com/en/companies/revolut/), [Glovo](https://spanishtoptechcompanies.com/en/companies/glovo/), [Amazon](https://spanishtoptechcompanies.com/en/companies/amazon/), [Datadog](https://spanishtoptechcompanies.com/en/companies/datadog/), [N26](https://spanishtoptechcompanies.com/en/companies/n26/), [TravelPerk](https://spanishtoptechcompanies.com/en/companies/travelperk/), [Cabify](https://spanishtoptechcompanies.com/en/companies/cabify/) and [every other tech company in Spain](https://spanishtoptechcompanies.com/en/salaries/#all-companies).

### Let your agent apply for you

An AI agent that applies to jobs for you, without filling in a form. Every day the site collects the open positions of the listed companies from their public job boards (Greenhouse, Lever, Ashby, Workday and others), in Spain or remote from Spain. Your agent searches them with each company's median salary alongside, reads the posting's application form, writes the cover letter and the answers from your CV, shows you the full application and sends it when you say yes.

It works with any agent that supports MCP. People use it mostly from Codex and Cursor; Claude Code, Claude, Instinct and Hermes work too.

1. **Ask it to connect.** Paste this into the chat. It adds the MCP server itself, with no sign-in and nothing to install:

   > Connect to this MCP server: https://spanishtoptechcompanies.com/mcp

   That brings the salary tools and the job tools (`find_jobs`, `job_questions`, `application_guide` and `report_application`). If it asks you to open a new session to load it, do so.

2. **Give it your CV and what you want.** Only once, in the chat: your CV, where and how you want to work and the salary you ask for. Your profile stays with your agent, in its memory or in a file such as `~/job-search.md`; the site stores nothing about you. It sends each application with its own browser, and without a browser it gives you the link and the answers to send it yourself. If a board emails a code, it reads it from your mail if you connect it, or asks you.

3. **Tell it to apply.** For example:

   > Apply for me to openings at the companies on spanishtoptechcompanies.com that pay €60,000 or more to someone with my experience in Madrid.

   Or: "Apply to 5 backend openings in Barcelona", "Find remote jobs I can take from Spain", "What does Revolut pay a senior software engineer?". Sensitive questions, like salary or work permit, it asks you once, all in one message, and privacy consents are yours to accept. If a form asks for a CAPTCHA, it hands you the page: you solve it and it sends the application.

<details>
<summary>Set it up by hand</summary>

- Codex: `codex mcp add tech-pay-spain --url https://spanishtoptechcompanies.com/mcp`
- Claude Code: `claude mcp add --transport http tech-pay-spain https://spanishtoptechcompanies.com/mcp`
- Cursor, in `~/.cursor/mcp.json`: `{"mcpServers": {"tech-pay-spain": {"url": "https://spanishtoptechcompanies.com/mcp"}}}`
- Claude or Instinct: add the URL as a custom connector.
- Hermes and other [agentskills.io](https://agentskills.io) agents: the [tech-pay-spain](skills/tech-pay-spain/SKILL.md) skill.

</details>

### FAQ

**What is the average software engineer salary in Spain?** It depends mostly on the company, experience and city. The [software engineer salary page](https://spanishtoptechcompanies.com/en/salaries/software-engineer/) gives the median base salary (gross, per year), the range and pay from junior to senior, from salaries refreshed every week. It uses the median rather than the average, so a few very high salaries do not skew it.

**Which tech companies in Spain pay the most?** The [ranking](https://spanishtoptechcompanies.com/en/) sorts every company by median base salary, filtered by role, experience, city and remote work: the best-paying tech companies to work for in Spain.

**How much do junior and senior developers earn in Spain?** Every role page breaks pay down by years of experience: 0-1, 2-4, 5-7, 8-11, 12-19 and 20+.

**What about Madrid or Barcelona?** Every role has a page per region, such as [software engineer salary in Madrid](https://spanishtoptechcompanies.com/en/salaries/software-engineer/madrid/) or [in Barcelona and Catalonia](https://spanishtoptechcompanies.com/en/salaries/software-engineer/catalonia/).

**Where can I find IT jobs in Spain?** The open positions come from the listed companies' own job boards, in Spain or remote from Spain, refreshed daily. Your agent searches them through the MCP server, or you can read [the daily list as JSON](https://spanishtoptechcompanies.com/api/v1/jobs.json).

**Is this Levels.fyi for Spain?** The salaries come from Levels.fyi, but only those of people working in Spain count, summarised by company, role, city and experience, in euros. No salary from another country is ever mixed in.

### On the site

- **Tech companies in Spain ranked** by median base salary, with search.
- **Salaries by role**: software engineering, product, data, design, management and 30+ more roles.
- **Salaries by region** on a map: Madrid, Catalonia (Barcelona), the Basque Country, Valencia, Andalusia and the rest.
- **Pay by experience**, from junior developer to 20+ years.
- **Remote, hybrid or office**.
- **Open tech jobs in Spain** at these companies, collected every day, as [JSON](https://spanishtoptechcompanies.com/api/v1/jobs.json) and through the MCP server.
- **For developers**: the data as [JSON](https://spanishtoptechcompanies.com/api/v1/data.json), a summary in [llms.txt](https://spanishtoptechcompanies.com/llms.txt) and the [MCP server](https://spanishtoptechcompanies.com/mcp).

### How it is calculated

Every salary comes from [Levels.fyi](https://www.levels.fyi) and counts only if that person's location is in Spain. Every company is listed whatever it pays, ranked by its median base salary; each one has a LinkedIn page or a website, and has at least 5 salaries on Levels.fyi from anywhere in the world over every role: a company nobody else has reported is not shown. Companies with fewer than 3 salaries are listed after the rest. Salaries are summarised by company, role, region and experience, and the site rounds every amount to €1,000. The details are in [METHODOLOGY.md](METHODOLOGY.md#the-website-and-the-mcp-server).

### Add your salary

Submit it on [Levels.fyi](https://www.levels.fyi/salaries/add). The list is rebuilt from the Spanish salaries there, so yours counts from the next update. It is anonymous. If you know first-hand what a company pays, or have an offer letter, open an [issue](../../issues/new?template=update-band.yml).

## Contribuir · Contributing

Los pull requests son bienvenidos: el pipeline, la metodología, la web o las comprobaciones. [METHODOLOGY.md](METHODOLOGY.md) explica las reglas y [docs/CONTEXT.md](docs/CONTEXT.md) lo que ha salido mal antes y por qué el código es como es.

Pull requests are welcome for the pipeline, the methodology, the site or the checks. Open an [issue](../../issues/new/choose) first if you want to talk it through.

## Licencia · Licence

El código es [MIT](LICENSE) y los datos de `data/` [CC BY-SA 4.0](LICENSE-DATA). Los salarios se leen de [Levels.fyi](https://www.levels.fyi) y siguen sujetos a sus condiciones.

Code is [MIT](LICENSE), the data in `data/` is [CC BY-SA 4.0](LICENSE-DATA). Salaries are read from Levels.fyi, and its terms still apply to them.

> Data source: Levels.fyi (https://www.levels.fyi)

## Aviso · Disclaimer

Proyecto independiente, sin relación con Levels.fyi ni con ninguna de las empresas. Las cifras resumen salarios que otras personas han reportado. Pueden estar incompletas, desactualizadas o mal, y no son ofertas ni asesoramiento financiero o legal. Si quieres que se quite o corrija algo, sobre una empresa o sobre ti, abre un [issue](../../issues/new/choose) o escribe a ugartep117@gmail.com. Quién está detrás y qué datos se tratan: [aviso legal y privacidad](https://spanishtoptechcompanies.com/es/legal/).

This is an independent project, not affiliated with or endorsed by Levels.fyi or any company listed. The figures summarise salaries other people reported. They can be incomplete, out of date or wrong, and they are not offers, guarantees, or financial or legal advice. Company names belong to their owners. If you want something removed or corrected, whether about a company or about yourself, open an [issue](../../issues/new/choose) or write to ugartep117@gmail.com and it will be taken down. Who runs this and what data it handles: [legal notice and privacy](https://spanishtoptechcompanies.com/en/legal/).
