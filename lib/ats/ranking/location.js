import { normalizeForMatch } from "../text/html.js";
/**
 * Location classification.
 *
 * City names are not globally unique: Richmond, Vancouver, Newark, London and
 * Waterloo all exist in more than one country. Ambiguous names therefore only
 * match when the string also carries a state, province or country signal.
 */
const BAY_AREA_REGIONS = [
    "bay area",
    "sf bay",
    "san francisco bay",
    "silicon valley",
    "south bay",
    "east bay",
    "north bay",
    "peninsula ca",
];
const BAY_AREA_UNAMBIGUOUS = [
    "san francisco",
    "sf",
    "palo alto",
    "mountain view",
    "sunnyvale",
    "santa clara",
    "san jose",
    "menlo park",
    "redwood city",
    "cupertino",
    "foster city",
    "burlingame",
    "south san francisco",
    "emeryville",
    "milpitas",
    "los gatos",
    "san mateo",
    "san carlos",
    "los altos",
    "atherton",
    "portola valley",
    "sausalito",
    "mill valley",
    "half moon bay",
    "morgan hill",
    "gilroy",
    "san leandro",
    "castro valley",
    "orinda",
    "moraga",
    "san ramon",
    "pleasanton",
    "livermore",
    "walnut creek",
    "daly city",
    "san bruno",
    "millbrae",
    "san rafael",
    "novato",
    "petaluma",
    "rohnert park",
    "benicia",
    "vallejo",
    "alameda",
    "tiburon",
    "corte madera",
    "larkspur",
    "san anselmo",
    "sunnyvale ca",
];
/** Bay Area cities that share a name with places elsewhere. */
const BAY_AREA_AMBIGUOUS = [
    "oakland",
    "berkeley",
    "fremont",
    "newark",
    "richmond",
    "hayward",
    "concord",
    "fairfield",
    "antioch",
    "pittsburg",
    "martinez",
    "lafayette",
    "danville",
    "dublin",
    "brisbane",
    "union city",
    "belmont",
    "hillsborough",
    "saratoga",
    "campbell",
    "santa rosa",
    "pleasant hill",
    "sonoma",
    "napa",
    "brentwood",
    "clayton",
    "hercules",
    "windsor",
    "cotati",
];
const CALIFORNIA_SIGNALS = ["california", "\\bca\\b", "\\bcalif\\b", "bay area", "silicon valley"];
const CANADA_UNAMBIGUOUS = [
    "toronto",
    "montreal",
    "montréal",
    "ottawa",
    "calgary",
    "edmonton",
    "winnipeg",
    "saskatoon",
    "regina",
    "halifax",
    "mississauga",
    "brampton",
    "markham",
    "oakville",
    "kitchener",
    "burnaby",
    "coquitlam",
    "laval",
    "gatineau",
    "sherbrooke",
    "kelowna",
    "guelph",
    "oshawa",
    "vaughan",
    "richmond hill",
    "etobicoke",
    "north york",
    "quebec city",
    "moncton",
    "fredericton",
    "charlottetown",
    "st john's",
    "st. john's",
    "thunder bay",
    "sudbury",
    "barrie",
    "brossard",
    "longueuil",
    "saanich",
    "nanaimo",
    "kamloops",
    "abbotsford",
    "port coquitlam",
    "new westminster",
    "chilliwack",
    "red deer",
    "lethbridge",
    "medicine hat",
    "sarnia",
    "brantford",
    "trois-rivieres",
    "trois-rivières",
    "yellowknife",
    "whitehorse",
    "iqaluit",
];
const CANADA_AMBIGUOUS = [
    "vancouver",
    "victoria",
    "richmond",
    "london",
    "windsor",
    "waterloo",
    "surrey",
    "hamilton",
    "kingston",
    "cambridge",
    "milton",
    "delta",
    "langley",
    "whitby",
    "ajax",
    "scarborough",
    "dartmouth",
    "peterborough",
    "niagara falls",
    "chatham",
    "stratford",
    "woodstock",
    "burlington",
];
// NL can mean the Netherlands; use Canadian city/province names or other context.
// ON is Ontario only when "site" does not follow: Cabify's "On-Site - Madrid"
// was classed as Canada and rejected.
const CANADA_SIGNALS = [
    "canada",
    "canadian",
    "ontario",
    "quebec",
    "québec",
    "british columbia",
    "alberta",
    "manitoba",
    "saskatchewan",
    "nova scotia",
    "new brunswick",
    "newfoundland",
    "labrador",
    "prince edward island",
    "yukon",
    "nunavut",
    "northwest territories",
    "\\bon\\b(?![\\s-]*site)",
    "\\bqc\\b",
    "\\bbc\\b",
    "\\bab\\b",
    "\\bmb\\b",
    "\\bsk\\b",
    "\\bns\\b",
    "\\bnb\\b",
    "\\bpe\\b",
    "\\byt\\b",
    "\\bnu\\b",
    "\\bnt\\b",
];
const US_STATE_NAMES = [
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
    "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
    "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
    "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico",
    "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
    "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
    "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia",
];
/**
 * Exclude codes that collide with common words or foreign country codes.
 * DE is also German country shorthand and a word in many foreign city names;
 * explicit Delaware/US wording still identifies US postings.
 */
