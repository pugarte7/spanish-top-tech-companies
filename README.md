# Empresas tech que más pagan en España

**[spanishtoptechcompanies.com](https://spanishtoptechcompanies.com/es/)** · Spanish Top Tech Companies · [English](#english)

El ranking de las empresas tecnológicas que mejor pagan en España, con salarios reales de gente que trabaja aquí. Para cada empresa verás el sueldo base mediano, el total con bonus y acciones y cuánta gente cobra 60.000 € o más. Puedes filtrarlo por rol, años de experiencia y modalidad de trabajo, y ver en un mapa lo que se paga en cada comunidad autónoma. Y con su servidor MCP, [tu agente de IA aplica por ti](#deja-que-tu-agente-aplique-por-ti) a sus ofertas.

**[Ver el ranking completo →](https://spanishtoptechcompanies.com/es/)**

### Deja que tu agente aplique por ti

Conecta tu agente de IA y aplica automáticamente a las ofertas de estas empresas sin tocar un formulario. Busca las ofertas, las rellena con tu CV y envía la solicitud en Greenhouse, Lever, Ashby y Workday, las plataformas de empleo que usan muchas empresas tech. También encuentra ofertas en SmartRecruiters, Workable y Recruitee. Te ahorras horas.

Funciona con Claude Code, Codex, Cursor, Grok CLI, Hermes e Instinct, o con cualquier agente que admita MCP.

1. **Conecta los sueldos.** Añade este servidor MCP a tu agente, sin registro:

   ```
   https://spanishtoptechcompanies.com/mcp
   ```

   En Claude Code: `claude mcp add --transport http tech-pay-spain https://spanishtoptechcompanies.com/mcp`

2. **Dale tu CV y lo que buscas.** Una sola vez. El agente instala [autoapply-mcp](https://github.com/pugarte7/autoapply-mcp) por su cuenta y te pide tu CV, dónde y cómo quieres trabajar, el sueldo que pides y un correo para los códigos de verificación.

3. **Dile que aplique.** Por ejemplo:

   > Aplica por mí a las ofertas de las empresas de spanishtoptechcompanies.com que pagan 60.000 € o más a alguien con mi experiencia en Madrid.

   Tú solo das el visto bueno. Las preguntas delicadas, como sueldo o permiso de trabajo, siempre te las hace a ti, y si un formulario pide un CAPTCHA te devuelve esa solicitud para que la termines tú.

### Qué hay en la web

- **Ranking de empresas tech** ordenado por sueldo base mediano, con buscador.
- **Sueldos por rol**: ingeniería de software, producto, datos, diseño, gestión y más de 30 roles.
- **Sueldos por comunidad autónoma** en un mapa: Madrid, Cataluña (Barcelona), País Vasco, Comunidad Valenciana, Andalucía y el resto.
- **Sueldo según la experiencia**, de 0 a más de 20 años.
- **Remoto, híbrido o presencial**.
- **Para desarrolladores**: los datos en [JSON](https://spanishtoptechcompanies.com/api/v1/data.json) y un resumen en [llms.txt](https://spanishtoptechcompanies.com/llms.txt).

### Cómo se calcula

Cada salario viene de [Levels.fyi](https://www.levels.fyi) y solo cuenta si la ubicación de esa persona está en España. Una empresa aparece si la mediana del sueldo base de todos sus salarios llega a 45.000 €, tiene página de LinkedIn o web, y tiene en Levels.fyi al menos 5 salarios de cualquier país sumando todos los roles: una empresa que nadie más ha reportado no aparece. Las empresas con menos de 3 salarios se listan después de las demás. Los salarios se resumen por empresa, rol, región y experiencia, y los importes de la web se redondean a 1.000 €. Los detalles están en [METHODOLOGY.md](METHODOLOGY.md#the-website-and-the-mcp-server).

### Añade tu salario

Súbelo a [Levels.fyi](https://www.levels.fyi/salaries/add). La lista se rehace con los salarios de España que hay allí, así que cuenta desde la siguiente actualización. Es anónimo. Si sabes de primera mano lo que paga una empresa, o tienes una oferta por escrito, abre un [issue](../../issues/new?template=update-band.yml).

## English

The **best-paying tech companies in Spain**, ranked by salary at [spanishtoptechcompanies.com](https://spanishtoptechcompanies.com/en/). Real salaries from people working in Spain: each company's median base salary, total pay with bonus and stock, and how many earn €60,000 or more. Filter by role, years of experience and remote, hybrid or office work, and see on a map what each region pays. And with its MCP server, [your AI agent applies to their openings for you](#let-your-agent-apply-for-you).

**[See the full ranking →](https://spanishtoptechcompanies.com/en/)**

### Let your agent apply for you

Connect your AI agent and auto-apply to these companies' openings without filling in a form. It finds the openings, fills them in from your CV and sends the application on Greenhouse, Lever, Ashby and Workday, the job platforms many tech companies use. It also finds openings on SmartRecruiters, Workable and Recruitee. It saves you hours.

Works with Claude Code, Codex, Cursor, Grok CLI, Hermes and Instinct, or any agent that supports MCP.

1. **Connect the salaries.** Add this MCP server to your agent, no sign-in:

   ```
   https://spanishtoptechcompanies.com/mcp
   ```

   In Claude Code: `claude mcp add --transport http tech-pay-spain https://spanishtoptechcompanies.com/mcp`

2. **Give it your CV and what you want.** Only once. The agent installs [autoapply-mcp](https://github.com/pugarte7/autoapply-mcp) on its own and asks for your CV, where and how you want to work, the salary you ask for and a mailbox for verification codes.

3. **Tell it to apply.** For example:

   > Apply for me to openings at the companies on spanishtoptechcompanies.com that pay €60,000 or more to someone with my experience in Madrid.

   You only give the go-ahead. Sensitive questions, like salary or work permit, it always asks you, and if a form asks for a CAPTCHA it hands that application back for you to finish.

### On the site

- **Tech companies ranked** by median base salary, with search.
- **Salaries by role**: software engineering, product, data, design, management and 30+ more roles.
- **Salaries by region** on a map: Madrid, Catalonia (Barcelona), the Basque Country, Valencia, Andalusia and the rest.
- **Pay by experience**, from 0 to 20+ years.
- **Remote, hybrid or office**.
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

Proyecto independiente, sin relación con Levels.fyi ni con ninguna de las empresas. Las cifras resumen salarios que otras personas han reportado. Pueden estar incompletas, desactualizadas o mal, y no son ofertas ni asesoramiento financiero o legal. Si quieres que se quite o corrija algo, sobre una empresa o sobre ti, abre un [issue](../../issues/new/choose).

This is an independent project, not affiliated with or endorsed by Levels.fyi or any company listed. The figures summarise salaries other people reported. They can be incomplete, out of date or wrong, and they are not offers, guarantees, or financial or legal advice. Company names belong to their owners. If you want something removed or corrected, whether about a company or about yourself, open an [issue](../../issues/new/choose) and it will be taken down.
