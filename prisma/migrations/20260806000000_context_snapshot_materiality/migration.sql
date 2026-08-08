-- F17 (daatan#1236): let the glide clock's anchor selection tell a genuinely
-- new estimate apart from a same-probability write that only recomputed an
-- unchanged pool (e.g. a push whose only article was gatekeeper-rejected).
-- material_change defaults true so every existing row stays anchor-eligible
-- exactly as before this migration -- no backfill, no behavior change for
-- historical data. evidence_at is nullable and populated only going forward;
-- readers fall back to created_at when it's null.

ALTER TABLE "context_snapshots" ADD COLUMN "material_change" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "context_snapshots" ADD COLUMN "evidence_at" TIMESTAMP(3);
