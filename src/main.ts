import { parseResumeFromPdf } from "lib/parse-resume-from-pdf";
import type { Resume } from "lib/redux/types";
import { checkResume, applyAllFixes, applyFix, detectKeywords, hasMetric, CheckResult, Memory, emptyMemory } from "./checker";
import { findSkills } from "./skills";
import { downloadPdf, downloadDocx } from "./export";

// ---------- state ----------
let original: Resume | null = null;
let current: Resume | null = null;
let originalScore = 0;
let fileBase = "resume";
let jobs: any[] = [];
let searchResume: Resume | null = null;
let mem: Memory = emptyMemory();
let memKey = "";

// ---------- memory: last updated resume + what was already optimized, per uploaded file ----------
const STORE = "crawler.memory.v1";
function hash(s: string) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
function loadStore(): Record<string, any> { try { return JSON.parse(localStorage.getItem(STORE) || "{}"); } catch { return {}; } }
function saveMemory() {
  if (!memKey || !current) return;
  try {
    const all = loadStore();
    all[memKey] = { updated: current, optimized: [...mem.optimized], dismissed: [...mem.dismissed], savedAt: Date.now(), name: fileBase };
    const keys = Object.keys(all).sort((a, b) => all[b].savedAt - all[a].savedAt);
    keys.slice(5).forEach((k) => delete all[k]);
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch { /* storage unavailable: memory lasts for this session only */ }
}
function forgetMemory() { try { const all = loadStore(); delete all[memKey]; localStorage.setItem(STORE, JSON.stringify(all)); } catch { /* ignore */ } }
let saveTimer = 0;
const saveSoon = () => { clearTimeout(saveTimer); saveTimer = window.setTimeout(saveMemory, 400); };

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const clone = (r: Resume): Resume => JSON.parse(JSON.stringify(r));

function showStep(n: number) {
  document.querySelectorAll<HTMLElement>("[data-step]").forEach((el) => (el.hidden = el.dataset.step !== String(n)));
  document.querySelectorAll<HTMLElement>(".stepper li").forEach((li, i) => {
    li.classList.toggle("active", i + 1 === n);
    li.classList.toggle("done", i + 1 < n);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- step 1: upload & parse ----------
async function handleFile(url: string, name: string) {
  $("#upload-status").textContent = "Parsing resume…";
  try {
    const parsed = (await parseResumeFromPdf(url)) as Resume;
    original = parsed;
    current = clone(parsed);
    mem = emptyMemory();
    originalScore = checkResume(parsed).score;
    fileBase = name.replace(/\.pdf$/i, "") || "resume";
    memKey = hash(JSON.stringify(parsed));
    const saved = loadStore()[memKey];
    if (saved?.updated) {
      current = saved.updated;
      mem = { optimized: new Set(saved.optimized || []), dismissed: new Set(saved.dismissed || []) };
      $("#restored").hidden = false;
      $("#restored-when").textContent = new Date(saved.savedAt).toLocaleString();
    } else $("#restored").hidden = true;
    $("#upload-status").textContent = "";
    renderEditor();
    renderScore();
    showStep(2);
  } catch (e: any) {
    console.error(e);
    $("#upload-status").textContent = "Could not parse this PDF: " + (e?.message || e) + ". Make sure it is a text-based (not scanned) PDF.";
  }
}

function initUpload() {
  const input = $<HTMLInputElement>("#file");
  const drop = $("#drop");
  input.addEventListener("change", () => {
    const f = input.files?.[0];
    if (f) handleFile(URL.createObjectURL(f), f.name);
  });
  ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e: DragEvent) => {
    const f = e.dataTransfer?.files?.[0];
    if (f && /pdf$/i.test(f.type || f.name)) handleFile(URL.createObjectURL(f), f.name);
    else $("#upload-status").textContent = "Please drop a PDF file.";
  });
  $("#sample").addEventListener("click", () => handleFile("/samples/sample-resume.pdf", "sample-resume.pdf"));
}

// ---------- step 2: score + recommendations + editor ----------
function scoreColor(s: number) { return s >= 80 ? "var(--good)" : s >= 60 ? "var(--warn)" : "var(--bad)"; }

function renderScore() {
  if (!current) return;
  const res: CheckResult = checkResume(current, mem);
  const s = res.score, C = 2 * Math.PI * 52;
  const delta = s - originalScore;
  $("#score").innerHTML = `
    <div class="ring">
      <svg viewBox="0 0 120 120" width="132" height="132" aria-hidden="true">
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" stroke-width="10"/>
        <circle cx="60" cy="60" r="52" fill="none" stroke="${scoreColor(s)}" stroke-width="10" stroke-linecap="round"
          stroke-dasharray="${(C * s) / 100} ${C}" transform="rotate(-90 60 60)"/>
      </svg>
      <div class="ring-num"><b>${s}</b><span>/ 100</span></div>
    </div>
    <div class="score-meta">
      <div class="score-label">ATS score</div>
      ${delta ? `<div class="delta ${delta > 0 ? "up" : "down"}">${delta > 0 ? "+" : ""}${delta} vs. original (${originalScore})</div>` : `<div class="muted">Original resume</div>`}
      <div class="cats">${res.categories.map((c) => `
        <div class="cat"><span>${c.name}</span>
          <div class="bar"><i style="width:${(100 * c.score) / c.max}%;background:${scoreColor((100 * c.score) / c.max)}"></i></div>
          <em>${c.score}/${c.max}</em></div>`).join("")}
      </div>
    </div>`;
  const fixable = res.recommendations.filter((r) => r.fix);
  $("#recs").innerHTML = (res.recommendations.length ? res.recommendations.map((r, i) => `
    <li class="rec ${r.severity}">
      <span class="sev">${r.severity}</span>
      <div><small>${esc(r.category)}</small><p>${esc(r.message)}</p></div>
      <div class="rec-actions">${r.fix ? `<button class="small" data-fix="${i}">${esc(r.fixLabel)}</button>` : ""}<button class="small link" data-ignore="${i}">Ignore</button></div>
    </li>`).join("") : `<li class="rec ok"><p>No issues found. Nice work.</p></li>`);
  $<HTMLButtonElement>("#fix-all").disabled = !fixable.length;
  $("#recs").querySelectorAll<HTMLButtonElement>("[data-fix]").forEach((btn) =>
    btn.addEventListener("click", () => {
      const rec = res.recommendations[+btn.dataset.fix!];
      current = applyFix(current!, rec, mem);
      renderEditor(); renderScore(); saveMemory();
    }));
  $("#recs").querySelectorAll<HTMLButtonElement>("[data-ignore]").forEach((btn) =>
    btn.addEventListener("click", () => {
      mem.dismissed.add(res.recommendations[+btn.dataset.ignore!].id);
      renderScore(); saveMemory();
    }));
  $("#ignored").hidden = !mem.dismissed.size;
  const kws = res.keywords;
  $("#kw").innerHTML = kws.length ? kws.map((k) => `<span class="chip">${esc(k)}</span>`).join("") : `<span class="muted">None detected</span>`;
}

function getPath(obj: any, path: string) { return path.split(".").reduce((o, k) => o?.[k], obj); }
function setPath(obj: any, path: string, val: any) {
  const ks = path.split("."); const last = ks.pop()!;
  const tgt = ks.reduce((o, k) => o[k], obj); tgt[last] = val;
}

function field(label: string, path: string, opts: { wide?: boolean; area?: boolean; lines?: boolean; rows?: number } = {}) {
  const v = getPath(current, path);
  const val = opts.lines ? (v as string[]).join("\n") : (v ?? "");
  const cls = opts.wide ? "f wide" : "f";
  if (opts.area || opts.lines)
    return `<label class="${cls}">${label}<textarea data-path="${path}" ${opts.lines ? 'data-lines="1"' : ""} rows="${opts.rows || 4}">${esc(val)}</textarea></label>`;
  return `<label class="${cls}">${label}<input data-path="${path}" value="${esc(val)}"></label>`;
}

function bulletHints(list: string[]) {
  const missing = list.filter((b) => b.trim() && !hasMetric(b));
  return missing.length ? `<div class="hint">⚠ ${missing.length} bullet(s) without numbers: ${missing.slice(0, 3).map((b) => `<q>${esc(b.slice(0, 60))}${b.length > 60 ? "…" : ""}</q>`).join(" ")}</div>` : "";
}

function renderEditor() {
  if (!current) return;
  const r = current;
  const block = (title: string, key: "workExperiences" | "educations" | "projects", body: (i: number) => string, empty: any) => `
    <section class="ed-sec"><h3>${title} <button class="small ghost" data-add="${key}">+ Add</button></h3>
      ${r[key].map((_: any, i: number) => `<div class="entry"><button class="x" title="Remove" data-del="${key}.${i}">×</button>${body(i)}</div>`).join("")}
    </section>`;
  $("#editor").innerHTML = `
    <section class="ed-sec"><h3>Profile</h3><div class="grid">
      ${field("Name", "profile.name")}${field("Email", "profile.email")}${field("Phone", "profile.phone")}
      ${field("Location", "profile.location")}${field("URL (LinkedIn / site)", "profile.url", { wide: true })}
      ${field("Summary", "profile.summary", { wide: true, area: true })}
    </div></section>
    ${block("Experience", "workExperiences", (i) => `<div class="grid">
      ${field("Job title", `workExperiences.${i}.jobTitle`)}${field("Company", `workExperiences.${i}.company`)}${field("Dates", `workExperiences.${i}.date`)}
      ${field("Bullets (one per line)", `workExperiences.${i}.descriptions`, { wide: true, lines: true, rows: Math.max(3, r.workExperiences[i].descriptions.length + 1) })}
    </div>${bulletHints(r.workExperiences[i].descriptions)}`, null)}
    ${block("Projects", "projects", (i) => `<div class="grid">
      ${field("Project", `projects.${i}.project`)}${field("Dates", `projects.${i}.date`)}
      ${field("Bullets (one per line)", `projects.${i}.descriptions`, { wide: true, lines: true, rows: Math.max(2, r.projects[i].descriptions.length + 1) })}
    </div>${bulletHints(r.projects[i].descriptions)}`, null)}
    ${block("Education", "educations", (i) => `<div class="grid">
      ${field("School", `educations.${i}.school`)}${field("Degree", `educations.${i}.degree`)}${field("Dates", `educations.${i}.date`)}${field("GPA", `educations.${i}.gpa`)}
      ${field("Details (one per line)", `educations.${i}.descriptions`, { wide: true, lines: true, rows: 2 })}
    </div>`, null)}
    <section class="ed-sec"><h3>Skills</h3><div class="grid">
      ${field("Skills (comma-separated, one group per line)", "skills.descriptions", { wide: true, lines: true, rows: 3 })}
    </div></section>`;

  // featured skills (OpenResume) are folded into descriptions for simpler editing
  if (r.skills.featuredSkills.some((s) => s.skill.trim())) {
    const fs = r.skills.featuredSkills.map((s) => s.skill.trim()).filter(Boolean);
    r.skills.descriptions = [fs.join(", "), ...r.skills.descriptions];
    r.skills.featuredSkills = [];
    renderEditor();
    return;
  }

  const ed = $("#editor");
  ed.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-path]").forEach((el) =>
    el.addEventListener("input", () => {
      const v = el.dataset.lines ? el.value.split("\n").map((s) => s.trim()).filter(Boolean) : el.value;
      setPath(current, el.dataset.path!, v);
      renderScore(); saveSoon();
    }));
  ed.querySelectorAll<HTMLButtonElement>("[data-add]").forEach((b) => b.addEventListener("click", () => {
    const k = b.dataset.add as "workExperiences" | "educations" | "projects";
    const blank = { workExperiences: { company: "", jobTitle: "", date: "", descriptions: [] },
      educations: { school: "", degree: "", date: "", gpa: "", descriptions: [] },
      projects: { project: "", date: "", descriptions: [] } }[k];
    (current![k] as any[]).push(blank);
    renderEditor(); renderScore(); saveSoon();
  }));
  ed.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((b) => b.addEventListener("click", () => {
    const [k, i] = b.dataset.del!.split(".");
    (current as any)[k].splice(+i, 1);
    renderEditor(); renderScore(); saveSoon();
  }));
}

