-- Pre-resolution state, written inside the resolve transaction (daatan#2077). See
-- ResolutionSnapshot in schema.prisma. Several rows per prediction are expected:
-- resolve -> revert -> resolve writes a second one.
CREATE TABLE "resolution_snapshots" (
    "id" TEXT NOT NULL,
    "prediction_id" TEXT NOT NULL,
    "outcome" VARCHAR(50) NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL,
    "affected_user_ids" TEXT[],
    "payload" JSONB NOT NULL,
    "reverted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resolution_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "resolution_snapshots_prediction_id_resolved_at_idx" ON "resolution_snapshots"("prediction_id", "resolved_at");

ALTER TABLE "resolution_snapshots" ADD CONSTRAINT "resolution_snapshots_prediction_id_fkey" FOREIGN KEY ("prediction_id") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
