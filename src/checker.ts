// ATS-style resume checker: scores a parsed OpenResume `Resume` object and
// produces recommendations, some with automatic fixes.
import type { Resume } from "lib/redux/types";
import { findSkills } from "./skills";

export type Severity = "high" | "medium" | "low";
export interface Recommendation {
  id: string;
  category: string;
  severity: Severity;
  message: string;
  fixLabel?: string;
  fix?: (r: Resume) => Resume;
}
export interface CategoryScore { name: string; score: number; max: number; }
/** What the optimizer has already handled, so it never re-suggests the same change. */
export interface Memory {
  optimized: Set<string>; // normalized text of bullets/summary already produced or reviewed by a fix
  dismissed: Set<string>; // recommendation ids the user chose to ignore
}
export const emptyMemory = (): Memory => ({ optimized: new Set(), dismissed: new Set() });
export const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9%$+#]+/g, " ").trim();

/** Mark every bullet and the summary of `r` as already optimized. */
export function rememberOptimized(r: Resume, mem: Memory, what = { bullets: true, summary: true }) {
  if (what.bullets) allBullets(r).forEach((b) => mem.optimized.add(norm(b)));
  if (what.summary && r.profile.summary.trim()) mem.optimized.add(norm(r.profile.summary));
}

/** Recommendations that should not come back once their fix was applied. */
export const ONE_SHOT = new Set(["summary-missing", "summary-short", "skills-few"]);

/** Apply one recommendation's fix and record it in memory. */
export function applyFix(r: Resume, rec: Recommendation, mem: Memory): Resume {
  const out = rec.fix!(r);
  rememberOptimized(out, mem, { bullets: rec.category === "Bullets", summary: rec.category === "Summary" });
  if (ONE_SHOT.has(rec.id)) mem.dismissed.add(rec.id);
  return out;
}

export interface CheckResult {
  score: number;
  categories: CategoryScore[];
  recommendations: Recommendation[];
  keywords: string[];
}

const ACTION_VERBS = new Set(
  ("achieved accelerated administered advised analyzed architected automated built championed coached " +
   "collaborated configured consolidated coordinated created cut debugged decreased delivered deployed designed " +
   "developed directed drove eliminated enabled engineered established evaluated executed expanded facilitated " +
   "generated grew guided identified implemented improved increased initiated integrated introduced launched led " +
   "maintained managed mentored migrated modernized monitored negotiated optimized orchestrated organized oversaw " +
   "partnered pioneered planned produced programmed reduced redesigned refactored resolved restructured revamped " +
   "saved scaled secured shipped simplified spearheaded standardized streamlined strengthened supervised supported " +
   "communicated drafted edited hired instructed ordered promoted raised rebuilt reorganized scheduled " +
   "served structured translated volunteered assessed audited built calculated closed compiled composed contributed handled performed leveraged executed oversaw taught tested trained transformed tripled doubled troubleshot unified upgraded won wrote authored conducted " +
   "prepared presented processed provided published recruited researched reviewed sold solved").split(" ")
);

// weak phrase -> replacement verb (applied at bullet start or anywhere)
const WEAK_PHRASES: [RegExp, string][] = [
  [/^(was )?responsible for (managing|leading)\b/i, "Led"],
  [/^(was )?responsible for (developing|building|creating)\b/i, "Developed"],
  [/^(was )?responsible for\b/i, "Managed"],
  [/^duties included\b/i, "Handled"],
  [/^tasked with\b/i, "Executed"],
  [/^helped (to )?/i, "Supported "],
  [/^assisted (with|in)\b/i, "Supported"],
  [/^worked on\b/i, "Developed"],
  [/^worked with\b/i, "Collaborated with"],
  [/^involved in\b/i, "Contributed to"],
  [/^participated in\b/i, "Contributed to"],
  [/^in charge of\b/i, "Oversaw"],
  [/^handled\b/i, "Managed"],
  [/^did\b/i, "Performed"],
  [/^made\b/i, "Created"],
  [/^used\b/i, "Leveraged"],
];
const PRONOUNS = /\b(I|me|my|mine|we|our|us)\b/g;
const METRIC = /(\d+%|\$\s?\d|\d+\s?(k|m|b|x)\b|\b\d{2,}\b|\b\d+\+)/i;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const clone = (r: Resume): Resume => JSON.parse(JSON.stringify(r));

export function allBullets(r: Resume): string[] {
  return [
    ...r.workExperiences.flatMap((w) => w.descriptions),
    ...r.projects.flatMap((p) => p.descriptions),
  ].filter((b) => b && b.trim());
}

