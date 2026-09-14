import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import crypto from 'crypto';
import { broadcast } from '../lib/websocket.js';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

/**
 * 1. Lock Lender Funds into Escrow when backing/bidding on a P2P Loan Note
 */
export const placeEscrowHold = async ({ lenderId, loanId, bidAmount }) => {
    const amount = Number(bidAmount);
    if (amount <= 0) throw new Error("Bid amount must be greater than zero.");

    return await prisma.$transaction(async (tx) => {
        // Fetch lender wallet with row lock validation
        const lenderWallet = await tx.wallet.findUnique({
            where: { user_id: lenderId }
        });

        if (!lenderWallet || Number(lenderWallet.available_balance) < amount) {
            throw new Error("Insufficient available wallet balance to back this note.");
        }

        // Deduct from available balance and shift into escrow hold
        const updatedWallet = await tx.wallet.update({
            where: { user_id: lenderId },
            data: {
                available_balance: { decrement: amount },
                escrow_balance: { increment: amount }
            }
        });

        // Record Escrow Hold transaction
        const referenceNo = `ESC-HOLD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const transaction = await tx.walletTransaction.create({
            data: {
                wallet_id: updatedWallet.id,
                user_id: lenderId,
                loan_id: loanId,
                type: 'ESCROW_HOLD',
                amount,
                gateway: 'INTERNAL_VAULT',
                reference_no: referenceNo,
                description: `Locked ₱${amount.toLocaleString()} in escrow for Loan Note #${loanId}`,
                status: 'COMPLETED'
            }
        });

        // Broadcast Escrow Event
        broadcast({
            type: "admin_data_updated",
            action: "LIVE_STREAM_EVENT",
            newEvent: {
                id: transaction.id,
                title: `P2P Note #${loanId} Bid Locked`,
                desc: `₱${amount.toLocaleString()} held in escrow for note allocation.`,
                time: "Just now",
                source: referenceNo,
                icon: "lock",
                color: "text-indigo-600 bg-indigo-50"
            }
        });

        return { wallet: updatedWallet, transaction };
    });
};

/**
 * 2. Release Escrow & Disburse Funds to Borrower Wallet on Loan Approval
 */
export const disburseLoanFromEscrow = async ({ loanId, adminId }) => {
    return await prisma.$transaction(async (tx) => {
        const loan = await tx.loan.findUnique({
            where: { id: loanId },
            include: { user: true }
        });

        if (!loan) throw new Error("Loan record not found.");
        if (loan.status !== 'APPROVED') {
            throw new Error(`Cannot disburse loan with status: ${loan.status}. Must be APPROVED.`);
        }

        const principal = Number(loan.principal_amount);

        // Fetch or create Borrower Wallet
        const borrowerWallet = await tx.wallet.upsert({
            where: { user_id: loan.user_id },
            update: { available_balance: { increment: principal } },
            create: { user_id: loan.user_id, available_balance: principal, escrow_balance: 0 }
        });

        // Update Loan Status to ACTIVE
        const updatedLoan = await tx.loan.update({
            where: { id: loanId },
            data: {
                status: 'ACTIVE',
                disbursed_at: new Date()
            }
        });

        // Record Disbursement Transaction for Borrower
        const referenceNo = `DISB-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const disbursementTx = await tx.walletTransaction.create({
            data: {
                wallet_id: borrowerWallet.id,
                user_id: loan.user_id,
                loan_id: loanId,
                type: 'DISBURSEMENT',
                amount: principal,
                gateway: 'INTERNAL_VAULT',
                reference_no: referenceNo,
                description: `Loan disbursement credited for Note #${loanId}`,
                status: 'COMPLETED'
            }
        });

        // Broadcast real-time disbursement to connected clients
        broadcast({
            type: "admin_data_updated",
            action: "LIVE_STREAM_EVENT",
            newEvent: {
                id: disbursementTx.id,
                title: `P2P Note #${loanId} Fully Funded`,
                desc: `₱${principal.toLocaleString()} disbursed to ${loan.user.full_name || 'Borrower'} wallet.`,
                time: "Just now",
                source: "Smart Escrow",
                icon: "payments",
                color: "text-emerald-600 bg-emerald-50"
            }
        });

        return { loan: updatedLoan, wallet: borrowerWallet, transaction: disbursementTx };
    });
};

/**
 * 3. Refund Escrow back to Lender if Loan Application is Cancelled or Rejected
 */
export const refundEscrowHold = async ({ lenderId, loanId, holdAmount }) => {
    const amount = Number(holdAmount);

    return await prisma.$transaction(async (tx) => {
        const wallet = await tx.wallet.update({
            where: { user_id: lenderId },
            data: {
                escrow_balance: { decrement: amount },
                available_balance: { increment: amount }
            }
        });

        const referenceNo = `ESC-REFUND-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        const transaction = await tx.walletTransaction.create({
            data: {
                wallet_id: wallet.id,
                user_id: lenderId,
                loan_id: loanId,
                type: 'ESCROW_RELEASE',
                amount,
                gateway: 'INTERNAL_VAULT',
                reference_no: referenceNo,
                description: `Escrow refund of ₱${amount.toLocaleString()} for cancelled Note #${loanId}`,
                status: 'COMPLETED'
            }
        });

        return { wallet, transaction };
    });
};