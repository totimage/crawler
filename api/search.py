"""Job search endpoint backed by JobSpy (https://github.com/speedyapply/JobSpy)."""
import json
import math
import re
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

import requests

from flask import Flask, jsonify, request
from jobspy import scrape_jobs

app = Flask(__name__)

ALLOWED_SITES = {"indeed", "linkedin", "zip_recruiter", "glassdoor", "google", "bayt", "naukri"}
FIELDS = ["site", "title", "company", "location", "date_posted", "job_type", "is_remote",
          "interval", "min_amount", "max_amount", "currency", "job_url", "job_url_direct", "description"]
MAX_DESC = 6000
ENRICH_MAX = 25          # max job pages fetched to discover a missing post date
ENRICH_BUDGET = 12       # seconds for all page fetches together
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0 Safari/537.36")

DATE_META = re.compile(
    r"""<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|og:published_time|datePosted|"""
    r"""date|pubdate|publish[-_]date|article:modified_time|og:updated_time)["'][^>]*content=["']([^"']+)""",
    re.I)
DATE_ITEMPROP = re.compile(r"""itemprop=["']datePosted["'][^>]*(?:content|datetime)=["']([^"']+)""", re.I)
JSONLD = re.compile(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', re.I | re.S)
RELATIVE = re.compile(r'(?:posted|active|updated)?\s*(\d+)\+?\s*(minute|hour|day|week|month)s?\s+ago', re.I)


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


def to_date(v):
    """Parse an ISO-ish date string to a date, or None."""
    if not v:
        return None
    v = str(v).strip()
    try:
        return datetime.fromisoformat(v.replace("Z", "+00:00")[:25]).date()
    except ValueError:
        m = re.match(r"(\d{4})-(\d{2})-(\d{2})", v)
        return date(int(m[1]), int(m[2]), int(m[3])) if m else None


def find_posted(obj):
    """Search JSON-LD for a JobPosting datePosted."""
    if isinstance(obj, list):
        for o in obj:
            d = find_posted(o)
            if d:
                return d
    elif isinstance(obj, dict):
        if obj.get("datePosted"):
            return obj["datePosted"]
        for k in ("@graph", "mainEntity", "itemListElement"):
            if k in obj:
                d = find_posted(obj[k])
                if d:
                    return d
    return None


def page_date(url):
    """Work out when a job page was posted: (iso date, source) or (None, None)."""
    try:
        r = requests.get(url, headers={"User-Agent": UA, "Accept-Language": "en-US,en;q=0.9"},
                         timeout=5, allow_redirects=True)
    except requests.RequestException:
        return None, None
    html = r.text[:600_000] if r.ok else ""
    for block in JSONLD.findall(html):
        try:
            d = to_date(find_posted(json.loads(block.strip())))
        except (ValueError, TypeError):
            d = None
        if d:
            return d.isoformat(), "page"
    for rx in (DATE_ITEMPROP, DATE_META):
        m = rx.search(html)
        if m and to_date(m[1]):
            return to_date(m[1]).isoformat(), "page"
    m = RELATIVE.search(re.sub(r"<[^>]+>", " ", html[:200_000]))
    if m:
        n, unit = int(m[1]), m[2].lower()
        delta = {"minute": timedelta(minutes=n), "hour": timedelta(hours=n), "day": timedelta(days=n),
                 "week": timedelta(weeks=n), "month": timedelta(days=30 * n)}[unit]
        return (datetime.now(timezone.utc) - delta).date().isoformat(), "page"
    lm = r.headers.get("Last-Modified")
    if lm:
        try:
            return parsedate_to_datetime(lm).date().isoformat(), "page-modified"
        except (TypeError, ValueError):
            pass
    return None, None


def enrich_dates(jobs):
    """Fill missing date_posted by inspecting the job page (bounded in count and time)."""
    for j in jobs:
        d = to_date(j.get("date_posted"))
        j["date_posted"] = d.isoformat() if d else None
        j["date_source"] = "posted" if d else None
    todo = [j for j in jobs if not j["date_posted"] and (j.get("job_url_direct") or j.get("job_url"))][:ENRICH_MAX]
    if not todo:
        return
    ex = ThreadPoolExecutor(max_workers=10)
    futures = {ex.submit(page_date, j.get("job_url_direct") or j["job_url"]): j for j in todo}
    done, _ = wait(futures, timeout=ENRICH_BUDGET)
    for f in done:
        d, src = f.result()
        if d:
            futures[f]["date_posted"], futures[f]["date_source"] = d, src
    ex.shutdown(wait=False, cancel_futures=True)


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
    enrich_dates(unique)
    return jsonify(jobs=unique, count=len(unique), errors=errors)


if __name__ == "__main__":
    # local dev: python api/search.py, then use `npm run dev`
    app.run(port=5056)
