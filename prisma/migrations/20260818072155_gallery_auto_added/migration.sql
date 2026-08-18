-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Gallery" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "notionDatabaseId" TEXT NOT NULL,
    "notionDataSourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "displayConfig" TEXT NOT NULL DEFAULT '{}',
    "detailLayout" TEXT NOT NULL DEFAULT '',
    "autoAdded" BOOLEAN NOT NULL DEFAULT false,
    "parentGalleryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Gallery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Gallery_parentGalleryId_fkey" FOREIGN KEY ("parentGalleryId") REFERENCES "Gallery" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Gallery" ("createdAt", "description", "detailLayout", "displayConfig", "icon", "id", "name", "notionDataSourceId", "notionDatabaseId", "parentGalleryId", "sortOrder", "updatedAt", "workspaceId") SELECT "createdAt", "description", "detailLayout", "displayConfig", "icon", "id", "name", "notionDataSourceId", "notionDatabaseId", "parentGalleryId", "sortOrder", "updatedAt", "workspaceId" FROM "Gallery";
DROP TABLE "Gallery";
ALTER TABLE "new_Gallery" RENAME TO "Gallery";
CREATE UNIQUE INDEX "Gallery_workspaceId_notionDataSourceId_key" ON "Gallery"("workspaceId", "notionDataSourceId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
