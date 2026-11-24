-- The account that actually created a forecast an admin published as Daatan (daatan#2301).
-- A table of its own rather than a predictions column: several public reads `include` a
-- Prediction and spread the whole row into an API response or page props, and a relation is
-- only ever returned when a query asks for it by name. Admin-only by construction.

-- CreateTable
CREATE TABLE "prediction_creators" (
    "predictionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prediction_creators_pkey" PRIMARY KEY ("predictionId")
);

-- CreateIndex
CREATE INDEX "prediction_creators_userId_idx" ON "prediction_creators"("userId");

-- AddForeignKey
ALTER TABLE "prediction_creators" ADD CONSTRAINT "prediction_creators_predictionId_fkey" FOREIGN KEY ("predictionId") REFERENCES "predictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prediction_creators" ADD CONSTRAINT "prediction_creators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
