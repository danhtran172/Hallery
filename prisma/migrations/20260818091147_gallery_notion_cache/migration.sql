-- CreateTable
CREATE TABLE "GalleryNotionCache" (
    "galleryId" TEXT NOT NULL PRIMARY KEY,
    "dataSourceJson" TEXT NOT NULL,
    "queryJson" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GalleryNotionCache_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
