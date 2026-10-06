-- Remove Ouri-local auth identity fields.
-- User.id stays unchanged, so media/albums/memberships keep their existing owners.

PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "unipassUserId" TEXT NOT NULL,
    "unipassLinkedAt" DATETIME,
    "displayPreferences" TEXT,
    "avatarType" TEXT NOT NULL DEFAULT 'auto',
    "avatarColor" TEXT,
    "avatarUpdatedAt" DATETIME
);

INSERT INTO "new_User" (
    "id",
    "displayName",
    "status",
    "isAdmin",
    "createdAt",
    "approvedAt",
    "unipassUserId",
    "unipassLinkedAt",
    "displayPreferences",
    "avatarType",
    "avatarColor",
    "avatarUpdatedAt"
)
SELECT
    "id",
    "displayName",
    "status",
    "isAdmin",
    "createdAt",
    "approvedAt",
    "unipassUserId",
    "unipassLinkedAt",
    "displayPreferences",
    "avatarType",
    "avatarColor",
    "avatarUpdatedAt"
FROM "User";

DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";

CREATE UNIQUE INDEX "User_unipassUserId_key" ON "User"("unipassUserId");
CREATE INDEX "User_status_idx" ON "User"("status");

DROP TABLE IF EXISTS "InviteCode";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
