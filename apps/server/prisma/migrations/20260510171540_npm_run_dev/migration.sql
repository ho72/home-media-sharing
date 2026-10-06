-- AlterTable
ALTER TABLE "Media" ADD COLUMN "altitude" REAL;
ALTER TABLE "Media" ADD COLUMN "audioCodec" TEXT;
ALTER TABLE "Media" ADD COLUMN "cameraMake" TEXT;
ALTER TABLE "Media" ADD COLUMN "cameraModel" TEXT;
ALTER TABLE "Media" ADD COLUMN "exposureSec" REAL;
ALTER TABLE "Media" ADD COLUMN "fNumber" REAL;
ALTER TABLE "Media" ADD COLUMN "focalLength" REAL;
ALTER TABLE "Media" ADD COLUMN "isoSpeed" INTEGER;
ALTER TABLE "Media" ADD COLUMN "latitude" REAL;
ALTER TABLE "Media" ADD COLUMN "lensModel" TEXT;
ALTER TABLE "Media" ADD COLUMN "longitude" REAL;
ALTER TABLE "Media" ADD COLUMN "metaJson" TEXT;
ALTER TABLE "Media" ADD COLUMN "videoCodec" TEXT;

-- CreateIndex
CREATE INDEX "Media_latitude_idx" ON "Media"("latitude");
