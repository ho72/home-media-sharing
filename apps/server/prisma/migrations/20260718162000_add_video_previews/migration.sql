ALTER TABLE "Media" ADD COLUMN "videoPreviewPath" TEXT;
ALTER TABLE "Media" ADD COLUMN "videoPreviewStatus" TEXT NOT NULL DEFAULT 'skipped';
