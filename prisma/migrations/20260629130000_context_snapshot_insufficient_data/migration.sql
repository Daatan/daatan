-- Mark a context snapshot as an abstention: the Oracle had no evidence bearing
-- on the claim, so no probability was produced. The UI shows "Insufficient
-- evidence" instead of an ungrounded number.
ALTER TABLE "context_snapshots" ADD COLUMN "insufficient_data" BOOLEAN NOT NULL DEFAULT false;
