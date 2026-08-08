#!/usr/bin/env python3
"""Weekly SEO report for daatan.com + elections.daatan.com (platform#13).

Pulls, per site: GSC search totals (last 7 full days vs the prior 7), tracked
election-keyword impressions (the "are we entering the keyword market at all"
tracker — baseline 2026-08-06 was zero), clicks by page section, sitemap
errors/warnings, and Yandex.Webmaster indexed-page counts + top queries.
Posts one message to the clean Telegram channel.

The GSC API cannot read the Page-indexing (coverage) report or its example
URLs — the 0-coverage-alerts goal still needs a periodic UI check; sitemap
errors/warnings below are the closest API-visible proxy.

CrUX (real-user Core Web Vitals) is deliberately absent: the API is disabled
in the GCP project (403) — see platform#13. Add a section once it's enabled.

Env: GSC_SA_KEY_FILE, YWM_OAUTH_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
Keyword list mirrors Daatan/docs seo.md (tiers 1-3) — sync manually when the
doc changes; the docs repo is private so this public workflow can't fetch it.
"""

import datetime as dt
import json
import os
import sys
import urllib.parse

import requests
from google.oauth2 import service_account
from googleapiclient.discovery import build

SITES = {
    "daatan.com": "https://daatan.com/",
    "elections.daatan.com": "https://elections.daatan.com/",
}

# Compact tracker list from Daatan/docs seo.md tiers 1-3 (normalized substring
# match against GSC query strings; Hebrew needs no case folding).
TRACKED_KEYWORDS = [
    "בחירות 2026", "בחירות בישראל", "הבחירות לכנסת", "תחזיות בחירות",
    "תחזית הבחירות", "מי ינצח בבחירות", "ראש הממשלה הבא", "ירכיב את הממשלה",
    "איזו מפלגה תנצח", "המפלגה הגדולה בבחירות", "תחזיות פוליטיות",
    "דירוג פרשנים", "מי מהפרשנים צדק", "מי חזה נכון", "תחזיות של פרשנים",
    "השוואת תחזיות", "רקורד תחזיות", "דיוק תחזיות", "דירוג כלי תקשורת",
    "האם נתניהו", "האם ביבי", "האם הליכוד", "כמה מנדטים", "אחוז החסימה",
    "ממשלת אחדות", "israel election forecast", "israeli election 2026",
    "election forecast 2026",
]

SECTIONS = {
    "daatan.com": ["/forecasts/", "/tags/", "/profile/", "/leaderboard"],
    "elections.daatan.com": ["/forecast/", "/source/", "/digest/", "/pundits"],
}


def gsc_service():
    creds = service_account.Credentials.from_service_account_file(
        os.environ["GSC_SA_KEY_FILE"],
        scopes=["https://www.googleapis.com/auth/webmasters.readonly"],
    )
    return build("searchconsole", "v1", credentials=creds, cache_discovery=False)


def gsc_query(svc, site, start, end, dimensions=None, row_limit=5000):
    body = {"startDate": start.isoformat(), "endDate": end.isoformat(), "rowLimit": row_limit}
    if dimensions:
        body["dimensions"] = dimensions
    resp = svc.searchanalytics().query(siteUrl=site, body=body).execute()
    return resp.get("rows", [])


