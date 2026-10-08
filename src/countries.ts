// Countries JobSpy can search. `gd` = Glassdoor available. Indeed and LinkedIn cover all of them.
export interface Country { key: string; name: string; region: string; gd?: boolean; aliases?: string[] }

export const REGIONS = ["Europe", "North America", "Latin America", "Asia-Pacific", "Middle East", "Africa"] as const;

export const COUNTRIES: Country[] = [
  // Europe
  { key: "austria", name: "Austria", region: "Europe", gd: true },
  { key: "belgium", name: "Belgium", region: "Europe", gd: true },
  { key: "bulgaria", name: "Bulgaria", region: "Europe" },
  { key: "croatia", name: "Croatia", region: "Europe" },
  { key: "cyprus", name: "Cyprus", region: "Europe" },
  { key: "czech republic", name: "Czech Republic", region: "Europe", aliases: ["czechia"] },
  { key: "denmark", name: "Denmark", region: "Europe" },
  { key: "estonia", name: "Estonia", region: "Europe" },
  { key: "finland", name: "Finland", region: "Europe" },
  { key: "france", name: "France", region: "Europe", gd: true },
  { key: "germany", name: "Germany", region: "Europe", gd: true, aliases: ["deutschland"] },
  { key: "greece", name: "Greece", region: "Europe" },
  { key: "hungary", name: "Hungary", region: "Europe" },
  { key: "ireland", name: "Ireland", region: "Europe", gd: true },
  { key: "italy", name: "Italy", region: "Europe", gd: true, aliases: ["italia"] },
  { key: "latvia", name: "Latvia", region: "Europe" },
  { key: "lithuania", name: "Lithuania", region: "Europe" },
  { key: "luxembourg", name: "Luxembourg", region: "Europe" },
  { key: "malta", name: "Malta", region: "Europe" },
  { key: "netherlands", name: "Netherlands", region: "Europe", gd: true, aliases: ["the netherlands", "holland"] },
  { key: "norway", name: "Norway", region: "Europe" },
  { key: "poland", name: "Poland", region: "Europe", aliases: ["polska"] },
  { key: "portugal", name: "Portugal", region: "Europe" },
  { key: "romania", name: "Romania", region: "Europe", aliases: ["românia"] },
  { key: "slovakia", name: "Slovakia", region: "Europe" },
  { key: "slovenia", name: "Slovenia", region: "Europe" },
  { key: "spain", name: "Spain", region: "Europe", gd: true, aliases: ["españa"] },
  { key: "sweden", name: "Sweden", region: "Europe" },
  { key: "switzerland", name: "Switzerland", region: "Europe", gd: true },
  { key: "turkey", name: "Turkey", region: "Europe", aliases: ["türkiye"] },
  { key: "ukraine", name: "Ukraine", region: "Europe" },
  { key: "uk", name: "United Kingdom", region: "Europe", gd: true, aliases: ["uk", "england", "scotland", "wales", "great britain"] },
  // North America
  { key: "usa", name: "United States", region: "North America", gd: true, aliases: ["usa", "us", "united states of america"] },
  { key: "canada", name: "Canada", region: "North America", gd: true },
  { key: "mexico", name: "Mexico", region: "North America", gd: true, aliases: ["méxico"] },
  // Latin America
  { key: "argentina", name: "Argentina", region: "Latin America", gd: true },
  { key: "brazil", name: "Brazil", region: "Latin America", gd: true, aliases: ["brasil"] },
  { key: "chile", name: "Chile", region: "Latin America" },
  { key: "colombia", name: "Colombia", region: "Latin America" },
  { key: "costa rica", name: "Costa Rica", region: "Latin America" },
  { key: "ecuador", name: "Ecuador", region: "Latin America" },
  { key: "panama", name: "Panama", region: "Latin America" },
  { key: "peru", name: "Peru", region: "Latin America" },
  { key: "uruguay", name: "Uruguay", region: "Latin America" },
  { key: "venezuela", name: "Venezuela", region: "Latin America" },
  // Asia-Pacific
  { key: "australia", name: "Australia", region: "Asia-Pacific", gd: true },
  { key: "bangladesh", name: "Bangladesh", region: "Asia-Pacific" },
  { key: "china", name: "China", region: "Asia-Pacific" },
  { key: "hong kong", name: "Hong Kong", region: "Asia-Pacific", gd: true },
  { key: "india", name: "India", region: "Asia-Pacific", gd: true },
  { key: "indonesia", name: "Indonesia", region: "Asia-Pacific" },
  { key: "japan", name: "Japan", region: "Asia-Pacific" },
  { key: "malaysia", name: "Malaysia", region: "Asia-Pacific", gd: true },
  { key: "new zealand", name: "New Zealand", region: "Asia-Pacific", gd: true },
  { key: "pakistan", name: "Pakistan", region: "Asia-Pacific" },
  { key: "philippines", name: "Philippines", region: "Asia-Pacific" },
  { key: "singapore", name: "Singapore", region: "Asia-Pacific", gd: true },
  { key: "south korea", name: "South Korea", region: "Asia-Pacific", aliases: ["korea"] },
  { key: "taiwan", name: "Taiwan", region: "Asia-Pacific" },
  { key: "thailand", name: "Thailand", region: "Asia-Pacific" },
  { key: "vietnam", name: "Vietnam", region: "Asia-Pacific", gd: true, aliases: ["viet nam"] },
  // Middle East
  { key: "bahrain", name: "Bahrain", region: "Middle East" },
  { key: "israel", name: "Israel", region: "Middle East" },
  { key: "kuwait", name: "Kuwait", region: "Middle East" },
  { key: "oman", name: "Oman", region: "Middle East" },
  { key: "qatar", name: "Qatar", region: "Middle East" },
  { key: "saudi arabia", name: "Saudi Arabia", region: "Middle East", aliases: ["ksa"] },
  { key: "united arab emirates", name: "United Arab Emirates", region: "Middle East", aliases: ["uae", "dubai", "abu dhabi"] },
  // Africa
  { key: "egypt", name: "Egypt", region: "Africa" },
  { key: "morocco", name: "Morocco", region: "Africa" },
  { key: "nigeria", name: "Nigeria", region: "Africa" },
  { key: "south africa", name: "South Africa", region: "Africa" },
];

