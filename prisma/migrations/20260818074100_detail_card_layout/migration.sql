-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "LayoutTemplate";
PRAGMA foreign_keys=on;

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
    "autoAdded" BOOLEAN NOT NULL DEFAULT false,
    "parentGalleryId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Gallery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Gallery_parentGalleryId_fkey" FOREIGN KEY ("parentGalleryId") REFERENCES "Gallery" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Gallery" ("autoAdded", "createdAt", "description", "displayConfig", "icon", "id", "name", "notionDataSourceId", "notionDatabaseId", "parentGalleryId", "sortOrder", "updatedAt", "workspaceId") SELECT "autoAdded", "createdAt", "description", "displayConfig", "icon", "id", "name", "notionDataSourceId", "notionDatabaseId", "parentGalleryId", "sortOrder", "updatedAt", "workspaceId" FROM "Gallery";
DROP TABLE "Gallery";
ALTER TABLE "new_Gallery" RENAME TO "Gallery";
CREATE UNIQUE INDEX "Gallery_workspaceId_notionDataSourceId_key" ON "Gallery"("workspaceId", "notionDataSourceId");
CREATE TABLE "new_PropertyConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "galleryId" TEXT NOT NULL,
    "notionPropertyId" TEXT NOT NULL,
    "notionPropertyName" TEXT NOT NULL,
    "notionPropertyType" TEXT NOT NULL,
    "resolvedType" TEXT,
    "displayConfig" TEXT NOT NULL DEFAULT '{}',
    "detailDisplayConfig" TEXT NOT NULL DEFAULT '',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "isMissing" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PropertyConfig_galleryId_fkey" FOREIGN KEY ("galleryId") REFERENCES "Gallery" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PropertyConfig" ("createdAt", "displayConfig", "galleryId", "hidden", "id", "isMissing", "notionPropertyId", "notionPropertyName", "notionPropertyType", "resolvedType", "sortOrder", "updatedAt") SELECT "createdAt", "displayConfig", "galleryId", "hidden", "id", "isMissing", "notionPropertyId", "notionPropertyName", "notionPropertyType", "resolvedType", "sortOrder", "updatedAt" FROM "PropertyConfig";
DROP TABLE "PropertyConfig";
ALTER TABLE "new_PropertyConfig" RENAME TO "PropertyConfig";
CREATE UNIQUE INDEX "PropertyConfig_galleryId_notionPropertyId_key" ON "PropertyConfig"("galleryId", "notionPropertyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