export function resumeText(r: Resume): string {
  const p = r.profile;
  return [
    p.name, p.email, p.phone, p.location, p.url, p.summary,
    ...r.workExperiences.flatMap((w) => [w.jobTitle, w.company, w.date, ...w.descriptions]),
    ...r.educations.flatMap((e) => [e.school, e.degree, e.date, e.gpa, ...e.descriptions]),
    ...r.projects.flatMap((p) => [p.project, p.date, ...p.descriptions]),
    ...r.skills.featuredSkills.map((s) => s.skill),
    ...r.skills.descriptions,
    ...r.custom.descriptions,
  ].filter(Boolean).join("\n");
}

export function listSkills(r: Resume): string[] {
  const out = new Set<string>();
  r.skills.featuredSkills.forEach((s) => s.skill.trim() && out.add(s.skill.trim()));
  r.skills.descriptions.forEach((d) =>
    d.replace(/^[^:]{1,30}:/, "").split(/[,;|•·]/).forEach((s) => {
      const t = s.trim().replace(/^(and|&)\s+/i, "").replace(/\.$/, "");
      if (t && t.length <= 40 && words(t).length <= 4) out.add(t);
    })
  );
  return [...out];
}

/** Skills from the dictionary that appear anywhere in the resume text. */
export function detectKeywords(r: Resume): string[] {
  return findSkills(resumeText(r), listSkills(r));
}

function fixBullet(b: string): string {
  let s = b.trim().replace(/^[-•*·▪]\s*/, "");
  for (const [re, rep] of WEAK_PHRASES) {
    if (re.test(s)) { s = s.replace(re, rep); break; }
  }
  s = s.replace(PRONOUNS, "").replace(/\s{2,}/g, " ").trim();
  if (s) s = s[0].toUpperCase() + s.slice(1);
  return s.replace(/\.$/, "");
}

function mapBullets(r: Resume, f: (b: string) => string, skip: Set<string>): Resume {
  const n = clone(r);
  const g = (b: string) => (skip.has(norm(b)) ? b : f(b));
  n.workExperiences.forEach((w) => (w.descriptions = w.descriptions.map(g)));
  n.projects.forEach((p) => (p.descriptions = p.descriptions.map(g)));
  return n;
}

function firstWord(b: string) {
  const w = (words(b.replace(/^[-•*·▪]\s*/, ""))[0] || "").toLowerCase().replace(/[^a-z]/g, "");
  // accept present tense too: "Plan" -> planned, "Manage" -> managed, "Builds" -> built
  for (const v of [w, w + "ed", w + "d", w + w.slice(-1) + "ed", w.replace(/s$/, "") + "ed", w.replace(/s$/, "") + "d", w.replace(/y$/, "ied")])
    if (ACTION_VERBS.has(v)) return v;
  return { build: "built", lead: "led", write: "wrote", run: "ran", teach: "taught", sell: "sold", win: "won" }[w.replace(/s$/, "")] || w;
}

export function generateSummary(r: Resume): string {
  const title = r.workExperiences.find((w) => w.jobTitle)?.jobTitle || "Professional";
  const years = estimateYears(r);
  // prefer recognized hard skills; fall back to whatever the skills section lists
  const known = findSkills(resumeText(r)).slice(0, 5);
  const top = (known.length >= 3 ? known : listSkills(r).filter((x) => words(x).length <= 3 && !/^(fluent|proficient|familiar|experienced|knowledge|basic|native)/i.test(x)).slice(0, 5)).join(", ");
  return `${title}${years ? ` with ${years}+ years of experience` : ""}` +
    `${top ? ` specializing in ${top}` : ""}. ` +
    `Proven track record of delivering measurable results, collaborating across teams, and driving continuous improvement.`;
}

export function estimateYears(r: Resume): number {
  const years = r.workExperiences
    .flatMap((w) => (w.date.match(/(19|20)\d{2}/g) || []).map(Number));
  const present = r.workExperiences.some((w) => /present|current|now/i.test(w.date));
  if (!years.length) return 0;
  const max = present ? new Date().getFullYear() : Math.max(...years);
  return Math.max(0, max - Math.min(...years));
}

