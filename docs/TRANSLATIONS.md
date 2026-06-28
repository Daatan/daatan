# Forecast translations & English canonicalization

Locales: `en` (default), `he`, `ru`, `eo` (`src/i18n/config.ts`). **English is the
canonical source language** — every forecast's stored `claimText` / `detailsText` /
`resolutionRules` are English, and the non-default locales are derived from them.

## Translation cache

`PredictionTranslation` (`prediction_translations`) caches one row per
`(predictionId, fieldName, language)`. `sourceHash` is the SHA-256 of the English
source the translation was produced from; a row is a cache hit only when it matches
the *current* source, so an edited field re-translates instead of serving a stale
translation (`src/lib/services/translation.ts`).

- **On create** (`POST /api/forecasts`): `translatePredictionToAllLocales` fans out
  to the non-default locales in the background (best-effort, retried).
- **On read**: locale pages call `getCachedPredictionTranslation` — read-only, never
  triggers Gemini. A cache miss falls back to the English source.

## English canonicalization (non-English input)

Forecasts can be authored in any language, but the default UI and the URL slug must
be English. `normalizeForecastToEnglish` runs inside `createForecast` **before** the
slug is generated:

1. Pure-Latin input → assumed English, returned unchanged (no LLM call). *Latin-script
   non-English (fr/de/es) is a known gap — only non-Latin scripts trigger detection.*
2. Non-Latin input → one Gemini call detects the source language and translates each
   field to English. The English text becomes canonical (and the slug + embedding are
   built from it); `predictions.original_language` records the detected language.
3. The author's **original wording is preserved** as a `PredictionTranslation` for its
   own language (hashed to the English source, so it's served as that locale's text and
   never re-translated back).
4. Any detection/translation failure falls back to storing the original unchanged, so
   forecast creation never breaks. `original_language` stays NULL (re-processable).

Bot-authored forecasts are English by construction and bypass this path.

## Editing in the original language

A non-English author edits in **their own language**, never the English canonical:

- The `GET /api/forecasts/[id]` response includes an `original` object (the original-language
  `claimText`/`detailsText`/`resolutionRules`) whenever `originalLanguage` is a non-`en`
  code. The edit form (`EditForecastClient`) pre-fills from `original` (RTL-aware) and shows
  an "editing in {language}" notice; the public *view* already renders per-locale.
- On save, `updateForecast` detects a non-English `originalLanguage` and, when the submitted
  claim is still non-English, re-derives the English canonical via `normalizeForecastToEnglish`,
  re-seeds the original-language translation with the author's exact text, and re-embeds — but
  **keeps the slug/URL stable** (unlike the create/backfill canonicalization, which sets the
  slug). Other locales re-translate lazily.
- If translation is unavailable, the save throws `ForecastTranslationUnavailableError` → the
  route returns **503** and the author retries; untranslated text is never stored as the
  English canonical.
- An author who rewrites the forecast *in English* (detected by `normalizeForecastToEnglish`)
  falls through to a plain direct update.

### Express create preview

The express flow generates the forecast in **English** (keeps tags/structure correct), then —
for non-Latin input — `localizeForecastForAuthor` translates the author-facing fields
(`claimText`/`detailsText`/`resolutionRules`/`options`) into the language the user typed in
(`detectScriptLanguage`), returned as a `localized` block on the result. `ExpressForecastClient`
shows/edits that localized text (`dir="auto"`, with a "reviewing in {language}" notice) and sends
it to `POST /api/forecasts`, where `createForecast` re-derives the English canonical and records
`originalLanguage`. Fail-open: any translation failure (or English input) leaves the preview in
English. So the author never sees English from typing to publish.

## Slug aliases

When a forecast is re-slugged (e.g. a non-English slug fixed during canonicalization),
the old slug is kept in `prediction_slug_aliases`. The forecast routes 308-redirect a
retired slug to the current canonical one (`getCanonicalSlugForAlias`), so old URLs and
their SEO are preserved. See [SEO.md](./SEO.md).

## Backfill

`scripts/backfill-english-canonical.ts` canonicalizes existing non-Latin forecasts
(idempotent — only touches rows with `original_language IS NULL`). Dry-run by default;
pass `--apply` to write. Requires `GEMINI_API_KEY` + `DATABASE_URL`. For prod, drive it
via the `backfill-english-canonical` admin endpoint / GitHub Actions workflow rather
than the script.

## Cross-language dedup

Because every stored `claimText` is English-canonical, the bot dedup gate
(`src/lib/services/bots/`) translates a non-English candidate title to English via
`normalizeTitleForDedup` before the keyword-Jaccard and LLM duplicate checks. Without
this, a Hebrew candidate and an English existing forecast share no keywords, so a
near-duplicate slips through and two overlapping forecasts get created. Pure-Latin
candidates skip the translation (no added cost); a translation failure falls back to the
original text (fail-open, same as the rest of the gate).
