-- AlterTable
ALTER TABLE "User" ADD COLUMN     "is_verified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "otp" TEXT,
ADD COLUMN     "otp_expires" TIMESTAMP(3);