const US_STATE_ABBREVIATIONS = [
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DC", "FL", "GA", "IA", "ID", "IL", "KS", "KY",
    "LA", "MA", "MD", "MI", "MN", "MO", "MS", "MT", "NC", "ND", "NE", "NH", "NJ", "NM", "NV", "NY",
    "OH", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VA", "VT", "WA", "WI", "WV", "WY",
];
const US_SIGNALS = [
    "united states",
    "\\busa\\b",
    "\\bu\\.s\\.",
    "\\bus\\b",
    "seattle",
    "austin",
    "boston",
    "chicago",
    "denver",
    "atlanta",
    "los angeles",
    "san diego",
    "portland",
    "new york city",
    "nyc",
    ...US_STATE_NAMES,
    ...US_STATE_ABBREVIATIONS.map((code) => `\\b${code.toLowerCase()}\\b`),
];
// Lever writes Spain as ESP. "ES" alone is left out: it is a Spanish word.
const SPAIN_SIGNALS = ["spain", "espana", "\\besp\\b"];
/**
 * Checked before the US signals, which carry LA for Louisiana: "La Coruña"
 * would otherwise be a US posting.
 */
const SPAIN_UNAMBIGUOUS = [
    "madrid", "barcelona", "sevilla", "seville", "malaga", "bilbao", "zaragoza", "alicante", "palma de mallorca",
    "las palmas", "murcia", "vigo", "a coruna", "la coruna", "valladolid", "san sebastian", "donostia", "pamplona",
    "gijon", "oviedo", "tarragona", "girona", "sant cugat", "alcobendas", "pozuelo", "getafe", "leganes",
    "castellon", "santiago de compostela",
];
/** Also cities in the Americas (Valencia, Venezuela; Córdoba, Argentina; Toledo, Ohio): only with a Spain signal. */
const SPAIN_AMBIGUOUS = ["valencia", "cordoba", "granada", "santander", "salamanca", "toledo", "leon", "santiago"];
/** Scopes that span the region; only these make a remote posting remote-europe. */
const EUROPE_REGION_SIGNALS = ["europe", "european union", "emea", "\\beu\\b"];
/**
 * One country or city, with the country it is in. "Remote - Germany" asks the
 * candidate to live in Germany, which is another European country for this
 * purpose, not Europe-wide.
 */
