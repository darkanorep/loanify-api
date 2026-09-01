-- AlterTable
ALTER TABLE "User" ADD COLUMN     "credit_limit" DOUBLE PRECISION NOT NULL DEFAULT 500,
ADD COLUMN     "credit_score" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "phone_country_code" TEXT DEFAULT '+63';

-- CreateTable
CREATE TABLE "P2pLoanListing" (
    "id" SERIAL NOT NULL,
    "borrower_id" INTEGER NOT NULL,
    "amount_requested" DOUBLE PRECISION NOT NULL,
    "amount_funded" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interest_rate" DOUBLE PRECISION NOT NULL,
    "term_months" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING_FUNDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "P2pLoanListing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "P2pInvestment" (
    "id" SERIAL NOT NULL,
    "listing_id" INTEGER NOT NULL,
    "investor_id" INTEGER NOT NULL,
    "amount_invested" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "P2pInvestment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "P2pLoanListing" ADD CONSTRAINT "P2pLoanListing_borrower_id_fkey" FOREIGN KEY ("borrower_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "P2pInvestment" ADD CONSTRAINT "P2pInvestment_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "P2pLoanListing"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "P2pInvestment" ADD CONSTRAINT "P2pInvestment_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
