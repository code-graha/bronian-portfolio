# Bronian — Freelance Graphic Designer Portfolio

A static portfolio site for Bronian (Mohit), a freelance graphic designer. Content (projects, reviews, contact messages) is stored in a Google Sheet and served through a Google Apps Script web app — no traditional backend or database required.

Live site: https://bronian.webgraha.com

## Tech Stack

- **Frontend:** static HTML + [Tailwind CSS](https://tailwindcss.com) (CDN build) + vanilla JS
- **Data store:** Google Sheets, with tabs for `Projects`, `Reviews`, `Contacts`, and `Password`
- **Backend:** a single Google Apps Script deployment acting as a JSON API in front of the sheet
- **Content config:** [`portfolio-data.json`](portfolio-data.json) — copy, headline text, services, pricing, social links, and the Apps Script URL (`sheetURL`)

No build step, no npm dependencies, no server to run — open `index.html` or serve the folder with any static file server.

## File Structure

```
index.html                  Main portfolio page
review.html                 Public "leave a review" form (noindex)
admin.html                  Password-gated dashboard for projects/reviews/contacts (noindex)
404.html / 405.html         Error pages
script.js                   Loads portfolio-data.json + Sheet data, renders all dynamic sections
guard.js                    Disables right-click / devtools shortcuts (deterrent only, not real security)
styles.css                  Custom CSS on top of Tailwind utility classes
portfolio-data.json         All site copy + config (single source of truth for the Apps Script URL)
robots.txt / sitemap.xml    Standard crawler directives, incl. AI crawlers (GPTBot, PerplexityBot, etc.)
llms.txt                    Plain-text site summary for LLM/AI-search crawlers
favicon.ico                 Legacy favicon fallback
assets/brand/               Favicon (svg/png), apple-touch-icon, og-image — generated from the navbar "B" mark
assets/docs/
  google-apps-script-combined.gs   The Apps Script source (paste into Extensions > Apps Script)
```

## One-Time Setup

1. **Create a Google Sheet.** Any name works — the script auto-creates its own tabs.
2. **Open Extensions > Apps Script** from inside that sheet (this binds the script to it — no Sheet ID to configure).
3. Paste in the contents of [`assets/docs/google-apps-script-combined.gs`](assets/docs/google-apps-script-combined.gs).
4. **Deploy > New deployment > Web app**, execute as "Me", access "Anyone". Copy the resulting web app URL.
5. Paste that URL into `portfolio-data.json` under `"sheetURL"`. **This is the only place it needs to be set** — `index.html`'s early-fetch script and `script.js` both read it from here rather than hardcoding it, so there's a single source of truth.
6. The sheet's **Password** tab and a default login (`admin` / `admin123`) are created automatically the first time the script runs — nothing to set up before deploying. **Before sharing the deployment URL anywhere**, open the sheet and replace that row's password with your own value, base64-encoded (run `btoa("yourPassword")` in any browser console, or use an online base64 encoder). This is obfuscation, not encryption — anyone with edit access to the sheet can decode it back with `atob()` — but the tab is never exposed through any API route, so it's only as exposed as the sheet's own sharing settings.
7. Whenever you edit the `.gs` file, you must create a **new deployment** (not just save) for changes to take effect, since existing deployments are pinned to the code version they were created with.

## How Data Flows

- `portfolio-data.json` holds all static copy (hero text, services, pricing, process steps, social links) plus `sheetURL`.
- `script.js` fetches that file, renders the static sections immediately, then fetches `?type=projects` and `?type=reviews` from the Apps Script URL to render the work grid and testimonials.
- `index.html` kicks off those same Sheet requests slightly earlier (in `<head>`, before `script.js` even parses) purely as a perceived-performance optimization; `script.js` reuses that in-flight request instead of re-fetching.
- `review.html` posts new reviews directly to the Apps Script (`type: "reviews", action: "add"`) — public, no login required.
- `admin.html` is password-gated: login POSTs the password to the Apps Script (`type: "auth", action: "login"`), which base64-decodes the stored value in the `Password` tab and compares it, then returns a signed, time-limited session token. That token (not the password) is sent with every admin read/write (viewing contacts, moderating reviews, managing projects) and is re-validated server-side on each request. The signing secret lives in the script's own Properties (not the sheet), generated automatically on first login — nothing to set up there, and no spreadsheet round-trip on every request.
- Login itself skips the write lock used by project/review/contact submissions — it's a read-only credential check, so it doesn't queue behind an unrelated visitor submitting a review at the same moment.

## SEO / AI Search

- `robots.txt` explicitly allows major search and AI crawlers (Googlebot, Bingbot, GPTBot, PerplexityBot, Claude-Web, etc.) and disallows `/admin.html` and `/review.html`.
- `llms.txt` gives LLM-based crawlers a clean plain-text summary of services, process, and contact info.
- `index.html` carries canonical URL, Open Graph + Twitter Card tags (including `og-image.png`), and JSON-LD (`Person` with `sameAs` social links + `Offer`s matching the visible Services section).
- A `<noscript>` block in `index.html` gives non-JS crawlers static fallback content, since the real content is rendered client-side from `portfolio-data.json`.

## Known Trade-off

The site intentionally still loads Tailwind via the CDN `<script>` build rather than a precompiled stylesheet. That's the single biggest remaining Lighthouse performance flag, but fixing it means introducing a build step (Tailwind CLI + a generated CSS file) to what is otherwise a zero-tooling static site — a deliberate choice to keep "edit HTML, refresh" as the workflow.
