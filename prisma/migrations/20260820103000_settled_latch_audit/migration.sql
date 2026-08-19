-- Audit trail for the settled latch, plus fire/re-arm state for the unlatched-pin
-- sweep (daatan#1498).
--
-- `clearSettledLatch` erased its own tracks: it nulled `settled_at` along with the
-- flag, so a forecast that was latched and then cleared became indistinguishable
-- from one that never latched at all. That ambiguity is exactly what stalled the
-- #1498 root-cause investigation twice — 24 predictions carry 1,036 settlement-
-- asserting snapshots with the latch unset, and nothing on the row says whether the
-- latch ever fired. From here the clear records itself.
ALTER TABLE "predictions" ADD COLUMN "settled_cleared_at" TIMESTAMP(3);
ALTER TABLE "predictions" ADD COLUMN "settled_cleared_by" TEXT;

-- Same idiom as settled_drift_alert_at (#1490): set when the latest evidence
-- snapshot asserts settlement while the latch is false, cleared once the evidence
-- stops asserting it (or the latch catches up), so a recurrence pages again.
ALTER TABLE "predictions" ADD COLUMN "unlatched_pin_alert_at" TIMESTAMP(3);
