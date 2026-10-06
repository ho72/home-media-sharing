ALTER TABLE "User" ADD COLUMN "unipassUserId" TEXT;
ALTER TABLE "User" ADD COLUMN "unipassLinkedAt" DATETIME;

CREATE UNIQUE INDEX "User_unipassUserId_key" ON "User"("unipassUserId");
