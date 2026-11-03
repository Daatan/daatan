-- Who reverted a resolution and why (daatan#2077). The reverted snapshot row is the audit record.
ALTER TABLE "resolution_snapshots" ADD COLUMN "reverted_by_id" TEXT;
ALTER TABLE "resolution_snapshots" ADD COLUMN "revert_reason" TEXT;
