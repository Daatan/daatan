-- daatan#1659: sticky human dismissal from the Awaiting Resolution queue.
ALTER TABLE "predictions" ADD COLUMN "awaiting_dismissed_at" TIMESTAMP(3);
ALTER TABLE "predictions" ADD COLUMN "awaiting_dismissed_confidence" INTEGER;
