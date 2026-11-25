# Outlet logos

The `/sources/<name>` header shows an outlet's logo on a light plate when one is bundled, and the
letter avatar otherwise (daatan#2341). The same file is the `logo` of the page's `Organization`
JSON-LD (see [SEO.md](./SEO.md), "Source pages").

- Files: `public/outlet-logos/<key>.png`, where `<key>` is the canonical outlet name
  (`canonicalOutlet` in `src/lib/services/sourceLeaderboard.ts`), so alias domains such as
  `ynetnews.com` show their sibling's logo.
- Map: `OUTLET_LOGOS` in `src/lib/utils/outlet-logos.ts`, one entry per file with its pixel size.
  `src/lib/utils/__tests__/outlet-logos.test.ts` fails on a file without an entry, an entry
  without a file, or a size that doesn't match the PNG.

## Rules

- **Bundled, never hotlinked.** A third-party image URL would hand that site every reader's IP.
- **Source: the outlet's Wikidata item, logo property (P154)**, which points at a Wikimedia
  Commons file. Commons accepts only free content; record the file's licence tag below. A
  logo that isn't on Commons isn't added.
- **PNG only.** For an SVG original, take the PNG rendering Commons serves (`imageinfo` with
  `iiurlwidth`), never the SVG itself: an SVG served from our origin can carry script.
- Logos are trademarks even when the artwork is public domain. Showing one on the page about
  that outlet is identification. To remove one, delete the file and its map entry.

## Files

Downloaded 2026-11-26 from Commons PNG renderings.

| File | Wikidata | Commons file | Licence | Pixels |
|---|---|---|---|---|
| `aa.com.tr.png` | [Q477436](https://www.wikidata.org/wiki/Q477436) | [Anadolu Agency logo 2023 (2).svg](https://commons.wikimedia.org/wiki/File:Anadolu_Agency_logo_2023_(2).svg) | Public domain, trademarked | 960×1018 |
| `aljazeera.net.png` | [Q13477](https://www.wikidata.org/wiki/Q13477) | [Aljazeera eng.svg](https://commons.wikimedia.org/wiki/File:Aljazeera_eng.svg) | Public domain | 960×325 |
| `bbc.com.png` | [Q1160945](https://www.wikidata.org/wiki/Q1160945) | [BBC News 2022 (Alt 2).svg](https://commons.wikimedia.org/wiki/File:BBC_News_2022_(Alt_2).svg) | Public domain, trademarked | 960×615 |
| `cnbc.com.png` | [Q1023912](https://www.wikidata.org/wiki/Q1023912) | [CNBC 2025.svg](https://commons.wikimedia.org/wiki/File:CNBC_2025.svg) | Public domain, trademarked | 960×307 |
| `finance.yahoo.com.png` | [Q4053432](https://www.wikidata.org/wiki/Q4053432) | [Yahoo! Finance logo 2021.png](https://commons.wikimedia.org/wiki/File:Yahoo!_Finance_logo_2021.png) | Public domain, trademarked | 960×352 |
| `foreignpolicy.com.png` | [Q1063573](https://www.wikidata.org/wiki/Q1063573) | [Foreign Policy logo 2014 light bg.svg](https://commons.wikimedia.org/wiki/File:Foreign_Policy_logo_2014_light_bg.svg) | Public domain, trademarked | 960×608 |
| `fortune.com.png` | [Q372989](https://www.wikidata.org/wiki/Q372989) | [Fortune magazine logo 2016.svg](https://commons.wikimedia.org/wiki/File:Fortune_magazine_logo_2016.svg) | Public domain, trademarked | 960×221 |
| `jns.org.png` | [Q105144065](https://www.wikidata.org/wiki/Q105144065) | [JNS logo banner.png](https://commons.wikimedia.org/wiki/File:JNS_logo_banner.png) | Public domain, trademarked | 288×90 |
| `jpost.com.png` | [Q35438](https://www.wikidata.org/wiki/Q35438) | [Jerusalem Post Logo.svg](https://commons.wikimedia.org/wiki/File:Jerusalem_Post_Logo.svg) | Public domain, trademarked | 960×146 |
| `kikar.co.il.png` | [Q6262613](https://www.wikidata.org/wiki/Q6262613) | [Kikar HaShabbat logo 2022.svg](https://commons.wikimedia.org/wiki/File:Kikar_HaShabbat_logo_2022.svg) | Public domain, trademarked | 960×919 |
| `kyivpost.com.png` | [Q1795015](https://www.wikidata.org/wiki/Q1795015) | [Kyiv Post logo (2022).svg](https://commons.wikimedia.org/wiki/File:Kyiv_Post_logo_(2022).svg) | Public domain, trademarked | 960×143 |
| `lemonde.fr.png` | [Q12461](https://www.wikidata.org/wiki/Q12461) | [Le Monde.svg](https://commons.wikimedia.org/wiki/File:Le_Monde.svg) | Public domain, trademarked | 960×222 |
| `meduza.io.png` | [Q18340732](https://www.wikidata.org/wiki/Q18340732) | [Meduza logo.svg](https://commons.wikimedia.org/wiki/File:Meduza_logo.svg) | Public domain, trademarked | 960×202 |
| `pravda.com.ua.png` | [Q904463](https://www.wikidata.org/wiki/Q904463) | [Ukrainska Pravda EN logo.svg](https://commons.wikimedia.org/wiki/File:Ukrainska_Pravda_EN_logo.svg) | Public domain, trademarked | 960×131 |
| `tehrantimes.com.png` | [Q2708943](https://www.wikidata.org/wiki/Q2708943) | [TehranTimes.svg](https://commons.wikimedia.org/wiki/File:TehranTimes.svg) | Public domain, trademarked | 960×102 |
| `theguardian.com.png` | [Q11148](https://www.wikidata.org/wiki/Q11148) | [The Guardian 2018.svg](https://commons.wikimedia.org/wiki/File:The_Guardian_2018.svg) | Public domain, trademarked | 960×316 |
| `thehill.com.png` | [Q7739683](https://www.wikidata.org/wiki/Q7739683) | [The Hill logo (blue horizontal).svg](https://commons.wikimedia.org/wiki/File:The_Hill_logo_(blue_horizontal).svg) | Public domain, trademarked | 960×136 |
| `timesofindia.indiatimes.com.png` | [Q46807](https://www.wikidata.org/wiki/Q46807) | [The times of india.svg](https://commons.wikimedia.org/wiki/File:The_times_of_india.svg) | Public domain, trademarked | 960×68 |
| `ynet.co.il.png` | [Q2738307](https://www.wikidata.org/wiki/Q2738307) | [Ynet website logo.svg](https://commons.wikimedia.org/wiki/File:Ynet_website_logo.svg) | Public domain, trademarked | 960×413 |

No logo on Wikidata, so the letter avatar stays: al-monitor.com, gatestoneinstitute.org,
hnaftali.com, independent.co.uk, middleeasteye.net, newsletter.amitsegal.net, oilprice.com,
srugim.co.il.
