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
SCRAPE_BUDGET = 75       # seconds for all board searches together
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


# Countries JobSpy knows (Indeed/LinkedIn work in all): key -> (display name, Glassdoor support)
COUNTRIES = {
    "austria": ("Austria", True), "belgium": ("Belgium", True), "bulgaria": ("Bulgaria", False),
    "croatia": ("Croatia", False), "cyprus": ("Cyprus", False), "czech republic": ("Czech Republic", False),
    "denmark": ("Denmark", False), "estonia": ("Estonia", False), "finland": ("Finland", False),
    "france": ("France", True), "germany": ("Germany", True), "greece": ("Greece", False),
    "hungary": ("Hungary", False), "ireland": ("Ireland", True), "italy": ("Italy", True),
    "latvia": ("Latvia", False), "lithuania": ("Lithuania", False), "luxembourg": ("Luxembourg", False),
    "malta": ("Malta", False), "netherlands": ("Netherlands", True), "norway": ("Norway", False),
    "poland": ("Poland", False), "portugal": ("Portugal", False), "romania": ("Romania", False),
    "slovakia": ("Slovakia", False), "slovenia": ("Slovenia", False), "spain": ("Spain", True),
    "sweden": ("Sweden", False), "switzerland": ("Switzerland", True), "turkey": ("Turkey", False),
    "ukraine": ("Ukraine", False), "uk": ("United Kingdom", True),
    "usa": ("United States", True), "canada": ("Canada", True), "mexico": ("Mexico", True),
    "argentina": ("Argentina", True), "brazil": ("Brazil", True), "chile": ("Chile", False),
    "colombia": ("Colombia", False), "costa rica": ("Costa Rica", False), "ecuador": ("Ecuador", False),
    "panama": ("Panama", False), "peru": ("Peru", False), "uruguay": ("Uruguay", False),
    "venezuela": ("Venezuela", False),
    "australia": ("Australia", True), "bangladesh": ("Bangladesh", False), "china": ("China", False),
    "hong kong": ("Hong Kong", True), "india": ("India", True), "indonesia": ("Indonesia", False),
    "japan": ("Japan", False), "malaysia": ("Malaysia", True), "new zealand": ("New Zealand", True),
    "pakistan": ("Pakistan", False), "philippines": ("Philippines", False), "singapore": ("Singapore", True),
    "south korea": ("South Korea", False), "taiwan": ("Taiwan", False), "thailand": ("Thailand", False),
    "vietnam": ("Vietnam", True),
    "bahrain": ("Bahrain", False), "israel": ("Israel", False), "kuwait": ("Kuwait", False),
    "oman": ("Oman", False), "qatar": ("Qatar", False), "saudi arabia": ("Saudi Arabia", False),
    "united arab emirates": ("United Arab Emirates", False),
    "egypt": ("Egypt", False), "morocco": ("Morocco", False), "nigeria": ("Nigeria", False),
    "south africa": ("South Africa", False),
    "worldwide": ("Worldwide", False),
}
MIDDLE_EAST = {"bahrain", "israel", "kuwait", "oman", "qatar", "saudi arabia", "united arab emirates"}
MAX_COUNTRIES = 10


def plan_tasks(sites, countries):
    """(site, country) pairs to scrape, plus notes about combinations that were skipped."""
    tasks, skipped = [], []
    for site in sites:
        if site == "bayt":  # one regional search, no country filter
            me = [c for c in countries if c in MIDDLE_EAST]
            if me:
                tasks.append((site, me[0]))
            else:
                skipped.append("Bayt: only for Middle East countries")
            continue
        unsupported = []
        for c in countries:
            ok = {
                "zip_recruiter": c in ("usa", "canada"),
                "glassdoor": COUNTRIES[c][1],
                "naukri": c == "india",
                "google": c != "worldwide",
            }.get(site, True)
            if ok:
                tasks.append((site, c))
            else:
                unsupported.append(COUNTRIES[c][0])
        if unsupported:
            label = {"zip_recruiter": "ZipRecruiter", "glassdoor": "Glassdoor", "naukri": "Naukri", "google": "Google"}.get(site, site)
            skipped.append(f"{label} not available for {', '.join(unsupported[:4])}{'…' if len(unsupported) > 4 else ''}")
    return tasks, skipped


