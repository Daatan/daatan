-- "Forget History" (daatan#1701): a user can detach from their own already-resolved
-- commitments without deleting them — the row, its scoring history, and every other
-- user's derived aggregates (pool totals, ELO/Glicko replays, leaderboards) stay
-- intact, but nothing on it traces back to the forgetting user afterward.
--
-- Commitment.userId only needs to become nullable for this; the FK stays
-- ON DELETE CASCADE, so account deletion behaves exactly as before.

ALTER TABLE "commitments" ALTER COLUMN "userId" DROP NOT NULL;
