-- daatan#1814: short card headline, generated from claimText. Nullable: null = card shows claimText.
ALTER TABLE "predictions" ADD COLUMN "headline" VARCHAR(80);
