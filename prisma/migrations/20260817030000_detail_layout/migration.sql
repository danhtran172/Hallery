-- Card Detail layout belongs to Hallery's shadow schema. An empty value preserves
-- the existing vertical detail view until a user explicitly creates a layout.
ALTER TABLE "Gallery" ADD COLUMN "detailLayout" TEXT NOT NULL DEFAULT '';
