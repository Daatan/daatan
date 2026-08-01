-- daatan#1201: the default feed (status='ACTIVE', isPublic=true, order by
-- createdAt/updatedAt desc) had no composite index, so it scanned the
-- single-column status/isPublic indexes separately. sortBy=updated is a
-- real UI option (FeedClient sort dropdown), not a rare path, so it gets
-- its own index rather than relying on the createdAt one.

CREATE INDEX "predictions_status_isPublic_createdAt_idx" ON "predictions"("status", "isPublic", "createdAt");
CREATE INDEX "predictions_status_isPublic_updatedAt_idx" ON "predictions"("status", "isPublic", "updatedAt");
