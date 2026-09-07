-- AlterTable
ALTER TABLE "GalleryNotionCache" ADD COLUMN "freshUntil" DATETIME;
ALTER TABLE "GalleryNotionCache" ADD COLUMN "lastDeltaSyncAt" DATETIME;
ALTER TABLE "GalleryNotionCache" ADD COLUMN "lastFullReconcileAt" DATETIME;
ALTER TABLE "GalleryNotionCache" ADD COLUMN "lastSyncError" TEXT;
ALTER TABLE "GalleryNotionCache" ADD COLUMN "staleUntil" DATETIME;
