/*
  Warnings:

  - The values [NOT_STARTED] on the enum `KycStatus` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `deleted_at` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `google_id` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `is_verified` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `middle_name` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `otp` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `otp_expires` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `phone_country_code` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `reset_otp` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `reset_otp_expires` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `username` on the `User` table. All the data in the column will be lost.
  - You are about to alter the column `credit_limit` on the `User` table. The data in that column could be lost. The data in that column will be cast from `DoublePrecision` to `Decimal(12,2)`.
  - A unique constraint covering the columns `[kyc_applicant_id]` on the table `User` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "KycDocType" AS ENUM ('PASSPORT', 'DRIVERS_LICENSE', 'NATIONAL_ID', 'SELFIE_LIVENESS', 'PROOF_OF_ADDRESS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InstallmentStatus" ADD VALUE 'OVERDUE';
ALTER TYPE "InstallmentStatus" ADD VALUE 'LATE';

-- AlterEnum
BEGIN;
CREATE TYPE "KycStatus_new" AS ENUM ('NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED');
ALTER TABLE "public"."User" ALTER COLUMN "kyc_status" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "kyc_status" TYPE "KycStatus_new" USING ("kyc_status"::text::"KycStatus_new");
ALTER TYPE "KycStatus" RENAME TO "KycStatus_old";
ALTER TYPE "KycStatus_new" RENAME TO "KycStatus";
DROP TYPE "public"."KycStatus_old";
ALTER TABLE "User" ALTER COLUMN "kyc_status" SET DEFAULT 'NOT_SUBMITTED';
COMMIT;

-- DropForeignKey
ALTER TABLE "Installment" DROP CONSTRAINT "Installment_loan_id_fkey";

-- DropForeignKey
ALTER TABLE "P2pApplication" DROP CONSTRAINT "P2pApplication_offer_id_fkey";

-- DropForeignKey
ALTER TABLE "PaymentMethod" DROP CONSTRAINT "PaymentMethod_user_id_fkey";

-- DropIndex
DROP INDEX "User_google_id_key";

-- DropIndex
DROP INDEX "User_phone_number_key";

-- DropIndex
DROP INDEX "User_username_key";

-- AlterTable
ALTER TABLE "Loan" ADD COLUMN     "lender_id" INTEGER;

-- AlterTable
ALTER TABLE "User" DROP COLUMN "deleted_at",
DROP COLUMN "google_id",
DROP COLUMN "is_verified",
DROP COLUMN "middle_name",
DROP COLUMN "otp",
DROP COLUMN "otp_expires",
DROP COLUMN "phone_country_code",
DROP COLUMN "reset_otp",
DROP COLUMN "reset_otp_expires",
DROP COLUMN "username",
ADD COLUMN     "date_of_birth" TIMESTAMP(3),
ADD COLUMN     "kyc_applicant_id" TEXT,
ADD COLUMN     "kyc_rejection_note" TEXT,
ADD COLUMN     "kyc_submitted_at" TIMESTAMP(3),
ADD COLUMN     "kyc_verified_at" TIMESTAMP(3),
ALTER COLUMN "first_name" DROP NOT NULL,
ALTER COLUMN "last_name" DROP NOT NULL,
ALTER COLUMN "kyc_status" SET DEFAULT 'NOT_SUBMITTED',
ALTER COLUMN "credit_limit" SET DATA TYPE DECIMAL(12,2),
ALTER COLUMN "credit_score" SET DEFAULT 650;

-- CreateTable
CREATE TABLE "KycDocument" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "doc_type" "KycDocType" NOT NULL,
    "id_number" TEXT,
    "country" TEXT,
    "file_url" TEXT NOT NULL,
    "is_face_match" BOOLEAN NOT NULL DEFAULT false,
    "ocr_raw_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Loan_lender_id_idx" ON "Loan"("lender_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_kyc_applicant_id_key" ON "User"("kyc_applicant_id");

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Loan" ADD CONSTRAINT "Loan_lender_id_fkey" FOREIGN KEY ("lender_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Installment" ADD CONSTRAINT "Installment_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "Loan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "P2pApplication" ADD CONSTRAINT "P2pApplication_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "P2pOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
