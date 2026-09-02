/*
  Warnings:

  - You are about to drop the `P2pInvestment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `P2pLoanListing` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "P2pInvestment" DROP CONSTRAINT "P2pInvestment_investor_id_fkey";

-- DropForeignKey
ALTER TABLE "P2pInvestment" DROP CONSTRAINT "P2pInvestment_listing_id_fkey";

-- DropForeignKey
ALTER TABLE "P2pLoanListing" DROP CONSTRAINT "P2pLoanListing_borrower_id_fkey";

-- DropTable
DROP TABLE "P2pInvestment";

-- DropTable
DROP TABLE "P2pLoanListing";

-- CreateTable
CREATE TABLE "P2pOffer" (
    "id" SERIAL NOT NULL,
    "lender_id" INTEGER NOT NULL,
    "amount_available" DOUBLE PRECISION NOT NULL,
    "interest_rate" DOUBLE PRECISION NOT NULL,
    "term_months" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "P2pOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "P2pApplication" (
    "id" SERIAL NOT NULL,
    "offer_id" INTEGER NOT NULL,
    "borrower_id" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "P2pApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "P2pOffer" ADD CONSTRAINT "P2pOffer_lender_id_fkey" FOREIGN KEY ("lender_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "P2pApplication" ADD CONSTRAINT "P2pApplication_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "P2pOffer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "P2pApplication" ADD CONSTRAINT "P2pApplication_borrower_id_fkey" FOREIGN KEY ("borrower_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
