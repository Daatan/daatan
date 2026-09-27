# Per-tag rating materialization

Status: **implemented** (v1.10.207, PR #870, 2026-06-12).

## Problem

The leaderboard computed ELO and Glicko-2 ratings two ways:

- **Global (no tag):** read the stored `User.eloRating` / `User.mu` / `User.sigma`
  columns, which are updated incrementally at resolution time.
- **Per-tag:** `replayEloHistory(tagSlug)` and `replayGlicko2History(tagSlug)`
  re-derived ratings **from scratch** by replaying every resolved commitment for
  that tag in chronological order, on **every leaderboard request**.

Per-tag replay is `O(resolved commitments in the tag)` per request. Option A
(materialized table) was chosen and implemented.

## What was implemented

### Schema

```prisma
model UserTagRating {
  id         String   @id @default(cuid())
  userId     String
  tagId      String
  elo        Float    @default(1500)
  mu         Float    @default(1500)
  sigma      Float    @default(350)
  volatility Float    @default(0.06)
  updatedAt  DateTime @updatedAt

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@unique([userId, tagId])
  @@index([tagId])
  @@map("user_tag_ratings")
}
```

Migration: `prisma/migrations/20260612000000_add_user_tag_ratings/migration.sql`

### Read path

`getLeaderboard` in `leaderboard.ts`:
1. Resolves the tag slug to a `tagId` via `prisma.tag.findUnique`.
2. Calls `ensureTagRatingsSeeded(tagId, tagSlug)` — no-ops if rows exist for
   that tag; otherwise runs `replayEloHistory(tagSlug)` +
   `replayGlicko2History(tagSlug)` once and writes all user rows with
   `createMany({ skipDuplicates: true })`.
3. Reads the materialized rows with `prisma.userTagRating.findMany({ where: { tagId } })`.
4. Falls back to the global `User.eloRating` / `User.mu` / `User.sigma` for
   any user without a tag-rating row (should not occur after seeding, but safe).

### Write path

`updateTagRatingsInTx` in `tag-ratings.ts` is called from within the resolution
`$transaction` in `prediction-resolution.ts`, after the global ELO pairwise +
Glicko-2 updates. It:
- Loads the current `UserTagRating` rows for `(commitmentUsers × tags)`.
- Runs `calculateEloUpdates` with per-tag ELO baselines (not global).
- Runs `glicko2Update` with per-tag μ/σ/volatility baselines.
- Upserts all `(userId, tagId)` rows atomically within the transaction.

### Seeding strategy

Lazy: no migration-time backfill. On the first leaderboard request for a tag,
the table is empty → `ensureTagRatingsSeeded` seeds it. All subsequent requests
are O(1) reads. `skipDuplicates: true` handles concurrent double-seed races.

### Design decisions made

| Question | Decision |
|----------|----------|
| Recompute trigger | Synchronous, inside the resolution transaction |
| Backfill | Lazy (on first leaderboard request per tag) |
| Per-tag volatility | Stored separately in `UserTagRating.volatility` |
| Tags to update at resolution | All tags on the resolved prediction |

## Implementation files

| File | Role |
|------|------|
| `src/lib/services/tag-ratings.ts` | `ensureTagRatingsSeeded`, `updateTagRatingsInTx` (also `ensurePunditTagRatingsSeeded`, the `pundit_tag_ratings` variant — see [DATABASE.md](./DATABASE.md)) |
| `src/lib/services/leaderboard.ts` | Calls seed + reads `UserTagRating` |
| `src/lib/services/prediction-resolution.ts` | Calls `updateTagRatingsInTx` in resolution tx |
| `src/lib/services/__tests__/tag-ratings.test.ts` | 11 unit tests (3 cover the pundit variant) |
| `prisma/migrations/20260612000000_add_user_tag_ratings/` | SQL migration |

## What was deferred

- **`min 3 resolved` gate per tag** for ELO (ELO has no minimum threshold; only
  Glicko-2, ROI, and TruthScore do). `resolvedCount` was not added to
  `UserTagRating` — the existing commitment count queries handle the gate.
- **Admin "recalculate per-tag" endpoint** — `replayEloHistory(tag)` and
  `replayGlicko2History(tag)` still exist as the source of truth and can be
  wired to an admin action if drift is detected.
- **Invalidation on re-resolve** — if a prediction's outcome changes, the
  per-tag rows for affected tags will drift. Fix: add a re-run of
  `replayEloHistory`/`replayGlicko2History` to the re-resolution path (not yet
  built).

## References

- `src/lib/services/leaderboard.ts` — `getLeaderboard`
- `src/lib/services/elo.ts` — `replayEloHistory(tagSlug?)`
- `src/lib/services/expertise.ts` — `replayGlicko2History(tagSlug?)`
- `docs/SCORING_SYSTEMS.md`, `docs/EXPERTISE_RATING_SYSTEM.md`
