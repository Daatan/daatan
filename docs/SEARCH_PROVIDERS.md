# Search Providers

## Local summary (daatan app side)

- The app calls the Oracle `/forecast` endpoint with `max_articles = DEFAULT_MAX_ARTICLES = 15` (see `src/lib/services/oracle.ts`).
- The provider fallback chain (news-indexer → external search providers) is owned by the Oracle and news-indexer, not by daatan.
- Cross-language query handling is done server-side (Oracle `/search` distill retry + news-indexer English-pivot translation), so the daatan app does **not** re-translate queries.
- The external `Daatan/docs/search-providers.md` remains the canonical deep reference for the full provider chain and ranking details.

> **Deep reference.** The full, canonical document lives in the shared docs repo:
> https://github.com/Daatan/docs/blob/main/search-providers.md
