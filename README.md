# Salario de programador en España: las empresas tech que más pagan

**[spanishtoptechcompanies.com](https://spanishtoptechcompanies.com/es/)** · Spanish Top Tech Companies · [English](#english)

Cuánto cobra un programador en España y qué empresas tecnológicas pagan más, con salarios reales de gente que trabaja aquí, sacados de Levels.fyi. Para cada empresa verás el sueldo base mediano, el total con bonus y acciones y cuánta gente cobra 60.000 € o más. Puedes filtrarlo por rol, años de experiencia y modalidad de trabajo, y ver en un mapa lo que se paga en cada comunidad autónoma. Y con su servidor MCP, [tu agente de IA busca sus ofertas abiertas y aplica por ti](#deja-que-tu-agente-aplique-por-ti), sin instalar nada.

**[Ver el ranking completo →](https://spanishtoptechcompanies.com/es/)**

### Salarios por rol, ciudad y empresa

Cada rol, comunidad y empresa tiene su página con el sueldo base mediano, la horquilla, el total con bonus y acciones y lo que se cobra según los años de experiencia:

- **Por rol**: [salario de programador](https://spanishtoptechcompanies.com/es/salarios/software-engineer/), [data scientist](https://spanishtoptechcompanies.com/es/salarios/data-scientist/), [product manager](https://spanishtoptechcompanies.com/es/salarios/product-manager/), [engineering manager](https://spanishtoptechcompanies.com/es/salarios/software-engineering-manager/), [diseñador de producto](https://spanishtoptechcompanies.com/es/salarios/product-designer/), [analista de datos](https://spanishtoptechcompanies.com/es/salarios/data-analyst/) y [todos los roles](https://spanishtoptechcompanies.com/es/salarios/).
- **Programador por ciudad**: [Madrid](https://spanishtoptechcompanies.com/es/salarios/software-engineer/madrid/), [Barcelona](https://spanishtoptechcompanies.com/es/salarios/software-engineer/cataluna/), [Valencia](https://spanishtoptechcompanies.com/es/salarios/software-engineer/comunidad-valenciana/), [Málaga y Sevilla](https://spanishtoptechcompanies.com/es/salarios/software-engineer/andalucia/), [Bilbao](https://spanishtoptechcompanies.com/es/salarios/software-engineer/pais-vasco/) y [Zaragoza](https://spanishtoptechcompanies.com/es/salarios/software-engineer/aragon/).
- **Por empresa**: [Revolut](https://spanishtoptechcompanies.com/es/empresas/revolut/), [Glovo](https://spanishtoptechcompanies.com/es/empresas/glovo/), [Amazon](https://spanishtoptechcompanies.com/es/empresas/amazon/), [Datadog](https://spanishtoptechcompanies.com/es/empresas/datadog/), [N26](https://spanishtoptechcompanies.com/es/empresas/n26/), [TravelPerk](https://spanishtoptechcompanies.com/es/empresas/travelperk/), [Cabify](https://spanishtoptechcompanies.com/es/empresas/cabify/) y [el resto](https://spanishtoptechcompanies.com/es/salarios/#all-companies).

### Deja que tu agente aplique por ti

Conecta tu agente de IA al servidor MCP de la web y aplica a las ofertas de estas empresas sin tocar un formulario y sin instalar nada. Cada día la web recoge las ofertas abiertas de las empresas de la lista en sus portales de empleo públicos (Greenhouse, Lever, Ashby, Workday y otros), en España o en remoto desde España. Tu agente busca entre ellas con el sueldo mediano de cada empresa al lado, lee el formulario de la oferta, escribe la carta y las respuestas con tu CV, te enseña la solicitud completa y la envía cuando le dices que sí. Te ahorras horas.

Funciona mejor con Instinct y, si no, con Claude Code. También sirven Codex, Cursor, Grok CLI, Hermes o cualquier agente que admita MCP.

1. **Conecta sueldos y ofertas.** Añade este servidor MCP a tu agente, sin registro. Trae las herramientas de sueldos y las de ofertas: `find_jobs`, `job_questions`, `application_guide` y `report_application`.

   ```
   https://spanishtoptechcompanies.com/mcp
   ```

   En Claude Code: `claude mcp add --transport http tech-pay-spain https://spanishtoptechcompanies.com/mcp`

2. **Dale tu CV y lo que buscas.** Una sola vez, en el chat: tu CV, dónde y cómo quieres trabajar y el sueldo que pides. Tu perfil se queda en tu agente, en su memoria o en un archivo como `~/job-search.md`; la web no guarda nada tuyo. Envía cada solicitud con su propio navegador, y si no tiene navegador te da el enlace y las respuestas para que la envíes tú. Si una empresa manda un código por correo, lo lee de tu correo si se lo conectas, o te lo pide.

3. **Dile que aplique.** Por ejemplo:

   > Aplica por mí a las ofertas de las empresas de spanishtoptechcompanies.com que pagan 60.000 € o más a alguien con mi experiencia en Madrid.

   Te enseña cada solicitud completa y la envía cuando le dices que sí. Las preguntas delicadas, como sueldo o permiso de trabajo, te las hace una vez, todas en un mensaje, y los consentimientos de privacidad los aceptas tú. Si un formulario pide un CAPTCHA, te pasa la página: lo resuelves y envía la solicitud.


### Qué hay en la web

- **Ranking de empresas tech** ordenado por sueldo base mediano, con buscador.
- **Sueldos por rol**: ingeniería de software, producto, datos, diseño, gestión y más de 30 roles.
- **Sueldos por comunidad autónoma** en un mapa: Madrid, Cataluña (Barcelona), País Vasco, Comunidad Valenciana, Andalucía y el resto.
- **Sueldo según la experiencia**, de 0 a más de 20 años.
- **Remoto, híbrido o presencial**.
- **Ofertas de empleo tech** abiertas en estas empresas, recogidas cada día, en [JSON](https://spanishtoptechcompanies.com/api/v1/jobs.json) y en el servidor MCP.
- **Para desarrolladores**: los datos en [JSON](https://spanishtoptechcompanies.com/api/v1/data.json) y un resumen en [llms.txt](https://spanishtoptechcompanies.com/llms.txt).

### Cómo se calcula

Cada salario viene de [Levels.fyi](https://www.levels.fyi) y solo cuenta si la ubicación de esa persona está en España. Una empresa aparece si la mediana del sueldo base de todos sus salarios llega a 45.000 €, tiene página de LinkedIn o web, y tiene en Levels.fyi al menos 5 salarios de cualquier país sumando todos los roles: una empresa que nadie más ha reportado no aparece. Las empresas con menos de 3 salarios se listan después de las demás. Los salarios se resumen por empresa, rol, región y experiencia, y los importes de la web se redondean a 1.000 €. Los detalles están en [METHODOLOGY.md](METHODOLOGY.md#the-website-and-the-mcp-server).

### Añade tu salario

Súbelo a [Levels.fyi](https://www.levels.fyi/salaries/add). La lista se rehace con los salarios de España que hay allí, así que cuenta desde la siguiente actualización. Es anónimo. Si sabes de primera mano lo que paga una empresa, o tienes una oferta por escrito, abre un [issue](../../issues/new?template=update-band.yml).

## English

**Software engineer salaries in Spain** and the **best-paying tech companies in Spain**, ranked at [spanishtoptechcompanies.com](https://spanishtoptechcompanies.com/en/). Real salaries from people working in Spain: each company's median base salary, total pay with bonus and stock, and how many earn €60,000 or more. Filter by role, years of experience and remote, hybrid or office work, and see on a map what each region pays. And with its MCP server, [your AI agent searches their open positions and applies for you](#let-your-agent-apply-for-you), with nothing to install.

**[See the full ranking →](https://spanishtoptechcompanies.com/en/)**

### Salaries by role, city and company

Every role, region and company has its own page with the median base salary, the range, total pay with bonus and stock, and pay by years of experience:

- **By role**: [software engineer salary in Spain](https://spanishtoptechcompanies.com/en/salaries/software-engineer/), [data scientist](https://spanishtoptechcompanies.com/en/salaries/data-scientist/), [product manager](https://spanishtoptechcompanies.com/en/salaries/product-manager/), [engineering manager](https://spanishtoptechcompanies.com/en/salaries/software-engineering-manager/), [product designer](https://spanishtoptechcompanies.com/en/salaries/product-designer/), [data analyst](https://spanishtoptechcompanies.com/en/salaries/data-analyst/) and [every role](https://spanishtoptechcompanies.com/en/salaries/).
- **Software engineers by city**: [Madrid](https://spanishtoptechcompanies.com/en/salaries/software-engineer/madrid/), [Barcelona](https://spanishtoptechcompanies.com/en/salaries/software-engineer/catalonia/), [Valencia](https://spanishtoptechcompanies.com/en/salaries/software-engineer/valencian-community/), [Málaga and Seville](https://spanishtoptechcompanies.com/en/salaries/software-engineer/andalusia/), [Bilbao](https://spanishtoptechcompanies.com/en/salaries/software-engineer/basque-country/) and [Zaragoza](https://spanishtoptechcompanies.com/en/salaries/software-engineer/aragon/).
- **By company**: [Revolut](https://spanishtoptechcompanies.com/en/companies/revolut/), [Glovo](https://spanishtoptechcompanies.com/en/companies/glovo/), [Amazon](https://spanishtoptechcompanies.com/en/companies/amazon/), [Datadog](https://spanishtoptechcompanies.com/en/companies/datadog/), [N26](https://spanishtoptechcompanies.com/en/companies/n26/), [TravelPerk](https://spanishtoptechcompanies.com/en/companies/travelperk/), [Cabify](https://spanishtoptechcompanies.com/en/companies/cabify/) and [the rest](https://spanishtoptechcompanies.com/en/salaries/#all-companies).

### Let your agent apply for you

Connect your AI agent to the site's MCP server and apply to these companies' openings without filling in a form and with nothing to install. Every day the site collects the open positions of the listed companies from their public job boards (Greenhouse, Lever, Ashby, Workday and others), in Spain or remote from Spain. Your agent searches them with each company's median salary alongside, reads the posting's application form, writes the cover letter and the answers from your CV, shows you the full application and sends it when you say yes. It saves you hours.

Works best with Instinct, or else Claude Code. Codex, Cursor, Grok CLI, Hermes or any agent that supports MCP work too.

1. **Connect salaries and openings.** Add this MCP server to your agent, no sign-in. It brings the salary tools and the job tools: `find_jobs`, `job_questions`, `application_guide` and `report_application`.

   ```
   https://spanishtoptechcompanies.com/mcp
   ```

   In Claude Code: `claude mcp add --transport http tech-pay-spain https://spanishtoptechcompanies.com/mcp`

2. **Give it your CV and what you want.** Only once, in the chat: your CV, where and how you want to work and the salary you ask for. Your profile stays with your agent, in its memory or in a file such as `~/job-search.md`; the site stores nothing about you. It sends each application with its own browser, and without a browser it gives you the link and the answers to send it yourself. If a board emails a code, it reads it from your mail if you connect it, or asks you.

3. **Tell it to apply.** For example:

   > Apply for me to openings at the companies on spanishtoptechcompanies.com that pay €60,000 or more to someone with my experience in Madrid.

   It shows you each application in full and sends it when you say yes. Sensitive questions, like salary or work permit, it asks you once, all in one message, and privacy consents are yours to accept. If a form asks for a CAPTCHA, it hands you the page: you solve it and it sends the application.


### On the site

- **Tech companies ranked** by median base salary, with search.
- **Salaries by role**: software engineering, product, data, design, management and 30+ more roles.
- **Salaries by region** on a map: Madrid, Catalonia (Barcelona), the Basque Country, Valencia, Andalusia and the rest.
- **Pay by experience**, from 0 to 20+ years.
- **Remote, hybrid or office**.
- **Open tech jobs in Spain** at these companies, collected every day, as [JSON](https://spanishtoptechcompanies.com/api/v1/jobs.json) and through the MCP server.
- **For developers**: the data as [JSON](https://spanishtoptechcompanies.com/api/v1/data.json) and a summary in [llms.txt](https://spanishtoptechcompanies.com/llms.txt).

### How it is calculated

Every salary comes from [Levels.fyi](https://www.levels.fyi) and counts only if that person's location is in Spain. A company is listed when the median base salary over all its salaries reaches €45,000, it has a LinkedIn page or a website, and it has at least 5 salaries on Levels.fyi from anywhere in the world over every role: a company nobody else has reported is not shown. Companies with fewer than 3 salaries are listed after the rest. Salaries are summarised by company, role, region and experience, and the site rounds every amount to €1,000. The details are in [METHODOLOGY.md](METHODOLOGY.md#the-website-and-the-mcp-server).

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
