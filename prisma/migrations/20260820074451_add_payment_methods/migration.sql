-- CreateEnum
CREATE TYPE "PaymentMethodType" AS ENUM ('BANK_ACCOUNT', 'CARD');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "payment_method_id" INTEGER;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "autopay_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "type" "PaymentMethodType" NOT NULL,
    "institution_name" TEXT NOT NULL,
    "last_four" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMethod_user_id_idx" ON "PaymentMethod"("user_id");

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "PaymentMethod"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