export const WORLDWIDE: Country = { key: "worldwide", name: "Worldwide (remote)", region: "Global" };
export const byKey = (k: string) => (k === WORLDWIDE.key ? WORLDWIDE : COUNTRIES.find((c) => c.key === k));

/** Quick-pick groups shown as buttons. */
export const PRESETS: Record<string, string[]> = {
  "Western Europe": ["uk", "ireland", "germany", "netherlands", "france", "belgium", "switzerland", "austria"],
  "Nordics": ["sweden", "denmark", "norway", "finland"],
  "Southern Europe": ["spain", "portugal", "italy", "greece"],
  "Central & Eastern Europe": ["poland", "romania", "czech republic", "hungary", "bulgaria", "slovakia"],
  "North America": ["usa", "canada"],
  "Asia-Pacific": ["australia", "singapore", "india", "japan", "new zealand"],
  "Middle East": ["united arab emirates", "saudi arabia", "qatar", "israel"],
  "Latin America": ["brazil", "mexico", "argentina", "colombia", "chile"],
};

const US_STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC".split(" "));
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Split a resume location like "Brașov, Romania" or "Austin, TX" into city + country key. */
export function detectCountry(location: string): { city: string; country: string | null } {
  const loc = location.trim();
  if (!loc) return { city: "", country: null };
  const parts = loc.split(",").map((p) => p.trim()).filter(Boolean);
  const last = fold(parts[parts.length - 1] || "");
  if (parts.length >= 2 && US_STATES.has(parts[parts.length - 1].toUpperCase()) && parts[parts.length - 1].length === 2)
    return { city: parts[0], country: "usa" };
  for (const c of COUNTRIES) {
    const names = [c.name, c.key, ...(c.aliases || [])].map(fold);
    if (names.includes(last) || names.some((n) => n.length > 3 && fold(loc).includes(n))) {
      const city = parts.length >= 2 ? parts[0] : "";
      return { city: names.includes(fold(city)) ? "" : city, country: c.key };
    }
  }
  return { city: parts[0] || "", country: null };
}
