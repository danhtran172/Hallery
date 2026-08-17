-- CreateTable
CREATE TABLE "PageImageCache" (
    "notionPageId" TEXT NOT NULL PRIMARY KEY,
    "imageUrl" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "checkedAt" DATETIME NOT NULL
);
