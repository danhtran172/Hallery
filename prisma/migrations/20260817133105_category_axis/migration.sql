-- CreateTable
CREATE TABLE "CategoryAxis" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "galleryId" TEXT NOT NULL,
    "notionPropertyId" TEXT NOT NULL,
    "notionPropertyName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "displayLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CategoryAxis_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CategoryAxis_galleryId_notionPropertyId_key" ON "CategoryAxis"("galleryId", "notionPropertyId");
