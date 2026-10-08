# Resume Crawler

Score your resume, optionally fix it, then search job boards with either your uploaded or your updated resume, with every job ranked by how well it matches.

1. **Upload**: a PDF resume is parsed in the browser by the [OpenResume](https://github.com/xitanggg/open-resume) parser (8.9k★). Nothing about your resume leaves your machine.
2. **Score & improve (optional)**: an ATS-style checker scores the resume out of 100 across contact info, summary, experience, bullet quality, education, skills, and format. It lists recommendations, many with one-click fixes. You can edit everything inline and download the updated resume as **PDF**, **DOCX**, or JSON.
3. **Find jobs**: search LinkedIn, Indeed, ZipRecruiter, Glassdoor, and Google Jobs via [JobSpy](https://github.com/speedyapply/JobSpy) (4.4k★), using your **uploaded** or **updated** resume. The job title, location, and skill keywords come from the resume, and results are ranked by keyword and title match.

## Optimizer memory

The checker remembers what it has already handled, so it doesn't go around in circles:

- Bullets and summaries produced or reviewed by a fix are remembered. Later passes only look at **new or changed** text.
- One-time fixes (generate summary, add detected skills) never come back once applied, and **Ignore** hides a recommendation for good.
- The last updated version is saved in your browser (localStorage) for each resume. Re-uploading the same file restores it. **Reset** clears it.

## Development

```bash
npm install
pip install -r requirements.txt
python api/search.py      # API on :5056
npm run dev               # UI on http://localhost:3100 (proxies /api)
```

Deploys to Vercel as-is: static files are built into `public/`, and `api/search.py` runs as a Python function.

## Notes

- The parser works best with single-column, text-based (not scanned) English PDFs.
- Job boards rate-limit scrapers. Glassdoor and ZipRecruiter fail most often from cloud IPs, and per-site errors are shown in the UI.

## License

AGPL-3.0, inherited from the OpenResume parser in `src/lib/parse-resume-from-pdf`. JobSpy is MIT.
