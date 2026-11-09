// What a job posting is: its likely roles, the level its title names, the years
// of experience its text asks for and the Spanish regions its location names.
//
// Shared by scripts/jobs.mjs, which stores these in /api/v1/jobs.json when it
// crawls (the description is read there and never stored), and api/mcp.js,
// which filters on them and works them out itself, from the title and the
// location, for a posting stored before they existed. Not a Vercel Function:
// files starting with _ in api/ are not served.

export const norm = (text) => String(text ?? "").normalize("NFKD").replace(/[^\x00-\x7f]/g, "")
  .toLowerCase().replace(/-/g, " ").split(/\s+/).filter(Boolean).join(" ");

// Lowercase ASCII words: accents, case and punctuation do not matter. Keeps +
// and # so c++ and c# stay apart from c. Spanish titles name both genders
// ("Ingeniero/a", "Jefe/a", "Delegad@"): the first form stands for both.
export const words = (text) => norm(text)
  .replace(/([a-z])\s*\/\s*(?:a|as|ra|ras)\b/g, "$1").replace(/([a-z])\s*\((?:a|as)\)/g, "$1")
  .replace(/([a-z])@/g, "$1o")
  .replace(/[^a-z0-9+#]+/g, " ").trim();

// --- Places --------------------------------------------------------------------------

// Other names of a region, and its main cities; "/" joins names of one city,
// and the first is the one reported back.
export const REGION_NAMES = {
  AN: "Andalucía, Andalusia", AR: "Aragón, Aragon", AS: "Asturias", CB: "Cantabria",
  CE: "Ceuta", CL: "Castilla y León, Castile and León", CM: "Castilla La Mancha, Castile La Mancha",
  CN: "Canary Islands, Canarias", CT: "Catalunya, Catalonia, Cataluña", EX: "Extremadura",
  GA: "Galicia", IB: "Balearic Islands, Illes Balears, Islas Baleares, Baleares",
  MD: "Madrid, Comunidad de Madrid, Community of Madrid", ML: "Melilla",
  MU: "Murcia, Región de Murcia, Region of Murcia", NC: "Navarra, Navarre",
  PV: "Euskadi, Basque Country, País Vasco", RI: "La Rioja",
  VC: "Comunidad Valenciana, Comunitat Valenciana, Valencian Community, C. Valenciana",
};
export const CITIES = {
  AN: "Sevilla/Seville, Málaga, Granada, Córdoba, Cádiz, Almería, Huelva, Jaén, Jerez, Marbella",
  AR: "Zaragoza, Huesca, Teruel", AS: "Oviedo, Gijón", CB: "Santander", CE: "Ceuta",
  CL: "Valladolid, León, Burgos, Salamanca, Segovia, Ávila, Soria, Palencia, Zamora",
  CM: "Toledo, Albacete, Ciudad Real, Cuenca, Guadalajara",
  CN: "Las Palmas/Las Palmas de Gran Canaria, Santa Cruz de Tenerife, Tenerife, Gran Canaria",
  CT: "Barcelona, Girona/Gerona, Lleida/Lérida, Tarragona, Sabadell, Terrassa, Sant Cugat/Sant Cugat del Vallès",
  EX: "Badajoz, Cáceres, Mérida",
  GA: "A Coruña/La Coruña/Coruña, Vigo, Santiago de Compostela/Santiago, Pontevedra, Lugo, Ourense",
  IB: "Palma/Palma de Mallorca, Mallorca/Majorca, Ibiza/Eivissa, Menorca",
  MD: "Alcobendas, Las Rozas, Pozuelo/Pozuelo de Alarcón, Getafe, Tres Cantos",
  ML: "Melilla", MU: "Cartagena", NC: "Pamplona/Iruña",
  PV: "Bilbao, San Sebastián/Donostia/Donostia-San Sebastián, Vitoria/Vitoria-Gasteiz/Gasteiz",
  RI: "Logroño", VC: "Valencia/València, Alicante/Alacant, Castellón/Castelló, Elche/Elx",
};
const split = (text, sep) => String(text ?? "").split(sep).map((x) => x.trim()).filter(Boolean);
export const plainWords = (text) => norm(text).replace(/[^a-z0-9]+/g, " ").trim();
// Every place name as [words, region code, city or null].
export const PLACES = [
  ...Object.entries(REGION_NAMES).flatMap(([code, names]) => split(names, ",").map((n) => [n, code, null])),
  ...Object.entries(CITIES).flatMap(([code, list]) => split(list, ",").flatMap((group) =>
    split(group, "/").map((n) => [n, code, split(group, "/")[0]]))),
].map(([name, code, city]) => [plainWords(name), code, city]);
// The names of one city, or of every place in a region, as found in a location.
export const placeNames = (code, city) =>
  PLACES.filter(([, c, ci]) => c === code && (!city || ci === city)).map(([n]) => n);

const hasPhrase = (haystack, phrase) => ` ${haystack} `.includes(` ${phrase} `);

// The region codes a location names, by region or city, in the order of PLACES.
export function regionsOf(location) {
  const where = words(location);
  if (!where) return [];
  const found = new Set();
  for (const [name, code] of PLACES) if (name && hasPhrase(where, name)) found.add(code);
  return [...found];
}

// --- Roles ---------------------------------------------------------------------------

// Engineering that is not software: a bare "engineer" in a title with one of
// these, and none of SOFTWARE, is not a software engineer (Airbus's "Landing
// Gear Engineer" got software medians when every engineer was one).
const PHYSICAL = /\b(aerospace|aeronaut\w*|aerodynamics?|aircraft|airframe|landing gear|propulsion|avionics|flight|stress|structures?|structural|estructur\w*|mechanical|mecanic\w*|manufactur\w*|industri\w*|process|procesos|production|produccion|maintenance|mantenimiento|chemical|quimic\w*|civil|electric\w*|hvac|climatiz\w*|installation|instalacion\w*|field service|quality|calidad|materials?|materiales|thermal|piping|plant|planta|construction|construccion|obra|mining|petroleum|naval|nuclear|automotive|automocion|rail|ferroviari\w*|telecom\w*|rf|hardware|electronic\w*|optical|photonics|biomedical|clinical|energ\w*|renovables|solar|eolic\w*|subestacion\w*|alta tension|aeropuertos?)\b/;
const SOFTWARE = /\b(software|backend|frontend|front end|back end|full ?stack|web|mobile|ios|android|data|ml|machine learning|ai|cloud|devops|sre|platform|infrastructure|security|qa|test automation|automation|sdet|api|java|python|golang|go|javascript|typescript|react|node|kotlin|scala|ruby|php|net|c\+\+|c#|rust|firmware|embedded|site reliability|systems?|network|database|salesforce|sap|integration|solutions?|applications?|computer vision|llm|genai|analytics|bi|developer|deployed)\b/;

const NOT_SOFTWARE = { test: (t) => PHYSICAL.test(t) && !SOFTWARE.test(t) };

// A posting's roles, from its title, in data.json's role vocabulary. Every
// entry that matches counts, in this order: the narrower titles come first
// ("Sales Engineer" before software-engineer). Each entry is [slug, pattern,
// unless]; patterns read words(title).
export const ROLE_TITLES = [
  ["sales-engineer", /\b(sales|solutions?|pre ?sales) engineering (manager|director|head|lead)\b/],
  ["software-engineering-manager", /\bengineering (manager|director|head)\b|\bmanager (i{1,3} )?(of )?(software |machine learning |ml |data |platform |backend |frontend |mobile |infrastructure )?engineering\b|\b(head|director|vp|vice president) (of )?(software |platform )?engineering\b|\bjefe de (desarrollo|ingenieria)\b/,
    /\b(sales|solutions?|pre ?sales|customer|field|manufacturing|process|quality) engineering\b/],
  ["data-science-manager", /\b(data science|machine learning|ml|analytics) (manager|director|head)\b|\b(head|director) of (data science|machine learning|analytics)\b/],
  ["technical-program-manager", /\btechnical program(me)? manager\b|\btpm\b/],
  ["program-manager", /\bprogram(me)? manager\b/],
  ["project-manager", /\bproject (manager|lead|coordinator)\b|\bscrum master\b|\bdelivery (manager|lead)\b|\bjefe de proyecto/],
  ["product-manager", /\bproduct (manager|owner|lead)\b|\b(head|director|vp) (of )?product\b/],
  ["ux-researcher", /\b(ux|user) research/],
  ["product-designer", /\bdesigner\b|\bdisenador/, NOT_SOFTWARE],
  ["sales-engineer", /\b(sales|solutions?|pre ?sales) engineer\b|\bsolutions? consultant\b/],
  ["solution-architect", /\barchitect\b|\barquitect[oa]\b/, NOT_SOFTWARE],
  ["security-analyst", /\bsecurity (analyst|specialist|operations)\b|\bsoc analyst\b|\bcyber ?security\b|\bciberseguridad\b/, /\b(marketing|sales|account|recruit\w*)\b/],
  ["data-scientist", /\bdata scien|\b(research|applied|applied ai|ai|machine learning|ml) scientist\b|\bcientifico de datos\b/],
  ["data-analyst", /\b(data|bi|business intelligence|analytics|product|marketing) analyst\b|\banalista de datos\b/],
  ["business-analyst", /\bbusiness analyst\b|\banalista de negocio/],
  ["financial-analyst", /\b(financial|finance|fp a) analyst\b/],
  ["legal", /\blegal\b|\bcounsel\b|\blawyer\b|\battorney\b|\bparalegal\b|\babogad[oa]\b|\bjurist/],
  ["aerospace-engineer", /\b(aerospace|aeronautic(al)?|aerodynamics?|aircraft|airframe|landing gear|propulsion|avionics|flight physics|flight test|stress|structures|airworthiness)\b.*\b(engineer|ingenier[oa])\b|\bingenier[oa] aeronautic/],
  ["civil-engineer", /\b(civil|structural|construction) engineer\b|\bingenier[oa] (civil|de caminos)/],
  ["electrical-engineer", /\belectrical (design )?engineer\b|\bingenier[oa] electric/],
  ["mechanical-engineer", /\bmechanical (design )?engineer|\bingenier[oa] mecanic/],
  ["hardware-engineer", /\b(hardware|electronics?|asic|fpga|rf)( design| test| validation| verification)? engineer\b|\bingenier[oa] electronic/],
  ["information-technologist", /\bit (support|specialist|technician|administrator|manager)\b|\bsys ?admin\b|\b(systems?|sap basis|database|db|network|linux|windows|openshift|salesforce|cloud) administrator\b|\badministrador\b|\bhelp ?desk\b|\btecnico (de )?(sistemas|soporte|it|helpdesk)\b/],
  ["customer-success", /\bcustomer success\b/],
  ["recruiter", /\brecruit(er|ing|ment)\b|\btalent (acquisition|partner|sourcer)\b|\bsourcer\b/],
  ["human-resources", /\bhr\b|\bhrbp\b|\bhuman resources\b|\bpeople (partner|operations|ops|business partner|manager|specialist)\b|\brecursos humanos\b|\bpayroll\b/],
  ["marketing-operations", /\bmarketing (operations|ops|automation)\b/],
  ["marketing", /\bmarketing\b|\bseo\b|\bcontent (manager|writer|strategist)\b|\bbrand (manager|designer|lead)\b|\bcommunications? (manager|lead|specialist)\b/],
  ["business-development", /\bbusiness development\b|\bpartnerships? (manager|lead|director)\b|\bbdr\b/],
  ["bizops-manager", /\b(business|biz) ?operations\b|\bbizops\b|\bstrategy (and |& )?operations\b/],
  ["accountant", /\baccount(ant|ing)\b|\bcontable\b|\bbookkeeper\b/],
  ["customer-service", /\bsupport (agent|specialist|engineer|associate|representative)\b|\bcustomer (service|care|support)\b/],
  // Catch-alls, counted only when nothing above matched.
  ["software-engineer", /\b(developer|programmer|sre|devops)\b|\bdesarrollador|\bprogramador|\bingenier[oa] (de )?(software|datos|sistemas|backend|frontend|devops|cloud|qa|ia)\b/],
  ["software-engineer", /\bengineer\b|\bingenier[oa]\b/, NOT_SOFTWARE],
  ["sales", /\bsales\b|\baccount (executive|manager|director)\b|\bsdr\b|\bventas\b|\bcomercial\b/],
  ["management-consultant", /\bconsultant\b|\bconsultor/],
];
const CATCH_ALL = new Set(["software-engineer", "sales", "management-consultant"]);
// The roles a title can be classified as, whatever data.json holds.
export const CLASSIFIED = new Set(ROLE_TITLES.map(([slug]) => slug));
export const MAX_ROLES = 3;

// The roles a title reads as, best first, among `known` (a Set of role slugs);
// empty when none fits. A catch-all counts only when nothing narrower did.
export function titleRoles(title, known) {
  const t = words(title);
  const out = [];
  for (const [slug, pattern, unless] of ROLE_TITLES) {
    if (out.includes(slug) || !known.has(slug) || (out.length && CATCH_ALL.has(slug))) continue;
    if (pattern.test(t) && !unless?.test(t)) out.push(slug);
  }
  return out.slice(0, MAX_ROLES);
}

// --- Level and experience ----------------------------------------------------------

// The level a title names, first match wins: "Senior Director" is head,
// "Senior Associate" senior. A title naming none has none; find_jobs reads
// that as mid. Manager is left out: product, account and project managers
// are roles, not levels.
export const SENIORITIES = ["intern", "junior", "mid", "senior", "staff", "lead", "head"];
const LEVEL_TITLES = [
  ["intern", /\b(intern|interns|internship|becari[oa]s?|becas?|practicas|trainee|apprentice|apprenticeship|working student|werkstudent)\b/],
  ["head", /\b(head|director|directora|vp|svp|evp|vice president|chief|cto|cio|ciso|cfo|coo|ceo|cmo|cpo)\b/],
  ["staff", /\b(staff|principal|distinguished|fellow)\b/],
  ["lead", /\b(lead|tech lead|team lead|leader|lider)\b/, /\blead (generation|gen)\b/],
  ["senior", /\b(senior|sr|snr|iii)\b/],
  ["junior", /\b(junior|jr|graduate|grad|entry level|new grad)\b/],
  ["mid", /\b(mid|mid level|intermediate|ii)\b/],
];

export function seniorityOf(title) {
  const t = words(title);
  for (const [level, pattern, unless] of LEVEL_TITLES) if (pattern.test(t) && !unless?.test(t)) return level;
  return null;
}

const NUMBERS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
const N = `(\\d{1,2}|${Object.keys(NUMBERS).join("|")})`;
const RANGE = `\\s*(?:\\+|plus)?\\s*(?:(?:-|to|a)\\s*${N}\\s*)?\\+?\\s*`;
const FILLER = "(?:[a-z0-9+#/.,&()-]+\\s+){0,6}?";
// "5+ years of professional experience", "3-5 years' experience in", "al menos
// 3 años de experiencia", "experience of at least 4 years", "experiencia mínima
// de 2 años". An experience word must be near: "kept for 2 years" is not asked.
const YEARS = [
  new RegExp(`\\b${N}${RANGE}(?:years?|yrs?)\\s+(?:of\\s+)?${FILLER}(?:experience|expertise|track record|background|working)\\b`, "g"),
  new RegExp(`\\b${N}${RANGE}anos\\s+(?:de\\s+)?${FILLER}(?:experiencia|trabajando|desempenando)\\b`, "g"),
  // A "+", a range or "at least" says it is asked even with no experience word
  // ("5+ years in pricing", "3-5 years of commercial Python"); history never
  // carries one ("started 12 years ago", "15 years building").
  new RegExp(`\\b${N}\\s*\\+\\s*(?:years?|yrs?|anos)\\b`, "g"),
  new RegExp(`\\b${N}\\s*(?:-|to|a)\\s*${N}\\s*\\+?\\s*(?:years?|yrs?|anos)\\s+(?:of|in|de|en|as|como|working|leading|managing|building)\\b`, "g"),
  new RegExp(`\\b(?:at least|minimum(?: of)?|a minimum of|al menos|minimo(?: de)?)\\s+${N}\\s*(?:years?|yrs?|anos)\\b`, "g"),
  new RegExp(`\\bexperien(?:ce|cia)[\\s:,-]+(?:of\\s+|de\\s+)?(?:at least\\s+|minimum (?:of\\s+)?|a minimum of\\s+|minima (?:de\\s+)?|de al menos\\s+|al menos\\s+|mas de\\s+|over\\s+|more than\\s+)?${N}${RANGE}(?:years?|yrs?|anos)\\b`, "g"),
];
const count = (n) => n === undefined ? null : /^\d+$/.test(n) ? Number(n) : NUMBERS[n] ?? null;
// Above this a figure is the company's history ("over 20 years of
// experience in the market"), not what the posting asks.
const MAX_ASKED = 15;

// The years of experience a description asks for, as [min, max] (max null when
// open-ended), or null when it names none. Several figures: the highest
// minimum, the most the posting asks of anyone.
export function yearsAsked(text) {
  // norm() would turn "3-5 years" into "3 5 years": keep the hyphen here.
  const t = String(text ?? "").replace(/[‐-―−]/g, "-").replace(/[’']/g, " ")
    .normalize("NFKD").replace(/[^\x00-\x7f]/g, "").toLowerCase().replace(/\s+/g, " ");
  let best = null;
  for (const pattern of YEARS) {
    for (const m of t.matchAll(pattern)) {
      // "1.5+ years" is not 5, and "12 to 15+ years" is not 15.
      if (/(?:[\d.,]|\d\s*(?:-|to|a)\s*)$/.test(t.slice(Math.max(0, m.index - 8), m.index))) continue;
      const low = count(m[1]), high = count(m[2]);
      if (low === null || low > MAX_ASKED) continue;
      const max = high !== null && high > low && high <= 20 ? high : null;
      if (!best || low > best[0]) best = [low, max];
    }
  }
  return best;
}

// --- Way of working ------------------------------------------------------------------

export const REMOTE = /\b(remote|remoto|teletrabajo|anywhere)\b/;

// The posting's way of working; a null in the index is read from the location.
export function workplaceOf(job) {
  if (job.workplace) return job.workplace;
  const where = words(job.location);
  if (/\b(hybrid|hibrido)\b/.test(where)) return "hybrid";
  return REMOTE.test(where) ? "remote" : null;
}

// Everything above for one posting, as jobs.mjs stores it. The description is
// read and left behind.
export function classify(job, description, known) {
  return { roles: titleRoles(job.title, known), seniority: seniorityOf(job.title),
           years: yearsAsked(description), regions: regionsOf(job.location) };
}
