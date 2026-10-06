-- Add default-space marker so system spaces and user-created spaces can share
-- the same visibility kind without sharing delete behavior.
ALTER TABLE "FileSpace" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;
