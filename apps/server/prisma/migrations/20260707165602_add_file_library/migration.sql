-- CreateTable
CREATE TABLE "FileSpace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "groupId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "trashedAt" DATETIME,
    "deleteAfter" DATETIME,
    CONSTRAINT "FileSpace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileSpace_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileSpaceMember" (
    "spaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("spaceId", "userId"),
    CONSTRAINT "FileSpaceMember_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "FileSpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileSpaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileSpaceGroupShare" (
    "spaceId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,

    PRIMARY KEY ("spaceId", "groupId"),
    CONSTRAINT "FileSpaceGroupShare_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "FileSpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileSpaceGroupShare_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileSpaceFriendShare" (
    "spaceId" TEXT NOT NULL,
    "friendId" TEXT NOT NULL,

    PRIMARY KEY ("spaceId", "friendId"),
    CONSTRAINT "FileSpaceFriendShare_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "FileSpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FileNode" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "spaceId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "color" TEXT,
    "kind" TEXT,
    "mime" TEXT,
    "sizeBytes" BIGINT,
    "storagePath" TEXT,
    "originalFilename" TEXT,
    "sha256" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "trashedAt" DATETIME,
    "deleteAfter" DATETIME,
    CONSTRAINT "FileNode_spaceId_fkey" FOREIGN KEY ("spaceId") REFERENCES "FileSpace" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FileNode" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FileNode_uploaderId_fkey" FOREIGN KEY ("uploaderId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "FileSpace_ownerId_idx" ON "FileSpace"("ownerId");

-- CreateIndex
CREATE INDEX "FileSpace_kind_ownerId_idx" ON "FileSpace"("kind", "ownerId");

-- CreateIndex
CREATE INDEX "FileSpace_groupId_idx" ON "FileSpace"("groupId");

-- CreateIndex
CREATE INDEX "FileSpace_kind_groupId_idx" ON "FileSpace"("kind", "groupId");

-- CreateIndex
CREATE INDEX "FileSpace_trashedAt_idx" ON "FileSpace"("trashedAt");

-- CreateIndex
CREATE INDEX "FileSpaceMember_userId_status_idx" ON "FileSpaceMember"("userId", "status");

-- CreateIndex
CREATE INDEX "FileSpaceGroupShare_groupId_idx" ON "FileSpaceGroupShare"("groupId");

-- CreateIndex
CREATE INDEX "FileSpaceFriendShare_friendId_idx" ON "FileSpaceFriendShare"("friendId");

-- CreateIndex
CREATE INDEX "FileNode_spaceId_parentId_idx" ON "FileNode"("spaceId", "parentId");

-- CreateIndex
CREATE INDEX "FileNode_uploaderId_idx" ON "FileNode"("uploaderId");

-- CreateIndex
CREATE INDEX "FileNode_trashedAt_idx" ON "FileNode"("trashedAt");

-- CreateIndex
CREATE INDEX "FileNode_sha256_idx" ON "FileNode"("sha256");
