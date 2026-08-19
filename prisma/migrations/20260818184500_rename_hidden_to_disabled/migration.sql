-- Renamed rather than dropped and re-added so any property already switched off stays off.
ALTER TABLE "PropertyConfig" RENAME COLUMN "hidden" TO "disabled";
