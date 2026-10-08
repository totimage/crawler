// Step 3: job search page — query from the resume, countries, live filters, search report, skill insights.
import type { Resume } from "lib/redux/types";
import { checkResume, detectKeywords, listSkills, allBullets } from "./checker";
import { findSkills, hasSkill, SKILL_DICTIONARY, SOFT_SKILLS } from "./skills";
import { COUNTRIES, REGIONS, PRESETS, WORLDWIDE, byKey, detectCountry } from "./countries";

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const scoreColor = (s: number) => (s >= 70 ? "var(--good)" : s >= 45 ? "var(--warn)" : "var(--bad)");

// ---------- state ----------
let resume: Resume | null = null;
let jobs: any[] = [];
let ranked: { kw: string; weight: number }[] = [];
let active: string[] = [];           // keywords used for matching
let countries: string[] = [];
let searchedDays: number | null = null;
let lastData: any = null;
let kwTouched = false;                // user edited the keyword list -> don't auto-replace it
const MAX_COUNTRIES = 10;
const DEFAULT_KEYWORDS = 10;

// ---------- keyword ranking: what actually matters in this resume ----------
const fold = (s: string) => s.toLowerCase();
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function countMentions(text: string, kw: string) {
  return (text.match(new RegExp(`(^|[^a-z0-9+#])${escRe(fold(kw))}(?=[^a-z0-9+#]|$)`, "g")) || []).length;
}

/** Rank resume keywords: mentioned in experience > listed in skills; hard skills > soft; short > long phrases. */
export function rankKeywords(r: Resume) {
  const body = fold([r.profile.summary, ...r.workExperiences.map((w) => w.jobTitle), ...allBullets(r)].join("\n"));
  const skills = new Set(listSkills(r).map(fold));
  const known = new Set(SKILL_DICTIONARY.map(fold));
  return detectKeywords(r)
    .map((kw) => {
      const k = fold(kw);
      const words = kw.trim().split(/\s+/).length;
      const mentions = Math.min(5, countMentions(body, kw));
      const weight = mentions * 2 + (skills.has(k) ? 1 : 0) + (known.has(k) ? 2 : 0)
        - (SOFT_SKILLS.has(k) ? 4 : 0) - (DOMAINS.has(k) ? 5 : 0) - (words > 3 ? 3 : 0) - (kw.length > 30 ? 3 : 0);
      return { kw, weight };
    })
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.kw.length - b.kw.length);
}

// Industries / product types: useful context, but not skills to rank jobs by.
const DOMAINS = new Set(["saas", "b2b", "b2c", "fintech", "healthcare", "e-commerce", "dashboards", "marketing", "sales"]);

/** After a search: the resume skills employers here ask for most (by % of postings), weighted by resume emphasis. */
function demandRanked(): string[] {
  const demand = keywordDemand();
  return ranked
    .map((r) => ({ kw: r.kw, d: demand.get(fold(r.kw)) || 0, w: r.weight }))
    .filter((x) => x.d >= 3 && !DOMAINS.has(fold(x.kw)))
    .sort((a, b) => b.d * (1 + b.w / 20) - a.d * (1 + a.w / 20))
    .slice(0, DEFAULT_KEYWORDS)
    .map((x) => x.kw);
}

// ---------- title relevance ----------
const TITLE_STOP = new Set(["senior", "sr", "junior", "jr", "lead", "principal", "staff", "head", "of", "and", "the", "for",
  "to", "in", "a", "i", "ii", "iii", "iv", "m", "f", "d", "w", "x", "all", "genders", "remote", "hybrid", "mid", "midlevel", "level"]);
