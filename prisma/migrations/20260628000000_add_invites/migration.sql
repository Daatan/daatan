-- Single-use signup invites for the self-hosted edition. `token` holds the
-- SHA-256 hex of the raw token (never the raw value); a consumed invite has a
-- non-null "acceptedAt". Additive table — no existing tables are touched.
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),

    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "invites_token_key" ON "invites"("token");
