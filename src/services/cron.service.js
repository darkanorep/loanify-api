const cron = require("node-cron");
const crypto = require("crypto");
const prisma = require("../lib/prisma");
const { sendToUser, broadcast } = require("../lib/websocket");

/**
 * Process daily automated repayments and flag overdue installments.
 */
const runDailyLoanJobs = async () => {
    console.log("⏰ Running Daily Loan Cron Jobs...");
    const today = new Date();

    try {
        // =========================================================
        // 1. AUTOPAY PROCESSING
        // =========================================================
        const autopayInstallments = await prisma.installment.findMany({
            where: {
                status: "PENDING",
                due_date: { lte: today },
                loan: {
                    status: "ACTIVE",
                    user: { autopay_enabled: true }
                }
            },
            include: {
                loan: {
                    include: {
                        user: {
                            include: {
                                payment_methods: { where: { is_default: true } }
                            }
                        },
                        lender: selectNameObj()
                    }
                }
            }
        });

        for (const inst of autopayInstallments) {
            const borrowerId = inst.loan.user_id;
            const loanId = inst.loan_id;
            const dueAmount = Number(inst.amount_due) - Number(inst.amount_paid);

            try {
                await prisma.$transaction(async (tx) => {
                    let wallet = await tx.wallet.findUnique({
                        where: { user_id: borrowerId }
                    });

                    if (!wallet) {
                        wallet = await tx.wallet.create({
                            data: { user_id: borrowerId, available_balance: 0.00, escrow_balance: 0.00 }
                        });
                    }

                    const availableBal = Number(wallet.available_balance);

                    // AUTO DIRECT FUNDING: Check if wallet balance is below amount due
                    if (availableBal < dueAmount) {
                        const requiredDifference = dueAmount - availableBal;
                        const primaryCard = inst.loan.user.payment_methods[0];

                        // If no default payment method attached, skip AutoPay
                        if (!primaryCard) {
                            console.warn(`[AutoPay] Skipped Installment #${inst.id}: Insufficient wallet balance and no default payment method.`);
                            return;
                        }

                        // Auto top-up the exact difference into available_balance
                        await tx.wallet.update({
                            where: { id: wallet.id },
                            data: { available_balance: { increment: requiredDifference } }
                        });

                        // Log Auto Direct Funding Audit Entry
                        const autoRef = `AUTOCARD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
                        await tx.walletTransaction.create({
                            data: {
                                wallet_id: wallet.id,
                                user_id: borrowerId,
                                loan_id: loanId,
                                type: "TOP_UP",
                                amount: requiredDifference,
                                fee: 0.00,
                                gateway: primaryCard.type === 'CARD' ? 'CARD' : 'INTERNAL_VAULT',
                                reference_no: autoRef,
                                description: `AutoPay Direct Funding via ${primaryCard.institution_name} (*${primaryCard.last_four})`,
                                status: "COMPLETED"
                            }
                        });
                    }

                    // A. Deduct balance from Borrower Wallet
                    const updatedWallet = await tx.wallet.update({
                        where: { user_id: borrowerId },
                        data: { available_balance: { decrement: dueAmount } }
                    });

                    // B. Credit Lender if loan is P2P
                    if (inst.loan.lender_id) {
                        await tx.wallet.upsert({
                            where: { user_id: inst.loan.lender_id },
                            update: { available_balance: { increment: dueAmount } },
                            create: {
                                available_balance: dueAmount,
                                escrow_balance: 0.00,
                                user: { connect: { id: inst.loan.lender_id } }
                            }
                        });
                    }

                    // C. Update Installment
                    await tx.installment.update({
                        where: { id: inst.id },
                        data: {
                            amount_paid: Number(inst.amount_due),
                            status: "PAID",
                            paid_at: new Date()
                        }
                    });

                    // D. Recalculate Loan Balances
                    const newTotalPaid = Number(inst.loan.total_paid) + dueAmount;
                    const newBalance = Math.max(0, Number(inst.loan.outstanding_balance) - dueAmount);
                    const isFullyPaid = newBalance <= 0;

                    await tx.loan.update({
                        where: { id: loanId },
                        data: {
                            total_paid: newTotalPaid,
                            outstanding_balance: newBalance,
                            status: isFullyPaid ? "COMPLETED" : "ACTIVE",
                            completed_at: isFullyPaid ? new Date() : null
                        }
                    });

                    // E. Create Audit Log for Repayment
                    const refNo = `AUTOPAY-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
                    await tx.walletTransaction.create({
                        data: {
                            wallet_id: wallet.id,
                            user_id: borrowerId,
                            loan_id: loanId,
                            type: "REPAYMENT",
                            amount: dueAmount,
                            fee: 0.00,
                            gateway: "INTERNAL_VAULT",
                            reference_no: refNo,
                            description: `AutoPay Execution for Loan #${loanId} Installment #${inst.installment_number}`,
                            status: "COMPLETED"
                        }
                    });
                });

                sendToUser(borrowerId, {
                    type: "autopay_success",
                    title: "AutoPay Executed",
                    message: `₱${dueAmount.toLocaleString()} was automatically processed for Loan #${loanId}.`
                });

            } catch (err) {
                console.error(`AutoPay failed for Installment #${inst.id}:`, err);
            }
        }

        // =========================================================
        // 2. OVERDUE PENALTY PROCESSING
        // =========================================================
        const overdueInstallments = await prisma.installment.findMany({
            where: {
                status: "PENDING",
                due_date: { lt: today },
                loan: { status: "ACTIVE" }
            },
            include: { loan: true }
        });

        const LATE_FEE_PENALTY = 50.00; // Flat late payment penalty

        for (const inst of overdueInstallments) {
            const borrowerId = inst.loan.user_id;

            await prisma.$transaction(async (tx) => {
                // A. Mark Installment as OVERDUE
                await tx.installment.update({
                    where: { id: inst.id },
                    data: { status: "OVERDUE" }
                });

                // B. Add late penalty to loan outstanding balance
                await tx.loan.update({
                    where: { id: inst.loan_id },
                    data: {
                        outstanding_balance: { increment: LATE_FEE_PENALTY }
                    }
                });

                // C. Deduct Credit Score by 10 points
                await tx.user.update({
                    where: { id: borrowerId },
                    data: {
                        credit_score: { decrement: 10 }
                    }
                });
            });

            sendToUser(borrowerId, {
                type: "installment_overdue",
                title: "Payment Overdue Warning",
                message: `Installment #${inst.installment_number} for Loan #${inst.loan_id} is overdue. A ₱50 late fee was added and your credit score was adjusted.`
            });
        }

        if (autopayInstallments.length > 0 || overdueInstallments.length > 0) {
            broadcast({ type: "marketplace_update" });
        }

        console.log(`✅ Daily Jobs Finished: Processed ${autopayInstallments.length} AutoPays & ${overdueInstallments.length} Overdues.`);

    } catch (err) {
        console.error("Cron Execution Error:", err);
    }
};

function selectNameObj() {
    return {
        select: {
            id: true,
            first_name: true,
            last_name: true,
            full_name: true
        }
    };
}

/**
 * Initialize Cron Scheduler (Runs every midnight at 00:00)
 */
const initCronJobs = () => {
    cron.schedule("0 0 * * *", () => {
        runDailyLoanJobs();
    });
    console.log("🚀 Cron Job Scheduler Initialized (Running daily at midnight).");
};

module.exports = { initCronJobs, runDailyLoanJobs };