"""Fetch Wikidata facts and Wikipedia leads for the outlets in outlets.json (daatan#2345).

Usage: python3 -I collect.py outlets.json curation.json raw.json
Reads public Wikimedia APIs only; writes raw.json for build.py. See docs/OUTLET_PROFILES.md.
"""
import json, sys, time, urllib.error, urllib.parse, urllib.request
UA = {"User-Agent": "logo-lookup-script/1.0 (low volume, sequential)"}
LANGS = ["en", "he", "ru", "eo"]
PROPS = {"P571": "founded", "P17": "country", "P159": "headquarters", "P407": "language", "P127": "owner"}
outlets_path, curation_path, out_path = sys.argv[1:4]

def get(url, tries=6):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            if e.code != 429 or i == tries - 1:
                raise
            time.sleep(min(int(e.headers.get("Retry-After") or 0) or 10 * (i + 1), 90))
        except urllib.error.URLError:
            if i == tries - 1:
                raise
            time.sleep(10 * (i + 1))

def wbget(ids, props):
    out = {}
    for i in range(0, len(ids), 50):
        r = get("https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=" + props
                + "&languages=" + "|".join(LANGS) + "&ids=" + "|".join(ids[i:i + 50]))
        out.update(r["entities"])
        time.sleep(2)
    return out

def current(statements):
    """Statements that still hold: not deprecated, no end time; preferred ones win when present."""
    live = [s for s in statements if s.get("rank") != "deprecated" and "P582" not in s.get("qualifiers", {})
            and s["mainsnak"].get("snaktype") == "value"]
    preferred = [s for s in live if s.get("rank") == "preferred"]
    return preferred or live

qid_of = json.load(open(outlets_path, encoding="utf-8"))
board = list(qid_of)
items = wbget(sorted({q for q in qid_of.values() if q}), "claims|sitelinks|labels|descriptions")

value_ids, raw = set(), {}
for dom in board:
    q = qid_of[dom]
    rec = {"qid": q, "facts": {}, "sitelinks": {}, "instance_of": []}
    if q:
        e = items[q]
        claims = e.get("claims", {})
        rec["instance_of"] = [s["mainsnak"]["datavalue"]["value"]["id"] for s in current(claims.get("P31", []))]
        value_ids.update(rec["instance_of"])
        for p, name in PROPS.items():
            vals = []
            for s in current(claims.get(p, [])):
                v = s["mainsnak"]["datavalue"]["value"]
                if p == "P571":
                    vals.append({"time": v["time"], "precision": v["precision"]})
                else:
                    vals.append(v["id"]); value_ids.add(v["id"])
            if vals:
                rec["facts"][name] = vals
        for lang in LANGS:
            sl = e.get("sitelinks", {}).get(f"{lang}wiki")
            if sl:
                rec["sitelinks"][lang] = sl["title"]
    raw[dom] = rec

# Values curation.json adds by hand need labels too.
value_ids.update(a["qid"] for a in json.load(open(curation_path, encoding="utf-8"))["add"] if "qid" in a)
labels = wbget(sorted(value_ids), "labels")
for dom, rec in raw.items():
    rec["extracts"] = {}
    for lang, title in rec["sitelinks"].items():
        s = get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/" + urllib.parse.quote(title.replace(" ", "_"), safe=""))
        time.sleep(1)
        if s and s.get("type") == "standard" and s.get("extract"):
            rec["extracts"][lang] = {"text": s["extract"], "url": s["content_urls"]["desktop"]["page"],
                                     "title": s["title"], "requested": title, "revision": s.get("revision"),
                                     "wikibase_item": s.get("wikibase_item")}
    print(dom, rec["qid"], sorted(rec["facts"]), sorted(rec["extracts"]), file=sys.stderr)
    json.dump({"outlets": raw, "labels": {k: {l: v["value"] for l, v in e.get("labels", {}).items()} for k, e in labels.items()}},
              open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
