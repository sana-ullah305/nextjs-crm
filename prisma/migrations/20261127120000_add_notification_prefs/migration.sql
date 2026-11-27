-- AlterTable
ALTER TABLE "User" ADD COLUMN "emailNotifications" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "inAppNotifications" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "notificationPreferences" JSON;
