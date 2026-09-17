-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('GCASH', 'MAYA', 'INSTAPAY', 'INTERNAL_VAULT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TransactionType" ADD VALUE 'TOP_UP';
ALTER TYPE "TransactionType" ADD VALUE 'WITHDRAWAL';
ALTER TYPE "TransactionType" ADD VALUE 'ESCROW_HOLD';
ALTER TYPE "TransactionType" ADD VALUE 'ESCROW_RELEASE';

-- CreateTable
CREATE TABLE "Wallet" (
    "id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "available_balance" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "escrow_balance" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Wallet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "loan_id" INTEGER,
    "type" "TransactionType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "gateway" "PaymentGateway" NOT NULL DEFAULT 'INTERNAL_VAULT',
    "reference_no" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WalletTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Wallet_user_id_key" ON "Wallet"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_reference_no_key" ON "WalletTransaction"("reference_no");

-- CreateIndex
CREATE INDEX "WalletTransaction_user_id_idx" ON "WalletTransaction"("user_id");

-- CreateIndex
CREATE INDEX "WalletTransaction_wallet_id_idx" ON "WalletTransaction"("wallet_id");

-- AddForeignKey
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "Wallet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WalletTransaction" ADD CONSTRAINT "WalletTransaction_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "Loan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