function initImprove() {
  $("#fix-all").addEventListener("click", () => { current = applyAllFixes(current!, mem); renderEditor(); renderScore(); saveMemory(); });
  $("#reset").addEventListener("click", () => {
    if (original && confirm("Discard all edits and the optimizer memory for this resume, and go back to the uploaded version?")) {
      current = clone(original); mem = emptyMemory(); forgetMemory(); $("#restored").hidden = true; renderEditor(); renderScore();
    }
  });
  $("#show-ignored").addEventListener("click", () => { mem.dismissed.clear(); renderScore(); saveMemory(); });
  $("#dl-pdf").addEventListener("click", () => downloadPdf(current!, `${fileBase}-updated.pdf`));
  $("#dl-docx").addEventListener("click", () => downloadDocx(current!, `${fileBase}-updated.docx`));
  $("#dl-json").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: "application/json" }));
    a.download = `${fileBase}-updated.json`; a.click();
  });
  $("#use-updated").addEventListener("click", () => goSearch(current!, "updated"));
  $("#use-original").addEventListener("click", () => goSearch(original!, "uploaded"));
  $("#skip-updated").addEventListener("click", () => goSearch(current!, "updated"));
  $("#skip-original").addEventListener("click", () => goSearch(original!, "uploaded"));
  $("#back-1").addEventListener("click", () => showStep(1));
}