function titleTokens(s: string) {
  return s.toLowerCase().replace(/user experience/g, "ux").replace(/user interface/g, "ui")
    .split(/[^a-z0-9+#]+/).filter((t) => t.length > 1 && !TITLE_STOP.has(t));
}
/** 0..1: the role noun (designer, engineer, …) must match; modifiers (ui, ux, product…) add the rest. */
function titleScore(query: string, title: string) {
  const q = titleTokens(query);
  if (!q.length) return 0;
  const t = new Set(titleTokens(title));
  const core = q[q.length - 1];
  const mods = q.slice(0, -1);
  const modHit = mods.length ? mods.filter((m) => t.has(m)).length / mods.length : 1;
  return t.has(core) ? 0.55 + 0.45 * modHit : 0.2 * modHit;
}

/** Distinct role titles from the resume, newest first: "Sr. UI/UX Designer, Product Design Consultant" -> 2 titles. */
function resumeTitles(r: Resume) {
  const out: string[] = [];
  for (const w of r.workExperiences)
    for (const part of (w.jobTitle || "").split(/[,|;]| - /)) {
      const t = part.replace(/^(sr\.?|senior|jr\.?|junior|lead|principal|staff)\s+/i, "").trim();
      if (t && t.split(/\s+/).length <= 4 && /[a-z]{3}/i.test(t) && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
    }
  return out.slice(0, 6);
}

// ---------- dates ----------
const DAY = 86_400_000;
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
function postedMs(j: any): number | null {
  if (!j.date_posted) return null;
  const [y, m, d] = String(j.date_posted).slice(0, 10).split("-").map(Number);
  return y ? new Date(y, m - 1, d).getTime() : null;
}
function ageText(j: any) {
  const t = postedMs(j);
  if (t == null) return `<span class="age unknown" title="No post date found on the job board or the job page">date unknown</span>`;
  const days = Math.max(0, Math.round((today() - t) / DAY));
  const txt = days === 0 ? "today" : days === 1 ? "yesterday" : days < 60 ? `${days} days ago` : `${Math.round(days / 30)} months ago`;
  const src = j.date_source === "page" ? " · from job page" : j.date_source === "page-modified" ? " · page last modified" : "";
  return `<span class="age${days <= 3 ? " fresh" : days > 30 ? " old" : ""}" title="${esc(j.date_posted)}${src}">${txt}${src ? `<em>${src}</em>` : ""}</span>`;
}
function ageDays(): number | null {
  const v = $<HTMLSelectElement>("#age").value;
  return v && v !== "custom" ? +v : null;
}
function inAgeRange(j: any) {
  const mode = $<HTMLSelectElement>("#age").value;
  if (!mode) return true;
  const t = postedMs(j);
  if (t == null) return $<HTMLInputElement>("#age-unknown").checked;
  if (mode === "custom") {
    const from = $<HTMLInputElement>("#age-from").valueAsDate, to = $<HTMLInputElement>("#age-to").valueAsDate;
    const day = (d: Date) => new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()).getTime();
    return (!from || t >= day(from)) && (!to || t <= day(to));
  }
  return today() - t <= +mode * DAY;
}

// ---------- scoring ----------
function scoreJobs() {
  const q = $<HTMLInputElement>("#q").value;
  const weights = new Map(ranked.map((r) => [fold(r.kw), Math.max(1, r.weight)]));
  const total = active.reduce((a, k) => a + (weights.get(fold(k)) || 1), 0) || 1;
  for (const j of jobs) {
    const text = `${j.title || ""}\n${j.description || ""}`;
    j._skills = j._skills || findSkills(text, ranked.map((r) => r.kw));          // every recognized skill in the posting
    j._matched = active.filter((k) => hasSkill(text, k));
    const kw = j._matched.reduce((a: number, k: string) => a + (weights.get(fold(k)) || 1), 0) / total;
    j._title = titleScore(q, j.title || "");
    j._hasDesc = !!(j.description && j.description.length > 200);
    j._match = Math.round(100 * (j._hasDesc ? 0.5 * j._title + 0.5 * Math.min(1, kw * 1.6) : 0.6 * j._title));
  }
}

// ---------- rendering ----------
function renderCountries() {
  $("#countries").innerHTML = countries.map((k, i) => `<span class="chip country">${esc(byKey(k)?.name || k)}<button type="button" data-rmc="${i}" aria-label="Remove ${esc(byKey(k)?.name || k)}">×</button></span>`).join("") ||
    `<span class="muted small-t">Add at least one country</span>`;
  $("#countries").querySelectorAll<HTMLButtonElement>("[data-rmc]").forEach((b) => b.addEventListener("click", () => { countries.splice(+b.dataset.rmc!, 1); renderCountries(); }));
  const single = countries.length === 1;
  const loc = $<HTMLInputElement>("#loc");
  loc.disabled = !single;
  loc.placeholder = single ? `City in ${byKey(countries[0])?.name || ""} (optional)` : "City: only when one country is selected";
  const sel = $<HTMLSelectElement>("#add-country");
  sel.innerHTML = `<option value="">+ Add country</option><option value="${WORLDWIDE.key}"${countries.includes(WORLDWIDE.key) ? " disabled" : ""}>${WORLDWIDE.name}</option>` +
    REGIONS.map((r) => `<optgroup label="${r}">${COUNTRIES.filter((c) => c.region === r)
      .map((c) => `<option value="${c.key}"${countries.includes(c.key) ? " disabled" : ""}>${esc(c.name)}</option>`).join("")}</optgroup>`).join("");
}
function addCountries(keys: string[]) {
  for (const k of keys) if (!countries.includes(k) && countries.length < MAX_COUNTRIES) countries.push(k);
  renderCountries();
}

function renderKeywords() {
  const inactive = ranked.filter((r) => !active.some((a) => fold(a) === fold(r.kw)));
  const demand = keywordDemand();
  const pct = (k: string) => demand.has(fold(k)) ? ` <small>${demand.get(fold(k))}%</small>` : "";
  $("#kw-active").innerHTML = active.map((k, i) => `<button type="button" class="chip kw on" data-off="${i}" title="Click to stop matching on this">${esc(k)}${pct(k)} ×</button>`).join("") ||
    `<span class="muted small-t">No keywords: jobs are ranked by title only.</span>`;
  $("#kw-more-n").textContent = inactive.length ? `${inactive.length} more from your resume` : "";
  $("#kw-more").innerHTML = inactive.map((r) => `<button type="button" class="chip kw" data-on="${esc(r.kw)}">+ ${esc(r.kw)}${pct(r.kw)}</button>`).join("");
  $("#kw-active").querySelectorAll<HTMLButtonElement>("[data-off]").forEach((b) => b.addEventListener("click", () => { kwTouched = true; active.splice(+b.dataset.off!, 1); refresh(); }));
  $("#kw-more").querySelectorAll<HTMLButtonElement>("[data-on]").forEach((b) => b.addEventListener("click", () => { kwTouched = true; active.push(b.dataset.on!); refresh(); }));
}

/** % of fetched jobs (with descriptions) that mention each skill. */
function keywordDemand() {
  const withDesc = jobs.filter((j) => j._hasDesc);
  const m = new Map<string, number>();
  if (!withDesc.length) return m;
  const counts = new Map<string, { kw: string; n: number }>();
  for (const j of withDesc) for (const s of new Set<string>(j._skills.map(fold))) {
    const c = counts.get(s) || { kw: j._skills.find((x: string) => fold(x) === s), n: 0 };
    c.n++; counts.set(s, c);
  }
  for (const [k, v] of counts) m.set(k, Math.round((100 * v.n) / withDesc.length));
  return m;
}

function renderInsights() {
  const withDesc = jobs.filter((j) => j._hasDesc);
  if (!withDesc.length) { $("#demand").innerHTML = `<p class="muted small-t">No job descriptions came back, so skill demand can't be measured.</p>`; return; }
  const mine = new Set(ranked.map((r) => fold(r.kw)));
  const counts = new Map<string, { kw: string; n: number }>();
  for (const j of withDesc) for (const s of j._skills as string[]) {
    if (SOFT_SKILLS.has(fold(s)) || DOMAINS.has(fold(s))) continue;
    const c = counts.get(fold(s)) || { kw: s, n: 0 }; c.n++; counts.set(fold(s), c);
  }
  const top = [...counts.values()].sort((a, b) => b.n - a.n).slice(0, 14);
  $("#demand").innerHTML = `<p class="muted small-t">Across ${withDesc.length} job descriptions:</p>` + top.map((c) => {
    const p = Math.round((100 * c.n) / withDesc.length);
    const have = mine.has(fold(c.kw));
    const on = active.some((a) => fold(a) === fold(c.kw));
    return `<div class="dem"><span class="dem-k">${esc(c.kw)}</span>
      <span class="bar"><i style="width:${p}%"></i></span><span class="dem-p">${p}%</span>
      ${have ? `<span class="have" title="On your resume">✓ on resume</span>` : `<span class="lack" title="Not found on your resume">not on resume</span>`}
      ${on ? "" : `<button type="button" class="link small" data-use="${esc(c.kw)}">match</button>`}</div>`;
  }).join("");
  $("#demand").querySelectorAll<HTMLButtonElement>("[data-use]").forEach((b) => b.addEventListener("click", () => { kwTouched = true; active.push(b.dataset.use!); refresh(); }));
}

function renderReport() {
  const d = lastData;
  if (!d) return;
  const rows = (d.report || []) as any[];
  const sites = [...new Set(rows.map((r) => r.site))];
  const cs = [...new Set(rows.map((r) => r.country))];
  const cell = (s: string, c: string) => {
    const r = rows.find((x) => x.site === s && x.country === c);
    if (!r) return `<td class="na" title="Not available for this country">–</td>`;
    if (r.status === "ok") return `<td class="${r.count ? "okc" : "zero"}" title="${r.secs}s">${r.count}</td>`;
    return `<td class="err" title="${esc(r.error || r.status)}">${r.status === "timeout" ? "timeout" : "failed"}</td>`;
  };
  const shown = jobs.filter(visible).length;
  $("#report-sum").innerHTML = `<b>${d.count}</b> jobs fetched in ${d.seconds}s` +
    (d.duplicates ? ` · ${d.duplicates} duplicates removed` : "") +
    (d.linkedin_total ? ` · LinkedIn descriptions: ${d.linkedin_enriched}/${d.linkedin_total}${d.linkedin_enriched < d.linkedin_total ? " (LinkedIn throttled the rest)" : ""}` : "") +
    ` · <b>${shown}</b> shown after filters`;
  $("#report-table").innerHTML = `<table><thead><tr><th></th>${sites.map((s) => `<th>${esc(s)}</th>`).join("")}</tr></thead><tbody>` +
    cs.map((c) => `<tr><th>${esc(c)}</th>${sites.map((s) => cell(s, c)).join("")}</tr>`).join("") + `</tbody></table>` +
    (d.skipped?.length ? `<p class="muted small-t">Skipped: ${esc(d.skipped.join("; "))}</p>` : "");
  const hidden = jobs.length - shown;
  $("#hidden-note").textContent = hidden ? `${hidden} hidden by filters` : "";
}

function salary(j: any) {
  if (!j.min_amount && !j.max_amount) return "";
  const f = (n: number) => (n ? Math.round(n).toLocaleString() : "?");
  return `${j.currency || ""} ${f(j.min_amount)}–${f(j.max_amount)}${j.interval ? " / " + j.interval : ""}`.trim();
}

function visible(j: any) {
  const q = $<HTMLInputElement>("#filter").value.toLowerCase();
  const cf = $<HTMLSelectElement>("#country-filter").value;
  const unrelated = $<HTMLInputElement>("#hide-unrelated").checked && j._title < 0.5;
  return !unrelated && inAgeRange(j) && (!cf || j.country === cf) &&
    (!q || [j.title, j.company, j.location, j.description].join(" ").toLowerCase().includes(q));
}

function renderJobs() {
  const sort = $<HTMLSelectElement>("#sort").value;
  const list = jobs.filter(visible).sort((a, b) =>
    sort === "match" ? b._match - a._match :
    sort === "salary" ? (b.max_amount || b.min_amount || 0) - (a.max_amount || a.min_amount || 0) :
    (postedMs(b) ?? -Infinity) - (postedMs(a) ?? -Infinity));
  $("#results").innerHTML = list.map((j) => `
    <article class="job">
      <div class="match" style="--c:${scoreColor(j._match)}" title="Title ${Math.round(j._title * 100)}% · keywords ${j._matched.length}/${active.length}"><b>${j._match}%</b><span>match</span></div>
      <div class="job-body">
        <h4><a href="${esc(j.job_url_direct || j.job_url)}" target="_blank" rel="noopener noreferrer">${esc(j.title)}</a></h4>
        <div class="meta"><strong>${esc(j.company)}</strong><span>${esc(j.location)}</span>${ageText(j)}
          ${salary(j) ? `<span>${esc(salary(j))}</span>` : ""}
          <span class="tag">${esc(j.site)}</span>${j.job_level ? `<span class="tag">${esc(j.job_level)}</span>` : ""}${j.job_type ? `<span class="tag">${esc(j.job_type)}</span>` : ""}${j.is_remote ? `<span class="tag">remote</span>` : ""}
        </div>
        ${j._matched.length ? `<div class="matched"><span class="muted small-t">Matches:</span> ${j._matched.map((k: string) => `<span class="chip sm">${esc(k)}</span>`).join("")}</div>` : ""}
        ${!j._hasDesc ? `<div class="muted small-t">No description available, so this job is ranked on its title only.</div>` : ""}
        ${j.description ? `<details><summary>Description</summary><div class="desc">${esc(j.description)}</div></details>` : ""}
      </div>
    </article>`).join("") || `<p class="muted center">No jobs match the current filters.${jobs.length ? " Try widening <b>Posted within</b>, or untick <b>Hide unrelated titles</b>." : ""}</p>`;
  const days = ageDays();
  $("#age-note").textContent = jobs.length && searchedDays != null && (days == null || days > searchedDays)
    ? `Results were fetched for the last ${searchedDays} day(s). Search again to include older jobs.` : "";
}

function refresh() {
  scoreJobs();
  renderKeywords();
  if (jobs.length) { renderInsights(); renderReport(); }
  renderJobs();
}

// ---------- entry ----------
export function goSearch(r: Resume, which: string) {
  resume = r;
  ranked = rankKeywords(r);
  active = ranked.slice(0, DEFAULT_KEYWORDS).map((x) => x.kw);
  const titles = resumeTitles(r);
  $<HTMLInputElement>("#q").value = titles[0] || "";
  $("#title-sugs").innerHTML = titles.map((t) => `<button type="button" class="chip sug" data-t="${esc(t)}">${esc(t)}</button>`).join("");
  $("#title-sugs").querySelectorAll<HTMLButtonElement>("[data-t]").forEach((b) => b.addEventListener("click", () => { $<HTMLInputElement>("#q").value = b.dataset.t!; if (jobs.length) refresh(); }));
  const where = detectCountry(r.profile.location || "");
  $<HTMLInputElement>("#loc").value = where.city;
  countries = [where.country || "usa"];
  renderCountries();
  $("#search-src").textContent = `Using your ${which} resume (score ${checkResume(r).score}).`;
  jobs = []; lastData = null; searchedDays = null; kwTouched = false;
  $("#results").innerHTML = ""; ["#res-bar", "#report", "#insights"].forEach((s) => ($(s).hidden = true));
  $("#s-status").textContent = "";
  renderKeywords();
}

export function initSearch(back: () => void) {
  $("#back-2").addEventListener("click", back);
  $("#presets").innerHTML = Object.keys(PRESETS).map((p) => `<button type="button" class="ghost small" data-preset="${esc(p)}">+ ${esc(p)}</button>`).join("") +
    `<button type="button" class="link small" id="clear-countries">Clear all</button>`;
  $("#presets").querySelectorAll<HTMLButtonElement>("[data-preset]").forEach((b) => b.addEventListener("click", () => addCountries(PRESETS[b.dataset.preset!])));
  $("#clear-countries").addEventListener("click", () => { countries = []; renderCountries(); });
  $("#add-country").addEventListener("change", (e) => { const el = e.target as HTMLSelectElement; if (el.value) addCountries([el.value]); el.value = ""; });
  $("#kw-add").addEventListener("keydown", (e: KeyboardEvent) => {
    const el = e.target as HTMLInputElement;
    if (e.key === "Enter" && el.value.trim()) {
      e.preventDefault();
      el.value.split(",").map((s) => s.trim()).filter(Boolean).forEach((k) => active.some((a) => fold(a) === fold(k)) || active.push(k));
      el.value = ""; kwTouched = true; refresh();
    }
  });
  $("#age").addEventListener("change", () => { $("#age-custom").hidden = $<HTMLSelectElement>("#age").value !== "custom"; if (jobs.length) { renderReport(); renderJobs(); } });
  ["#age-from", "#age-to", "#age-unknown", "#country-filter", "#sort", "#hide-unrelated"].forEach((id) =>
    $(id).addEventListener("change", () => { renderReport(); renderJobs(); }));
  $("#filter").addEventListener("input", () => { renderReport(); renderJobs(); });

  $("#sform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const sites = fd.getAll("site") as string[];
    if (!sites.length) { $("#s-status").textContent = "Pick at least one job board under Job boards."; return; }
    if (!countries.length) { $("#s-status").textContent = "Add at least one country."; return; }
    let days = ageDays();
    if ($<HTMLSelectElement>("#age").value === "custom") {
      const from = $<HTMLInputElement>("#age-from").valueAsDate;
      days = from ? Math.max(1, Math.ceil((Date.now() - from.getTime()) / DAY)) : null;
    }
    const body = {
      search_term: $<HTMLInputElement>("#q").value, location: countries.length === 1 ? $<HTMLInputElement>("#loc").value : "", countries,
      results_wanted: fd.get("n"), hours_old: days ? days * 24 : "", job_type: fd.get("jt"),
      is_remote: fd.has("remote"), sites,
    };
    const btn = $<HTMLButtonElement>("#s-go");
    btn.disabled = true;
    $("#s-status").innerHTML = `<span class="spin"></span> Searching ${sites.length} board(s) × ${countries.length} ${countries.length === 1 ? "country" : "countries"}, then fetching LinkedIn descriptions and post dates…`;
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error(res.status === 504 ? "Search timed out. Try fewer countries or boards." : `Server error (${res.status})`); }
      if (!res.ok) throw new Error(data.error || res.statusText);
      lastData = data; jobs = data.jobs; searchedDays = days;
      jobs.forEach((j) => delete j._skills);
      const seen = [...new Set(jobs.map((j) => j.country).filter(Boolean))].sort();
      const cf = $<HTMLSelectElement>("#country-filter");
      cf.innerHTML = `<option value="">All countries</option>` + seen.map((c) => `<option>${esc(c)}</option>`).join("");
      cf.hidden = seen.length < 2;
      ["#res-bar", "#report", "#insights"].forEach((s) => ($(s).hidden = false));
      $("#s-status").textContent = "";
      scoreJobs();
      if (!kwTouched) { const top = demandRanked(); if (top.length >= 3) active = top; }
      refresh();
      $("#report").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err: any) {
      $("#s-status").textContent = "Error: " + err.message;
    } finally { btn.disabled = false; }
  });

  $("#export").addEventListener("click", () => {
    const cols = ["_match", "title", "company", "location", "country", "site", "job_level", "date_posted", "date_source", "min_amount", "max_amount", "currency", "interval", "job_url"];
    const csv = [["match", ...cols.slice(1)].join(","), ...jobs.filter(visible).map((j) => cols.map((c) => `"${String(j[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "jobs.csv"; a.click();
  });
}
