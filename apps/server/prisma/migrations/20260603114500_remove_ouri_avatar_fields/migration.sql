-- Remove Ouri-local avatar metadata. Profile photos are managed by Unipass.

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
    "unipassAvatarUrl" TEXT,
    "displayPreferences" TEXT
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
    "unipassAvatarUrl",
    "displayPreferences"
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
    "unipassAvatarUrl",
    "displayPreferences"
FROM "User";

DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";

CREATE UNIQUE INDEX "User_unipassUserId_key" ON "User"("unipassUserId");
CREATE INDEX "User_status_idx" ON "User"("status");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