// ---------- step 3: job search ----------
let searchKeywords: string[] = [];

function goSearch(r: Resume, which: string) {
  searchResume = r;
  searchKeywords = detectKeywords(r);
  const title = r.workExperiences.find((w) => w.jobTitle.trim())?.jobTitle.trim() || "";
  $<HTMLInputElement>("#q").value = title;
  $<HTMLInputElement>("#loc").value = r.profile.location || "";
  $("#search-src").textContent = `Using your ${which} resume (score ${checkResume(r).score}).`;
  renderKeywords();
  $("#results").innerHTML = ""; $("#res-bar").hidden = true; jobs = [];
  showStep(3);
}

function renderKeywords() {
  $("#skw").innerHTML = searchKeywords.map((k, i) => `<span class="chip">${esc(k)}<button data-rm="${i}" aria-label="Remove">×</button></span>`).join("") ||
    `<span class="muted">No keywords. Add some below.</span>`;
  $("#skw").querySelectorAll<HTMLButtonElement>("[data-rm]").forEach((b) => b.addEventListener("click", () => { searchKeywords.splice(+b.dataset.rm!, 1); renderKeywords(); scoreJobs(); renderJobs(); }));
}

function titleTokens(s: string) {
  const stop = new Set(["and", "of", "the", "for", "to", "in", "a", "senior", "junior", "sr", "jr", "i", "ii", "iii", "lead"]);
  return new Set(s.toLowerCase().split(/[^a-z0-9+#]+/).filter((t) => t.length > 1 && !stop.has(t)));
}

function scoreJobs() {
  const titles = searchResume ? searchResume.workExperiences.map((w) => w.jobTitle).join(" ") + " " + $<HTMLInputElement>("#q").value : "";
  const tt = titleTokens(titles);
  const denom = Math.max(1, Math.min(searchKeywords.length, 12));
  for (const j of jobs) {
    const text = `${j.title || ""}\n${j.description || ""}`;
    const matched = searchKeywords.length ? findSkills(text, searchKeywords).filter((k) => searchKeywords.some((s) => s.toLowerCase() === k.toLowerCase())) : [];
    const jt = titleTokens(j.title || "");
    const overlap = [...jt].filter((t) => tt.has(t)).length / Math.max(1, jt.size);
    const kwScore = Math.min(1, matched.length / denom);
    j._noDesc = !(j.description && j.description.length > 200);
    j._matched = matched;
    // same formula for every job; jobs without a description can only match on title keywords
    j._match = Math.round(100 * (0.55 * kwScore + 0.45 * overlap));
  }
}

function salary(j: any) {
  if (!j.min_amount && !j.max_amount) return "";
  const f = (n: number) => (n ? Math.round(n).toLocaleString() : "?");
  return `${j.currency || ""} ${f(j.min_amount)}–${f(j.max_amount)}${j.interval ? " / " + j.interval : ""}`.trim();
}

function renderJobs() {
  const q = $<HTMLInputElement>("#filter").value.toLowerCase();
  const sort = $<HTMLSelectElement>("#sort").value;
  const list = jobs.filter((j) => !q || [j.title, j.company, j.location].join(" ").toLowerCase().includes(q));
  list.sort((a, b) =>
    sort === "match" ? b._match - a._match :
    sort === "salary" ? (b.max_amount || b.min_amount || 0) - (a.max_amount || a.min_amount || 0) :
    String(b.date_posted || "").localeCompare(String(a.date_posted || "")));
  $("#res-count").textContent = `${list.length} of ${jobs.length} jobs`;
  $("#results").innerHTML = list.map((j) => `
    <article class="job">
      <div class="match" style="--c:${scoreColor(j._match)}"><b>${j._match}%</b><span>match</span></div>
      <div class="job-body">
        <h4><a href="${esc(j.job_url_direct || j.job_url)}" target="_blank" rel="noopener noreferrer">${esc(j.title)}</a></h4>
        <div class="meta"><strong>${esc(j.company)}</strong><span>${esc(j.location)}</span>
          ${j.date_posted ? `<span>${esc(j.date_posted)}</span>` : ""}
          ${salary(j) ? `<span>${esc(salary(j))}</span>` : ""}
          <span class="tag">${esc(j.site)}</span>${j.job_type ? `<span class="tag">${esc(j.job_type)}</span>` : ""}${j.is_remote ? `<span class="tag">remote</span>` : ""}
        </div>
        ${j._matched.length ? `<div class="matched">${j._matched.map((k: string) => `<span class="chip sm">${esc(k)}</span>`).join("")}</div>` : ""}
        ${j._noDesc ? `<div class="muted small-t">No description returned; matched on title only. Tick "Full descriptions" for better LinkedIn matching.</div>` : ""}
        ${j.description ? `<details><summary>Description</summary><div class="desc">${esc(j.description)}</div></details>` : ""}
      </div>
    </article>`).join("") || `<p class="muted">No jobs match the filter.</p>`;
}

function initSearch() {
  $("#back-2").addEventListener("click", () => showStep(2));
  $("#kw-add").addEventListener("keydown", (e: KeyboardEvent) => {
    const el = e.target as HTMLInputElement;
    if (e.key === "Enter" && el.value.trim()) {
      e.preventDefault();
      el.value.split(",").map((s) => s.trim()).filter(Boolean).forEach((k) => searchKeywords.includes(k) || searchKeywords.push(k));
      el.value = ""; renderKeywords(); scoreJobs(); renderJobs();
    }
  });
  $("#sform").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target as HTMLFormElement);
    const sites = fd.getAll("site") as string[];
    if (!sites.length) { $("#s-status").textContent = "Pick at least one site."; return; }
    const body = {
      search_term: fd.get("q"), location: fd.get("loc"), country: fd.get("country"),
      results_wanted: fd.get("n"), hours_old: fd.get("hours"), job_type: fd.get("jt"),
      is_remote: fd.has("remote"), fetch_description: fd.has("desc"), sites,
    };
    const btn = $<HTMLButtonElement>("#s-go");
    btn.disabled = true; $("#s-status").textContent = "Searching job boards… this can take up to a minute.";
    try {
      const res = await fetch("/api/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { throw new Error(res.status === 504 ? "Search timed out. Try fewer sites or results." : `Server error (${res.status})`); }
      if (!res.ok) throw new Error(data.error || res.statusText);
      jobs = data.jobs;
      scoreJobs();
      const errs = data.errors && Object.keys(data.errors).length ? ` Some sites failed: ${Object.keys(data.errors).join(", ")}.` : "";
      $("#s-status").textContent = `Found ${jobs.length} jobs, ranked by match with your resume.${errs}`;
      $("#res-bar").hidden = false;
      renderJobs();
    } catch (err: any) {
      $("#s-status").textContent = "Error: " + err.message;
    } finally { btn.disabled = false; }
  });
  $("#filter").addEventListener("input", renderJobs);
  $("#sort").addEventListener("change", renderJobs);
  $("#export").addEventListener("click", () => {
    const cols = ["_match", "title", "company", "location", "site", "date_posted", "min_amount", "max_amount", "currency", "interval", "job_url"];
    const csv = [["match", ...cols.slice(1)].join(","), ...jobs.map((j) => cols.map((c) => `"${String(j[c] ?? "").replace(/"/g, '""')}"`).join(","))].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "jobs.csv"; a.click();
  });
}

initUpload(); initImprove(); initSearch(); showStep(1);
