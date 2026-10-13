-- daatan#1854: single-shot dedup for the "approaching deadline" heads-up. Nullable: null = never alerted.
ALTER TABLE "predictions" ADD COLUMN "deadline_heads_up_alert_at" TIMESTAMP(3);
