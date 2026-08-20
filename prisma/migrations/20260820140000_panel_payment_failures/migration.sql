-- Per-UTC-day counter of AI-panel OpenRouter 402 (payment) failures (daatan#1504).
--
-- Decision from daatan#1491 ask 2: OpenRouter credit exhaustion alerts through the
-- existing daily evidence-health digest, not a dedicated pager. The digest is
-- DB-driven while the 402s only surfaced in app logs, so the panel sweep now
-- upserts a row here per UTC day it sees a 402 (count + last occurrence + which
-- model saw it last), and checkEvidenceHealth() fires a digest line when any
-- fall inside its lookback window. Fire/re-arm dedup stays where it already
-- lives — the evidence_health_alerts table — under the key "panel-payment".
--
-- Reference incident: 2026-08-19 05:06-05:12Z, 572 x 402 = total panel outage,
-- found by a human 3h later.

CREATE TABLE "panel_payment_failures" (
    "day" VARCHAR(10) NOT NULL,
    "count" INTEGER NOT NULL,
    "last_seen_at" TIMESTAMP(3) NOT NULL,
    "last_model" VARCHAR(200) NOT NULL,

    CONSTRAINT "panel_payment_failures_pkey" PRIMARY KEY ("day")
);
