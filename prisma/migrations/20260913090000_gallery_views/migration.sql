-- Persistent views own gallery query state and card layout. Existing galleries keep
-- their current appearance by receiving one default view backed by displayConfig.
CREATE TABLE "GalleryView" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "galleryId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "filterConfig" TEXT NOT NULL DEFAULT '[]',
    "sortConfig" TEXT NOT NULL DEFAULT '[]',
    "groupBy" TEXT,
    "layoutConfig" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GalleryView_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "GalleryView_galleryId_sortOrder_idx" ON "GalleryView"("galleryId", "sortOrder");

INSERT INTO "GalleryView" ("id", "galleryId", "name", "sortOrder", "layoutConfig", "createdAt", "updatedAt")
SELECT lower(hex(randomblob(16))), "id", 'Mặc định', 0, "displayConfig", "createdAt", "updatedAt"
FROM "Gallery";
