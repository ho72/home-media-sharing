-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "ownerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "coverMediaId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tripStartDate" DATETIME,
    "tripEndDate" DATETIME,
    "location" TEXT,
    "type" TEXT NOT NULL DEFAULT 'general',
    "bannerType" TEXT NOT NULL DEFAULT 'auto',
    "bannerColor" TEXT,
    "bannerPhotoId" TEXT,
    CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Project_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "Media" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Project" ("coverMediaId", "createdAt", "id", "location", "ownerId", "title", "tripEndDate", "tripStartDate", "type") SELECT "coverMediaId", "createdAt", "id", "location", "ownerId", "title", "tripEndDate", "tripStartDate", "type" FROM "Project";
DROP TABLE "Project";
ALTER TABLE "new_Project" RENAME TO "Project";
CREATE UNIQUE INDEX "Project_coverMediaId_key" ON "Project"("coverMediaId");
CREATE INDEX "Project_ownerId_idx" ON "Project"("ownerId");
CREATE INDEX "Project_tripStartDate_idx" ON "Project"("tripStartDate");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