def scrape_site(site, country, p):
    name = COUNTRIES[country][0]
    city = p.get("location") or ""
    kwargs = dict(
        site_name=[site],
        search_term=p["search_term"],
        results_wanted=p["results_wanted"],
        country_indeed=country,
        is_remote=p["is_remote"],
        verbose=0,
    )
    if site == "linkedin":
        kwargs["location"] = f"{city}, {name}" if city else name
        if p.get("fetch_description"):
            kwargs["fetch_description"] = True
    elif site == "glassdoor":
        kwargs["location"] = city.split(",")[0] if city else name  # Glassdoor resolves plain city names best
    elif site in ("indeed", "zip_recruiter", "naukri") and city:
        kwargs["location"] = city  # the country itself is set via country_indeed
    if site == "google":
        kwargs["google_search_term"] = f'{p["search_term"]} jobs in {city + ", " if city else ""}{name}'
    if p.get("hours_old"):
        kwargs["hours_old"] = p["hours_old"]
    if p.get("job_type"):
        kwargs["job_type"] = p["job_type"]
    df = scrape_jobs(**kwargs)
    cols = [c for c in FIELDS if c in df.columns]
    rows = []
    for _, r in df.iterrows():
        row = {c: clean(r[c]) for c in cols}
        if row.get("description"):
            row["description"] = row["description"][:MAX_DESC]
        row["country"] = None if country == "worldwide" or site == "bayt" else name
        rows.append(row)
    return rows


@app.route("/api/search", methods=["POST"])
def search():
    p = request.get_json(force=True, silent=True) or {}
    term = (p.get("search_term") or "").strip()
    if not term:
        return jsonify(error="search_term is required"), 400
    sites = [s for s in (p.get("sites") or ["indeed", "linkedin"]) if s in ALLOWED_SITES] or ["indeed"]
    raw = p.get("countries") or [p.get("country") or "usa"]
    countries = [c.strip().lower() for c in raw if isinstance(c, str)]
    countries = list(dict.fromkeys(c for c in countries if c in COUNTRIES))[:MAX_COUNTRIES] or ["usa"]
    many = len(countries) > 1
    params = dict(
        search_term=term[:120],
        location="" if many else (p.get("location") or "").strip()[:120],
        results_wanted=max(1, min(int(p.get("results_wanted") or 20), 50)),
        hours_old=int(p["hours_old"]) if p.get("hours_old") else None,
        job_type=p.get("job_type") if p.get("job_type") in {"fulltime", "parttime", "contract", "internship"} else None,
        is_remote=bool(p.get("is_remote")) or countries == ["worldwide"],
        fetch_description=bool(p.get("fetch_description")),
    )
    if many:  # keep total work bounded when fanning out over countries
        params["results_wanted"] = max(5, params["results_wanted"] // 2)

    tasks, skipped = plan_tasks(sites, countries)
    label = (lambda s, c: f"{s} ({COUNTRIES[c][0]})") if many else (lambda s, c: s)
    jobs, errors = [], {}
    # scrape every (site, country) in parallel so one slow/blocked board doesn't sink the rest
    ex = ThreadPoolExecutor(max_workers=min(16, max(1, len(tasks))))
    futures = {ex.submit(scrape_site, s, c, params): (s, c) for s, c in tasks}
    done, pending = wait(futures, timeout=SCRAPE_BUDGET)
    for f in done:
        try:
            jobs.extend(f.result())
        except Exception as e:  # noqa: BLE001 - report per-site failure to the UI
            errors[label(*futures[f])] = str(e)[:300]
    for f in pending:
        errors[label(*futures[f])] = "timed out"
    ex.shutdown(wait=False, cancel_futures=True)

    seen, unique = set(), []
    for j in jobs:
        key = ((j.get("title") or "").lower(), (j.get("company") or "").lower(), j.get("country"))
        if key in seen:
            continue
        seen.add(key)
        unique.append(j)
    enrich_dates(unique)
    return jsonify(jobs=unique, count=len(unique), errors=errors, skipped=skipped, countries=countries)


if __name__ == "__main__":
    # local dev: python api/search.py, then use `npm run dev`
    app.run(port=5056)
