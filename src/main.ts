import { parseResumeFromPdf } from "lib/parse-resume-from-pdf";
import type { Resume } from "lib/redux/types";
import { checkResume, applyAllFixes, applyFix, hasMetric, CheckResult, Memory, emptyMemory } from "./checker";
import { goSearch, initSearch } from "./search";
import { downloadPdf, downloadDocx } from "./export";

// ---------- state ----------
let original: Resume | null = null;
let current: Resume | null = null;
let originalScore = 0;
let fileBase = "resume";
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
    // tidy pdf.js spacing artifacts like "Figma , FigJam"
    const parsed = JSON.parse(JSON.stringify(await parseResumeFromPdf(url)),
      (_k, v) => (typeof v === "string" ? v.replace(/\s+([,.;:])/g, "$1").replace(/\s{2,}/g, " ").trim() : v)) as Resume;
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
  $("#use-updated").addEventListener("click", () => startSearch(current!, "updated"));
  $("#use-original").addEventListener("click", () => startSearch(original!, "uploaded"));
  $("#skip-updated").addEventListener("click", () => startSearch(current!, "updated"));
  $("#skip-original").addEventListener("click", () => startSearch(original!, "uploaded"));
  $("#back-1").addEventListener("click", () => showStep(1));
}

// ---------- step 3: job search (see search.ts) ----------
function startSearch(r: Resume, which: string) { goSearch(r, which); showStep(3); }

initUpload(); initImprove(); initSearch(() => showStep(2)); showStep(1);

