-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED', 'PENDING', 'VERIFIED', 'REJECTED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "full_name" TEXT,
ADD COLUMN     "kyc_status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED';