def gsc_site_block(svc, host, site):
    today = dt.date.today()
    end = today - dt.timedelta(days=2)  # GSC data lags ~2 days
    start = end - dt.timedelta(days=6)
    prev_end = start - dt.timedelta(days=1)
    prev_start = prev_end - dt.timedelta(days=6)

    def totals(s, e):
        rows = gsc_query(svc, site, s, e)
        if not rows:
            return {"clicks": 0, "impressions": 0, "position": 0.0}
        r = rows[0]
        return {"clicks": int(r["clicks"]), "impressions": int(r["impressions"]), "position": r["position"]}

    cur, prev = totals(start, end), totals(prev_start, prev_end)

    kw_rows = gsc_query(svc, site, start, end, ["query"])
    kw_hits = [
        (r["keys"][0], int(r["impressions"]), r["position"])
        for r in kw_rows
        if any(k in r["keys"][0] for k in TRACKED_KEYWORDS)
    ]
    kw_hits.sort(key=lambda x: -x[1])

    page_rows = gsc_query(svc, site, start, end, ["page"])
    by_section = {}
    for r in page_rows:
        path = urllib.parse.urlparse(r["keys"][0]).path or "/"
        label = next((s for s in SECTIONS[host] if path.startswith(s) or path.lstrip("/he").lstrip("/ru").startswith(s)), "other/home")
        b = by_section.setdefault(label, {"clicks": 0, "impressions": 0})
        b["clicks"] += int(r["clicks"])
        b["impressions"] += int(r["impressions"])

    sitemap_issues = 0
    try:
        for sm in svc.sitemaps().list(siteUrl=site).execute().get("sitemap", []):
            sitemap_issues += int(sm.get("errors", 0)) + int(sm.get("warnings", 0))
    except Exception:
        sitemap_issues = -1  # listing failed; surface as "?"

    def delta(c, p):
        return f"{c} ({'+' if c - p >= 0 else ''}{c - p})"

    lines = [f"<b>{host}</b> (GSC, {start:%d.%m}–{end:%d.%m} vs prior 7d)"]
    lines.append(
        f"  clicks {delta(cur['clicks'], prev['clicks'])} · impressions {delta(cur['impressions'], prev['impressions'])}"
        f" · avg pos {cur['position']:.1f}"
    )
    if kw_hits:
        lines.append(f"  🎯 tracked election keywords: {sum(h[1] for h in kw_hits)} impressions across {len(kw_hits)} queries")
        for q, imp, pos in kw_hits[:3]:
            lines.append(f"    „{q}” — {imp} imp, pos {pos:.0f}")
    else:
        lines.append("  🎯 tracked election keywords: 0 impressions (baseline unchanged)")
    if by_section:
        sect = " · ".join(f"{k} {v['clicks']}c/{v['impressions']}i" for k, v in sorted(by_section.items(), key=lambda kv: -kv[1]["impressions"]))
        lines.append(f"  sections: {sect}")
    lines.append(f"  sitemap errors+warnings: {'?' if sitemap_issues < 0 else sitemap_issues}")
    return "\n".join(lines)


def ywm_block():
    tok = os.environ.get("YWM_OAUTH_TOKEN")
    if not tok:
        return "Yandex: token not configured"
    h = {"Authorization": f"OAuth {tok}"}
    api = "https://api.webmaster.yandex.net/v4"
    try:
        uid = requests.get(f"{api}/user", headers=h, timeout=30).json()["user_id"]
        hosts = requests.get(f"{api}/user/{uid}/hosts", headers=h, timeout=30).json().get("hosts", [])
        lines = ["<b>Yandex</b>"]
        for host in hosts:
            hid, name = host["host_id"], host.get("unicode_host_url", host["host_id"])
            # YWM registers http:// and https:// as separate hosts; the http
            # variants exist but are empty — only report the https ones.
            if "daatan" not in name or name.startswith("http://"):
                continue
            summ = requests.get(f"{api}/user/{uid}/hosts/{hid}/summary", headers=h, timeout=30).json()
            lines.append(
                f"  {name.replace('https://', '')}: indexed {summ.get('searchable_pages_count', '?')}"
                f" · SQI {summ.get('sqi', '?')}"
            )
        return "\n".join(lines)
    except Exception as e:  # report must never fail on the YWM half alone
        return f"Yandex: API error ({type(e).__name__})"


def main():
    svc = gsc_service()
    blocks = ["📈 <b>Weekly SEO report</b>"]
    for host, site in SITES.items():
        try:
            blocks.append(gsc_site_block(svc, host, site))
        except Exception as e:
            blocks.append(f"<b>{host}</b>: GSC error ({type(e).__name__}: {e})")
    blocks.append(ywm_block())
    blocks.append("<i>Coverage-alert counts aren't in the API — check the GSC UI. Keywords tracked per docs/seo.md.</i>")
    text = "\n\n".join(blocks)

    r = requests.post(
        f"https://api.telegram.org/bot{os.environ['TELEGRAM_BOT_TOKEN']}/sendMessage",
        data={"chat_id": os.environ["TELEGRAM_CHAT_ID"], "text": text, "parse_mode": "HTML", "disable_web_page_preview": "true"},
        timeout=30,
    )
    print(json.dumps({"telegram_status": r.status_code, "ok": r.json().get("ok")}))
    if not r.json().get("ok"):
        print(r.text, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