export function checkResume(r: Resume, mem: Memory = emptyMemory()): CheckResult {
  const recs: Recommendation[] = [];
  const cats: CategoryScore[] = [];
  const p = r.profile;
  const add = (rec: Recommendation) => recs.push(rec);

  // 1. Contact info (15)
  let c = 0;
  if (p.name.trim()) c += 3; else add({ id: "name", category: "Contact", severity: "high", message: "No name detected at the top of the resume." });
  if (/\S+@\S+\.\S+/.test(p.email)) c += 4; else add({ id: "email", category: "Contact", severity: "high", message: "No email address found. ATS systems require a reachable email." });
  if (/\d{3}.*\d{4}/.test(p.phone)) c += 3; else add({ id: "phone", category: "Contact", severity: "medium", message: "No phone number found." });
  if (p.location.trim()) c += 3; else add({ id: "location", category: "Contact", severity: "medium", message: "Add a location (City, State). Many recruiters filter by location, and it seeds your job search." });
  if (p.url.trim()) c += 2; else add({ id: "url", category: "Contact", severity: "low", message: "Add a LinkedIn, GitHub, or portfolio URL." });
  cats.push({ name: "Contact", score: c, max: 15 });

  // 2. Summary (10)
  const sw = words(p.summary).length;
  let s = 0;
  const summaryDone = sw > 0 && mem.optimized.has(norm(p.summary));
  if (!sw) {
    add({ id: "summary-missing", category: "Summary", severity: "medium", message: "No professional summary. A 2–4 sentence summary helps ATS keyword matching.",
      fixLabel: "Generate summary", fix: (x) => { const n = clone(x); n.profile.summary = generateSummary(x); return n; } });
  } else if (sw < 20 && !summaryDone) {
    s = 6;
    add({ id: "summary-short", category: "Summary", severity: "low", message: `Summary is short (${sw} words). Aim for 30–80 words.`,
      fixLabel: "Expand summary", fix: (x) => { const n = clone(x); n.profile.summary = generateSummary(x); return n; } });
  } else if (sw > 100 && !summaryDone) {
    s = 6;
    add({ id: "summary-long", category: "Summary", severity: "low", message: `Summary is long (${sw} words). Trim to under 80 words.` });
  } else s = 10;
  if (sw && !summaryDone && PRONOUNS.test(p.summary)) {
    s = Math.max(0, s - 2);
    add({ id: "summary-pronouns", category: "Summary", severity: "low", message: "Summary uses first-person pronouns (I, my, we).",
      fixLabel: "Remove pronouns", fix: (x) => { const n = clone(x); n.profile.summary = n.profile.summary.replace(PRONOUNS, "").replace(/\s{2,}/g, " ").trim(); return n; } });
  }
  PRONOUNS.lastIndex = 0;
  cats.push({ name: "Summary", score: s, max: 10 });

  // 3. Experience structure (20)
  const jobs = r.workExperiences.filter((w) => w.company || w.jobTitle || w.descriptions.length);
  let e = 0;
  if (!jobs.length) {
    add({ id: "exp-missing", category: "Experience", severity: "high", message: "No work experience section detected. Use a clear heading like \"EXPERIENCE\"." });
  } else {
    e += 6;
    const complete = jobs.filter((w) => w.company && w.jobTitle && w.date).length;
    e += Math.round(7 * complete / jobs.length);
    if (complete < jobs.length) add({ id: "exp-incomplete", category: "Experience", severity: "medium", message: `${jobs.length - complete} role(s) are missing a job title, company, or date.` });
    const goodCount = jobs.filter((w) => w.descriptions.length >= 2 && w.descriptions.length <= 8).length;
    e += Math.round(7 * goodCount / jobs.length);
    const thin = jobs.filter((w) => w.descriptions.length < 2);
    if (thin.length) add({ id: "exp-thin", category: "Experience", severity: "medium", message: `${thin.length} role(s) have fewer than 2 bullet points. Aim for 3–6 achievement bullets per role.` });
  }
  cats.push({ name: "Experience", score: e, max: 20 });

  // 4. Bullet quality (25)
  const bullets = allBullets(r);
  let b = 0;
  if (bullets.length) {
    const action = bullets.filter((x) => ACTION_VERBS.has(firstWord(x))).length / bullets.length;
    const fresh = bullets.filter((x) => !mem.optimized.has(norm(x)));
    const freshNoVerb = fresh.filter((x) => !ACTION_VERBS.has(firstWord(x)));
    const weak = fresh.filter((x) => WEAK_PHRASES.some(([re]) => re.test(x.replace(/^[-•*·▪]\s*/, "").trim())));
    const pron = fresh.filter((x) => { PRONOUNS.lastIndex = 0; return PRONOUNS.test(x); });
    PRONOUNS.lastIndex = 0;
    const metric = bullets.filter((x) => METRIC.test(x)).length / bullets.length;
    const lenOk = bullets.filter((x) => { const n = words(x).length; return n >= 6 && n <= 35; }).length / bullets.length;
    b += Math.round(8 * action) + Math.round(8 * Math.min(1, metric / 0.5)) + Math.round(5 * lenOk);
    b += weak.length ? Math.max(0, 2 - weak.length) : 2;
    b += pron.length ? 0 : 2;
    if (action < 0.8 && freshNoVerb.length) add({ id: "bullets-verbs", category: "Bullets", severity: "medium",
      message: `Only ${Math.round(action * 100)}% of bullets start with a strong action verb (Led, Built, Increased…). ${freshNoVerb.length} new/unreviewed bullet(s) can be improved.`,
      fixLabel: "Rewrite weak openings", fix: (x) => mapBullets(x, fixBullet, mem.optimized) });
    if (weak.length) add({ id: "bullets-weak", category: "Bullets", severity: "medium",
      message: `${weak.length} bullet(s) use weak phrases like "responsible for", "helped", "worked on".`,
      fixLabel: "Replace weak phrases", fix: (x) => mapBullets(x, fixBullet, mem.optimized) });
    if (pron.length) add({ id: "bullets-pronouns", category: "Bullets", severity: "low",
      message: `${pron.length} bullet(s) contain first-person pronouns.`,
      fixLabel: "Remove pronouns", fix: (x) => mapBullets(x, fixBullet, mem.optimized) });
    if (metric < 0.5) add({ id: "bullets-metrics", category: "Bullets", severity: "high",
      message: `Only ${Math.round(metric * 100)}% of bullets include numbers. Quantify impact (%, $, time saved, users, team size). Bullets without metrics are highlighted in the editor.` });
    if (lenOk < 0.8) add({ id: "bullets-length", category: "Bullets", severity: "low",
      message: "Some bullets are too short (<6 words) or too long (>35 words). Keep each to 1–2 lines." });
  } else {
    add({ id: "bullets-none", category: "Bullets", severity: "high", message: "No bullet points detected under experience or projects." });
  }
  cats.push({ name: "Bullet quality", score: b, max: 25 });

  // 5. Education (10)
  const edu = r.educations.filter((x) => x.school || x.degree);
  let ed = 0;
  if (edu.length) {
    ed = 5 + (edu[0].degree ? 3 : 0) + (edu[0].date ? 2 : 0);
    if (!edu[0].degree || !edu[0].date) add({ id: "edu-incomplete", category: "Education", severity: "low", message: "Education entry is missing a degree or graduation date." });
  } else add({ id: "edu-missing", category: "Education", severity: "medium", message: "No education section detected." });
  cats.push({ name: "Education", score: ed, max: 10 });

  // 6. Skills & keywords (12)
  const skills = listSkills(r);
  const kws = detectKeywords(r);
  let k = Math.min(8, skills.length) + Math.min(4, Math.floor(kws.length / 3));
  if (skills.length < 8) {
    const skillsText = [...r.skills.descriptions, ...r.skills.featuredSkills.map((f) => f.skill)].join(" ").toLowerCase();
    const missing = kws.filter((x) => !skillsText.includes(x.toLowerCase()));
    add({ id: "skills-few", category: "Skills", severity: skills.length ? "medium" : "high",
      message: `Skills section lists ${skills.length} skill(s). List 8–20 relevant hard skills.` +
        (missing.length ? ` Found ${missing.length} skill(s) mentioned elsewhere that could be added.` : ""),
      ...(missing.length ? { fixLabel: `Add ${Math.min(missing.length, 15)} detected skills`, fix: (x: Resume) => {
        const n = clone(x);
        const toAdd = missing.slice(0, 15);
        n.skills.descriptions = [...n.skills.descriptions.filter(Boolean), toAdd.join(", ")];
        return n;
      } } : {}) });
  }
  cats.push({ name: "Skills", score: Math.min(12, k), max: 12 });

  // 7. Length / parseability (8)
  const total = words(resumeText(r)).length;
  let l = 8;
  if (total < 200) { l = 3; add({ id: "length-short", category: "Format", severity: "medium", message: `Resume is very short (${total} words). Most strong resumes have 400–800 words.` }); }
  else if (total > 1100) { l = 5; add({ id: "length-long", category: "Format", severity: "low", message: `Resume is long (${total} words). Keep it to 1–2 pages.` }); }
  cats.push({ name: "Format", score: l, max: 8 });

  const score = cats.reduce((a, x) => a + x.score, 0);
  recs.splice(0, recs.length, ...recs.filter((x) => !mem.dismissed.has(x.id)));
  const order = { high: 0, medium: 1, low: 2 };
  recs.sort((a, b) => order[a.severity] - order[b.severity]);
  return { score, categories: cats, recommendations: recs, keywords: kws };
}

/** Apply every available fix once; memory makes the next pass touch only new content. */
export function applyAllFixes(r: Resume, mem: Memory): Resume {
  let cur = r;
  const seen = new Set<string>();
  for (const f of checkResume(cur, mem).recommendations) {
    if (!f.fix || seen.has(f.fixLabel!)) continue;
    seen.add(f.fixLabel!);
    cur = applyFix(cur, f, mem);
  }
  rememberOptimized(cur, mem, { bullets: true, summary: false });
  return cur;
}

export const hasMetric = (b: string) => METRIC.test(b);
