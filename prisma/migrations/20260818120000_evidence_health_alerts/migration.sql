-- Fire/re-arm state for the evidence-health digest (daatan#1478).
--
-- One row per condition that is CURRENTLY firing, keyed by a stable string
-- ("evidence-health:source-silent:bbc.co.uk"). The digest claims a condition by
-- inserting its key — only the run that wins the insert notifies, so overlapping
-- cron runs can't double-fire — and deletes the keys whose condition no longer
-- holds, which is what re-arms them.
--
-- Why this needs a table rather than telegram.ts's in-memory canNotify(): these
-- conditions persist for days or weeks, and an in-memory cooldown resets on every
-- deploy, so a source that has been silent since last Tuesday would re-page after
-- each release. The same idiom as prediction.market_divergence_alert_at, moved off
-- the row because a source/overall condition has no row of its own to hang off.

CREATE TABLE "evidence_health_alerts" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_health_alerts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evidence_health_alerts_key_key" ON "evidence_health_alerts"("key");
