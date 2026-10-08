"""Job search endpoint backed by JobSpy (https://github.com/speedyapply/JobSpy)."""
import math
from concurrent.futures import ThreadPoolExecutor

from flask import Flask, jsonify, request
from jobspy import scrape_jobs

app = Flask(__name__)

ALLOWED_SITES = {"indeed", "linkedin", "zip_recruiter", "glassdoor", "google", "bayt", "naukri"}
FIELDS = ["site", "title", "company", "location", "date_posted", "job_type", "is_remote",
          "interval", "min_amount", "max_amount", "currency", "job_url", "job_url_direct", "description"]
MAX_DESC = 6000


def clean(v):
    if v is None:
        return None
    if isinstance(v, float) and math.isnan(v):
        return None
    if hasattr(v, "isoformat"):
        return v.isoformat()
    if isinstance(v, (bool, int, float)):
        return v
    s = str(v)
    return s if s not in ("nan", "NaT", "None") else None


def scrape_site(site, p):
    kwargs = dict(
        site_name=[site],
        search_term=p["search_term"],
        location=p.get("location") or None,
        results_wanted=p["results_wanted"],
        country_indeed=p.get("country") or "USA",
        is_remote=p["is_remote"],
        verbose=0,
    )
    if p.get("hours_old"):
        kwargs["hours_old"] = p["hours_old"]
    if p.get("job_type"):
        kwargs["job_type"] = p["job_type"]
    if site == "linkedin" and p.get("fetch_description"):
        kwargs["fetch_description"] = True
    if site == "google":
        kwargs["google_search_term"] = " ".join(
            x for x in [p["search_term"], "jobs near" if p.get("location") else "", p.get("location") or ""] if x)
    df = scrape_jobs(**kwargs)
    cols = [c for c in FIELDS if c in df.columns]
    rows = []
    for _, r in df.iterrows():
        row = {c: clean(r[c]) for c in cols}
        if row.get("description"):
            row["description"] = row["description"][:MAX_DESC]
        rows.append(row)
    return rows


@app.route("/api/search", methods=["POST"])
def search():
    p = request.get_json(force=True, silent=True) or {}
    term = (p.get("search_term") or "").strip()
    if not term:
        return jsonify(error="search_term is required"), 400
    sites = [s for s in (p.get("sites") or ["indeed", "linkedin"]) if s in ALLOWED_SITES] or ["indeed"]
    params = dict(
        search_term=term[:120],
        location=(p.get("location") or "").strip()[:120],
        country=(p.get("country") or "USA").strip()[:40],
        results_wanted=max(1, min(int(p.get("results_wanted") or 20), 50)),
        hours_old=int(p["hours_old"]) if p.get("hours_old") else None,
        job_type=p.get("job_type") if p.get("job_type") in {"fulltime", "parttime", "contract", "internship"} else None,
        is_remote=bool(p.get("is_remote")),
        fetch_description=bool(p.get("fetch_description")),
    )

    jobs, errors = [], {}
    # scrape each site in parallel so one slow/blocked board doesn't sink the rest
    with ThreadPoolExecutor(max_workers=len(sites)) as ex:
        futures = {s: ex.submit(scrape_site, s, params) for s in sites}
        for s, f in futures.items():
            try:
                jobs.extend(f.result(timeout=55))
            except Exception as e:  # noqa: BLE001 - report per-site failure to the UI
                errors[s] = str(e)[:300]

    seen, unique = set(), []
    for j in jobs:
        key = ((j.get("title") or "").lower(), (j.get("company") or "").lower())
        if key in seen:
            continue
        seen.add(key)
        unique.append(j)
    return jsonify(jobs=unique, count=len(unique), errors=errors)


if __name__ == "__main__":
    # local dev: python api/search.py, then use `npm run dev`
    app.run(port=5056)
