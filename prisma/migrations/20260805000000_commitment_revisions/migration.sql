-- Append-only history of a commitment's mutable fields (daatan#1281).
-- updateCommitment snapshots the row inside the same transaction BEFORE each
-- UPDATE; an in-place UPDATE otherwise destroys the prior (side, stake, RS)
-- irrecoverably. No backfill — history that predates this table was never
-- recorded and must not be fabricated.

CREATE TABLE "commitment_revisions" (
    "id" TEXT NOT NULL,
    "commitment_id" TEXT NOT NULL,
    "option_id" TEXT,
    "binary_choice" BOOLEAN,
    "cu_committed" INTEGER NOT NULL,
    "probability" DOUBLE PRECISION,
    "rs_snapshot" DOUBLE PRECISION NOT NULL,
    "superseded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commitment_revisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "commitment_revisions_commitment_id_superseded_at_idx" ON "commitment_revisions"("commitment_id", "superseded_at");

ALTER TABLE "commitment_revisions" ADD CONSTRAINT "commitment_revisions_commitment_id_fkey" FOREIGN KEY ("commitment_id") REFERENCES "commitments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
