-- Marks a shadow property that no longer exists in Notion without discarding its
-- saved layout/display metadata. It is never written back to Notion.
ALTER TABLE "PropertyConfig" ADD COLUMN "isMissing" BOOLEAN NOT NULL DEFAULT false;
