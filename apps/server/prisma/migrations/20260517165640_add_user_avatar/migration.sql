-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "handle" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" DATETIME,
    "displayPreferences" TEXT,
    "avatarType" TEXT NOT NULL DEFAULT 'auto',
    "avatarColor" TEXT,
    "avatarUpdatedAt" DATETIME,
    "signupInviteCodeId" TEXT,
    CONSTRAINT "User_signupInviteCodeId_fkey" FOREIGN KEY ("signupInviteCodeId") REFERENCES "InviteCode" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_User" ("approvedAt", "createdAt", "displayName", "displayPreferences", "email", "handle", "id", "isAdmin", "passwordHash", "signupInviteCodeId", "status") SELECT "approvedAt", "createdAt", "displayName", "displayPreferences", "email", "handle", "id", "isAdmin", "passwordHash", "signupInviteCodeId", "status" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_handle_key" ON "User"("handle");
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE INDEX "User_status_idx" ON "User"("status");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