const EUROPE_PLACES = [
    ["\\buk\\b", "GB"], ["united kingdom", "GB"], ["germany", "DE"], ["france", "FR"], ["portugal", "PT"],
    ["italy", "IT"], ["netherlands", "NL"], ["ireland", "IE"], ["belgium", "BE"], ["switzerland", "CH"],
    ["austria", "AT"], ["poland", "PL"], ["sweden", "SE"], ["denmark", "DK"], ["norway", "NO"], ["finland", "FI"],
    ["czechia", "CZ"], ["czech republic", "CZ"], ["romania", "RO"], ["greece", "GR"], ["hungary", "HU"],
    ["luxembourg", "LU"], ["estonia", "EE"], ["lithuania", "LT"], ["latvia", "LV"], ["croatia", "HR"],
    ["bulgaria", "BG"], ["slovakia", "SK"], ["slovenia", "SI"], ["london", "GB"], ["paris", "FR"], ["berlin", "DE"],
    ["munich", "DE"], ["hamburg", "DE"], ["frankfurt", "DE"], ["cologne", "DE"], ["lisbon", "PT"], ["porto", "PT"],
    ["amsterdam", "NL"], ["rotterdam", "NL"], ["dublin", "IE"], ["milan", "IT"], ["rome", "IT"], ["warsaw", "PL"],
    ["krakow", "PL"], ["prague", "CZ"], ["vienna", "AT"], ["zurich", "CH"], ["geneva", "CH"], ["stockholm", "SE"],
    ["copenhagen", "DK"], ["oslo", "NO"], ["helsinki", "FI"], ["brussels", "BE"], ["bucharest", "RO"],
    ["athens", "GR"], ["budapest", "HU"],
];
const EUROPE_PLACE_NEEDLES = EUROPE_PLACES.map(([needle]) => needle);
/** Keyed as matchesAny reports a hit: the needle without its word boundaries. */
const EUROPE_COUNTRY = new Map(EUROPE_PLACES.map(([needle, country]) => [needle.replace(/\\b/g, ""), country]));
const REMOTE_SIGNALS = ["remote", "work from home", "work at home", "wfh", "distributed", "anywhere", "virtual"];
const HYBRID_SIGNALS = ["hybrid", "flexible onsite", "in-office days"];
const ONSITE_SIGNALS = ["on-site", "onsite", "in office", "in-office"];
function matchesAny(haystack, needles) {
    for (const needle of needles) {
        const pattern = needle.includes("\\b") ? new RegExp(needle, "i") : new RegExp(`(^|[^a-z0-9])${escapeRegex(needle)}([^a-z0-9]|$)`, "i");
        if (pattern.test(haystack))
            return needle.replace(/\\b/g, "");
    }
    return null;
}
function escapeRegex(input) {
    return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function detectWorkplace(text, hints) {
    if (hints.workplaceType && hints.workplaceType !== "unknown")
        return hints.workplaceType;
    if (matchesAny(text, HYBRID_SIGNALS))
        return "hybrid";
    if (hints.isRemote === true)
        return "remote";
    if (matchesAny(text, REMOTE_SIGNALS))
        return "remote";
    if (matchesAny(text, ONSITE_SIGNALS))
        return "onsite";
    return "unknown";
}
function classifyOne(raw, hints) {
    const text = normalizeForMatch(raw);
    const workplaceType = detectWorkplace(text, hints);
    const isRemote = workplaceType === "remote";
    const hasCanadaSignal = matchesAny(text, CANADA_SIGNALS);
    const hasCaliforniaSignal = matchesAny(text, CALIFORNIA_SIGNALS);
    // Office "FL 7" means floor, not Florida; five-digit ZIP codes remain intact.
    const hasUsSignal = matchesAny(text.replace(/\bfl\.?\s*\d{1,3}\b/g, ""), US_SIGNALS);
    const bayHit = matchesAny(text, BAY_AREA_REGIONS) ??
        matchesAny(text, BAY_AREA_UNAMBIGUOUS) ??
        (hasCaliforniaSignal && !hasCanadaSignal ? matchesAny(text, BAY_AREA_AMBIGUOUS) : null);
    // Only a named place counts as a physical location; a bare country or
    // province signal alongside "remote" is a remote scope, not an office.
    const canadaCityHit = matchesAny(text, CANADA_UNAMBIGUOUS) ?? (hasCanadaSignal ? matchesAny(text, CANADA_AMBIGUOUS) : null);
    const hasSpainSignal = matchesAny(text, SPAIN_SIGNALS);
    const spainCityHit = matchesAny(text, SPAIN_UNAMBIGUOUS) ?? (hasSpainSignal ? matchesAny(text, SPAIN_AMBIGUOUS) : null);
    const europeRegionHit = matchesAny(text, EUROPE_REGION_SIGNALS);
    const europePlaceHit = matchesAny(text, EUROPE_PLACE_NEEDLES);
    const europeCountry = europePlaceHit ? (EUROPE_COUNTRY.get(europePlaceHit) ?? "unknown") : "unknown";
    if (isRemote && !canadaCityHit && !bayHit && !spainCityHit) {
        if (hasCanadaSignal)
            return { locationClass: "remote-canada", country: "CA", workplaceType, matched: hasCanadaSignal };
        if (hasUsSignal)
            return { locationClass: "remote-us", country: "US", workplaceType, matched: hasUsSignal };
        if (hasSpainSignal)
            return { locationClass: "remote-spain", country: "ES", workplaceType, matched: hasSpainSignal };
        if (europePlaceHit)
            return { locationClass: "europe", country: europeCountry, workplaceType, matched: europePlaceHit };
        if (europeRegionHit)
            return { locationClass: "remote-europe", country: "unknown", workplaceType, matched: europeRegionHit };
        return { locationClass: "remote-global", country: "unknown", workplaceType, matched: "remote" };
    }
    // A Canadian signal wins over an ambiguous Bay Area name (Richmond, Windsor).
    const canadaHit = canadaCityHit ?? (hasCanadaSignal && !bayHit ? hasCanadaSignal : null);
    if (canadaHit && (!bayHit || hasCanadaSignal)) {
        return { locationClass: "canada", country: "CA", workplaceType, matched: canadaHit };
    }
    if (bayHit) {
        return { locationClass: "bay-area", country: "US", workplaceType, matched: bayHit };
    }
    if (spainCityHit)
        return { locationClass: "spain", country: "ES", workplaceType, matched: spainCityHit };
    if (hasUsSignal)
        return { locationClass: "us-other", country: "US", workplaceType, matched: hasUsSignal };
    if (hasSpainSignal)
        return { locationClass: "spain", country: "ES", workplaceType, matched: hasSpainSignal };
    if (europePlaceHit)
        return { locationClass: "europe", country: europeCountry, workplaceType, matched: europePlaceHit };
    if (europeRegionHit)
        return { locationClass: "europe", country: "unknown", workplaceType, matched: europeRegionHit };
    if (text.length === 0)
        return { locationClass: "unknown", country: "unknown", workplaceType, matched: "" };
    return { locationClass: "other", country: "unknown", workplaceType, matched: text.slice(0, 40) };
}
const CLASS_PRIORITY = {
    "bay-area": 100,
    canada: 90,
    "remote-canada": 80,
    spain: 70,
    "remote-spain": 65,
    "remote-us": 60,
    "us-other": 50,
    "remote-europe": 45,
    "remote-global": 40,
    europe: 30,
    other: 20,
    unknown: 10,
};
/**
 * Classifies a posting that may list several offices, keeping the strongest
 * match so a "Toronto / New York / Remote" listing is not discarded.
 */
export function analyzeLocation(rawLocations, hints = {}) {
    const candidates = offices(rawLocations);
    if (candidates.length === 0) {
        const workplaceType = hints.workplaceType ?? (hints.isRemote ? "remote" : "unknown");
        return { locationClass: "unknown", country: "unknown", workplaceType, matched: "" };
    }
    const analyses = candidates.map((value) => classifyOne(value, hints));
    const best = analyses.reduce((best, current) => CLASS_PRIORITY[current.locationClass] > CLASS_PRIORITY[best.locationClass] ? current : best);
    return withPublishedCountry(best, hints.country);
}
/**
 * Workday publishes each posting's country beside location text that often
 * names none: Evolent's "Work at Home", SECU's "Operations - Raleigh -
 * Creedmoor" and Allied Solutions' "Carmel, IN" (IN is not a state code here
 * because it is India's) all read as outside North America. The published
 * country decides only those cases; a place the text names always wins.
 */
function withPublishedCountry(analysis, country) {
    if (country !== "US" && country !== "CA")
        return analysis;
    if (!["other", "remote-global", "unknown"].includes(analysis.locationClass))
        return analysis;
    const remote = analysis.locationClass === "remote-global" || analysis.workplaceType === "remote";
    const locationClass = country === "US" ? (remote ? "remote-us" : "us-other") : remote ? "remote-canada" : "canada";
    return { ...analysis, locationClass, country, matched: `published country ${country}` };
}
const SCOPE_SEPARATOR = "[\\s\\-\\u2013\\u2014:,/()\\[\\]]*";
const US_SCOPE_TOKEN = "(?:u\\.?s\\.?a?\\.?|united states)(?![a-z])";
const CANADA_SCOPE_TOKEN = "canada(?![a-z])";
function remoteScopePattern(countryToken) {
    return new RegExp(`(?<![a-z])remote${SCOPE_SEPARATOR}${countryToken}|(?<![a-z])${countryToken}${SCOPE_SEPARATOR}remote(?![a-z])`, "i");
}
const TITLE_REMOTE_US = remoteScopePattern(US_SCOPE_TOKEN);
const TITLE_REMOTE_CANADA = remoteScopePattern(CANADA_SCOPE_TOKEN);
/**
 * A bare "Remote" location reads as worldwide, but some boards carry the
 * country scope in the title instead ("Senior Back End Engineer [Remote-US]").
 * Only a country attached to a remote marker counts; "US Payments" is a team.
 */
export function refineRemoteScopeFromTitle(analysis, title) {
    if (analysis.locationClass !== "remote-global")
        return analysis;
    const text = title.toLowerCase();
    if (TITLE_REMOTE_US.test(text))
        return { ...analysis, locationClass: "remote-us", country: "US", matched: "title remote-us" };
    if (TITLE_REMOTE_CANADA.test(text)) {
        return { ...analysis, locationClass: "remote-canada", country: "CA", matched: "title remote-canada" };
    }
    return analysis;
}
/**
 * One entry per office. Boards also list several in one string, "San
 * Francisco, CA; Madrid, Spain", which read whole was only ever San Francisco.
 */
function offices(rawLocations) {
    return rawLocations
        .flatMap((value) => (typeof value === "string" ? value.split(/\s*[;|]\s*/) : []))
        .filter((value) => value.trim().length > 0);
}
export function allLocationClasses(rawLocations, hints = {}) {
    return [...new Set(offices(rawLocations).map((value) => classifyOne(value, hints).locationClass))];
}
/**
 * Every class a posting answers to: the one it is stored under, the strongest
 * office ranked for North America, and each office it lists, since it is open
 * in all of them. The gates and the queue filters both ask this, so a posting
 * a campaign in Spain admits is also one a filter for Spain finds.
 */
export function jobLocationClasses(job) {
    return [...new Set([job.locationClass, ...allLocationClasses(job.locationsRaw, { workplaceType: job.workplaceType })])];
}
