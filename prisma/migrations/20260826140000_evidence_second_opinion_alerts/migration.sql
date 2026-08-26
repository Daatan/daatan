CREATE TABLE "evidence_second_opinion_alerts" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evidence_second_opinion_alerts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "evidence_second_opinion_alerts_key_key" ON "evidence_second_opinion_alerts"("key");
