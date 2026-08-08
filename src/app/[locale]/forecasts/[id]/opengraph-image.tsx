// Next.js resolves the file-convention OG image per route-segment subtree, so
// [locale]/forecasts/[id] doesn't inherit the non-locale route's dynamic
// per-forecast image — it needs its own file. The generator itself has no
// locale-specific text (labels are fixed English by design, matching the
// non-locale card), so this reuses it directly rather than duplicating it.
export { default, alt, size, contentType } from '@/app/forecasts/[id]/opengraph-image'
