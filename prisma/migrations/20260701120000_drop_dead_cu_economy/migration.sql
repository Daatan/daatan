-- Remove the abandoned CU-staking economy. Every object dropped here is
-- unreferenced by application code (the code references were removed in the
-- prior PR): user balances were never spent/locked/burned, the CU ledger was
-- write-only with no reader or UI, and the exit-penalty withdrawals table had
-- no reader or writer. The confidence value (commitments."cuCommitted") and the
-- bot stake config are intentionally KEPT — they are still live.

-- DropTable (CU ledger — write-only, never read)
DROP TABLE IF EXISTS "cu_transactions";

-- DropTable (exit-penalty withdrawals — no reader or writer)
DROP TABLE IF EXISTS "commitment_withdrawals";

-- DropEnum (only referenced by the dropped cu_transactions table)
DROP TYPE IF EXISTS "CuTransactionType";

-- DropIndex (leaderboard aggregation over a never-written column;
-- also dropped implicitly by the column drop below)
DROP INDEX IF EXISTS "commitments_userId_cuReturned_idx";

-- AlterTable (never-written resolution payout column)
ALTER TABLE "commitments" DROP COLUMN "cuReturned";

-- AlterTable (unused user balance fields — never surfaced to end users)
ALTER TABLE "users" DROP COLUMN "cuAvailable";
ALTER TABLE "users" DROP COLUMN "cuLocked";
