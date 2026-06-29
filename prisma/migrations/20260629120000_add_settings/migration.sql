-- Admin-editable runtime configuration for the self-hosted edition. A row
-- overrides the matching .env value; with no rows the env/default is used, so
-- the SaaS deploy (which never writes rows) is byte-identical. Additive table —
-- no existing tables are touched.
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);
