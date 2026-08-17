-- CreateTable
CREATE TABLE "CoverPosition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "galleryId" TEXT NOT NULL,
    "notionPageId" TEXT NOT NULL,
    "posX" REAL NOT NULL DEFAULT 50,
    "posY" REAL NOT NULL DEFAULT 50,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CoverPosition_galleryId_notionPageId_key" ON "CoverPosition"("galleryId", "notionPageId");
