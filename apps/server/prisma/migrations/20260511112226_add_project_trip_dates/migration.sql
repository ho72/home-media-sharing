-- AlterTable
ALTER TABLE "Project" ADD COLUMN "tripEndDate" DATETIME;
ALTER TABLE "Project" ADD COLUMN "tripStartDate" DATETIME;

-- CreateIndex
CREATE INDEX "Project_tripStartDate_idx" ON "Project"("tripStartDate");
