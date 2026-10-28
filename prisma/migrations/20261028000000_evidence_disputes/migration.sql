-- Public dispute state per article URL (elections#225). See EvidenceDispute in schema.prisma.
CREATE TABLE "evidence_disputes" (
    "id" TEXT NOT NULL,
    "url_hash" VARCHAR(64) NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "note" VARCHAR(1000),
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evidence_disputes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evidence_disputes_url_hash_key" ON "evidence_disputes"("url_hash");
CREATE INDEX "evidence_disputes_status_idx" ON "evidence_disputes"("status");

-- elections (elections.daatan.com) reads this table through the read-only `elections_ro`
-- role. Grant explicitly rather than rely on default privileges; skipped where the role
-- doesn't exist (dev, CI, fresh restores).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'elections_ro') THEN
    GRANT SELECT ON "evidence_disputes" TO elections_ro;
  END IF;
END
$$;
