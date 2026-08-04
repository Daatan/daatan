-- daatan#1233: one row per resolved binary, frozen at resolution time, so
-- system calibration stops being an ad-hoc research query.
--
-- Additive: a new table, no change to any existing one. Written after the
-- resolution transaction commits, so a defect here can never roll back a
-- resolution.
--
-- Nothing derived is stored — Brier, log score and calibration bins all follow
-- from p_final + outcome. What is stored is what cannot be recovered later: the
-- published numbers as of specific instants, which the glide keeps overwriting.
CREATE TABLE "calibration_records" (
    "id" TEXT NOT NULL,
    "predictionId" TEXT NOT NULL,
    "outcome" VARCHAR(16) NOT NULL,
    "resolved_at" TIMESTAMP(3) NOT NULL,
    "p_final" INTEGER,
    "p_final_at" TIMESTAMP(3),
    "p_final_kind" VARCHAR(32),
    "p_final_origin" VARCHAR(32),
    "ci_low" DOUBLE PRECISION,
    "ci_high" DOUBLE PRECISION,
    "settled_at_final" BOOLEAN,
    "p_7d" INTEGER,
    "p_7d_at" TIMESTAMP(3),
    "p_30d" INTEGER,
    "p_30d_at" TIMESTAMP(3),
    "clock_snapshots" INTEGER NOT NULL DEFAULT 0,
    "evidence_snapshots" INTEGER NOT NULL DEFAULT 0,
    "disputed" BOOLEAN NOT NULL DEFAULT false,
    "dispute_note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calibration_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "calibration_records_predictionId_key" ON "calibration_records"("predictionId");
CREATE INDEX "calibration_records_resolved_at_idx" ON "calibration_records"("resolved_at");

ALTER TABLE "calibration_records" ADD CONSTRAINT "calibration_records_predictionId_fkey"
    FOREIGN KEY ("predictionId") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
