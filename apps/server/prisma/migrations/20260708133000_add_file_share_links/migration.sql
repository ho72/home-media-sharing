-- CreateTable
CREATE TABLE "FileShareLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "selector" TEXT NOT NULL,
    "verifierHash" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "spaceId" TEXT NOT NULL,
    "nodeId" TEXT,
    "createdById" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "disabledAt" DATETIME,
    "lastAccessedAt" DATETIME,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FileShareLink_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "FileSpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileShareLink_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "FileNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileShareLink_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "FileShareLink_selector_key" ON "FileShareLink"("selector");

-- CreateIndex
CREATE INDEX "FileShareLink_spaceId_idx" ON "FileShareLink"("spaceId");

-- CreateIndex
CREATE INDEX "FileShareLink_nodeId_idx" ON "FileShareLink"("nodeId");

-- CreateIndex
CREATE INDEX "FileShareLink_createdById_idx" ON "FileShareLink"("createdById");

-- CreateIndex
CREATE INDEX "FileShareLink_expiresAt_idx" ON "FileShareLink"("expiresAt");

-- CreateIndex
CREATE INDEX "FileShareLink_disabledAt_idx" ON "FileShareLink"("disabledAt");

-- CreateIndex
CREATE INDEX "FileShareLink_targetType_spaceId_nodeId_disabledAt_idx" ON "FileShareLink"("targetType", "spaceId", "nodeId", "disabledAt");
