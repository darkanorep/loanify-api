const crypto = require('crypto');
const prisma = require('../lib/prisma');
const { broadcast, sendToUser } = require('../lib/websocket');

const getPaymentsSummary = async (req, res) => {
    try {
        const userId = req.user.id;

        // --- Active loans with next-due installment ---
        const activeLoansRaw = await prisma.loan.findMany({
            where: { user_id: userId, status: 'ACTIVE' },
            include: {
                installments: {
                    where: { status: { in: ['PENDING', 'PARTIALLY_PAID'] } },
                    orderBy: { due_date: 'asc' },
                    take: 1,
                },
            },
        });

        const activeLoans = activeLoansRaw.map((loan) => ({
            id: loan.id,
            purpose: loan.purpose,
            outstanding_balance: Number(loan.outstanding_balance),
            monthly_installment: Number(loan.monthly_installment),
            next_due_date: loan.installments[0]?.due_date || null,
        }));

        // --- Next Due Installment (across all active loans) ---
        const nextInstallment = await prisma.installment.findFirst({
            where: {
                loan: { user_id: userId, status: 'ACTIVE' },
                status: { in: ['PENDING', 'PARTIALLY_PAID'] },
            },
            orderBy: { due_date: 'asc' },
        });

        // --- AutoPay + default account ---
        const user = await prisma.user.findUnique({ where: { id: userId } });
        const defaultMethod = await prisma.paymentMethod.findFirst({
            where: { user_id: userId, is_default: true },
        });

        // --- Linked payment methods ---
        const paymentMethods = await prisma.paymentMethod.findMany({
            where: { user_id: userId },
            orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
        });

        // --- Full transaction history ---
        const transactions = await prisma.transaction.findMany({
            where: { user_id: userId },
            orderBy: { created_at: 'desc' },
            include: {
                loan: { select: { purpose: true } },
                payment_method: { select: { institution_name: true, last_four: true } },
            },
        });

        const formattedTransactions = transactions.map((tx) => ({
            id: tx.id,
            date: tx.created_at,
            description: tx.type === 'DISBURSEMENT' ? 'Loan Disbursement' : 'Loan Repayment',
            method: tx.payment_method
                ? `${tx.payment_method.institution_name} (•••${tx.payment_method.last_four})`
                : 'Wallet Balance',
            amount: Number(tx.amount) * (tx.type === 'REPAYMENT' ? -1 : 1),
            status: tx.type === 'DISBURSEMENT' ? 'Approved' : 'Completed',
        }));

        res.json({
            active_loans: activeLoans,
            next_due: nextInstallment
                ? {
                    amount: Number(nextInstallment.amount_due) - Number(nextInstallment.amount_paid),
                    due_date: nextInstallment.due_date,
                    active_loan_count: activeLoans.length,
                    loan_id: nextInstallment.loan_id
                }
                : null,
            autopay_enabled: user?.autopay_enabled || false,
            default_payment_method: defaultMethod
                ? `${defaultMethod.institution_name} (•••${defaultMethod.last_four})`
                : null,
            payment_methods: paymentMethods,
            transactions: formattedTransactions,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const handleLoan = async (req, res) => {
    try {
        const userId = req.user.id;
        const { loan_id, amount, payment_method_id } = req.body;
        const paymentAmount = Number(amount);

        if (isNaN(paymentAmount) || paymentAmount <= 0) {
            return res.status(400).json({ error: "Invalid payment amount." });
        }

        const result = await prisma.$transaction(async (tx) => {
            // 1. Fetch Loan with Borrower & Lender details
            const loan = await tx.loan.findUnique({
                where: { id: Number(loan_id), user_id: userId },
                include: {
                    installments: { orderBy: { due_date: 'asc' } },
                    user: { select: { id: true, first_name: true, last_name: true, full_name: true, credit_limit: true } },
                    lender: { select: { id: true, first_name: true, last_name: true, full_name: true } }
                }
            });

            if (!loan || loan.status !== 'ACTIVE') {
                throw new Error("Active loan not found.");
            }

            const borrowerWallet = await tx.wallet.findUnique({
                where: { user_id: userId }
            });

            if (!borrowerWallet || Number(borrowerWallet.available_balance) < paymentAmount) {
                throw new Error(`Insufficient wallet balance. You need ₱${paymentAmount.toLocaleString()} to complete this payment.`);
            }

            // Construct readable names for descriptions
            const borrowerObj = loan.user;
            const lenderObj = loan.lender;

            const borrowerName = borrowerObj?.full_name || `${borrowerObj?.first_name || ''} ${borrowerObj?.last_name || ''}`.trim() || `Borrower #${userId}`;
            const lenderName = lenderObj?.full_name || `${lenderObj?.first_name || ''} ${lenderObj?.last_name || ''}`.trim() || `Lender #${loan.lender_id}`;

            // 2. Deduct from Borrower's Wallet
            const updatedBorrowerWallet = await tx.wallet.update({
                where: { user_id: userId },
                data: {
                    available_balance: { decrement: paymentAmount }
                }
            });

            // 3. Credit Lender's Wallet (Yield Inflow)
            const lenderId = loan.lender_id;
            let updatedLenderWallet = null;

            if (lenderId) {
                updatedLenderWallet = await tx.wallet.upsert({
                    where: { user_id: lenderId },
                    update: {
                        available_balance: { increment: paymentAmount }
                    },
                    create: {
                        available_balance: paymentAmount,
                        escrow_balance: 0.00,
                        user: { connect: { id: lenderId } }
                    }
                });
            }

            // 4. Update Installment Schedule Rows
            let remainingPayment = paymentAmount;
            for (const inst of loan.installments) {
                if (remainingPayment <= 0) break;
                if (inst.status === 'PAID') continue;

                const dueAmount = Number(inst.amount_due) - Number(inst.amount_paid);
                const payAmount = Math.min(remainingPayment, dueAmount);

                const newAmountPaid = Number(inst.amount_paid) + payAmount;
                remainingPayment -= payAmount;

                const isFullyPaid = newAmountPaid >= Number(inst.amount_due);

                await tx.installment.update({
                    where: { id: inst.id },
                    data: {
                        amount_paid: newAmountPaid,
                        status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
                        paid_at: isFullyPaid ? new Date() : inst.paid_at
                    }
                });
            }

            // 5. Recalculate Loan & User Credit Balances
            const newTotalPaid = Number(loan.total_paid) + paymentAmount;
            const newBalance = Math.max(0, Number(loan.outstanding_balance) - paymentAmount);

            await tx.loan.update({
                where: { id: Number(loan_id) },
                data: {
                    total_paid: newTotalPaid,
                    outstanding_balance: newBalance
                }
            });

            const updatedInstallments = await tx.installment.findMany({
                where: { loan_id: Number(loan_id) }
            });

            const allPaid = updatedInstallments.every(inst => inst.status === 'PAID');

            if (allPaid) {
                const hasLatePayments = updatedInstallments.some(inst => inst.status === 'LATE');

                await tx.loan.update({
                    where: { id: Number(loan_id) },
                    data: {
                        status: 'COMPLETED',
                        completed_at: new Date()
                    }
                });

                if (!hasLatePayments) {
                    const currentLimit = Number(loan.user.credit_limit || 500);
                    const maxLimitCeiling = 30000;
                    let newLimit = currentLimit < 2000 ? 2000 : currentLimit * 1.3;
                    newLimit = Math.min(newLimit, maxLimitCeiling);

                    await tx.user.update({
                        where: { id: userId },
                        data: {
                            credit_limit: newLimit,
                            credit_score: { increment: 15 }
                        }
                    });
                }
            }

            // 6. Audit Logging (Transaction + WalletTransaction with Names)
            await tx.transaction.create({
                data: {
                    user_id: userId,
                    loan_id: Number(loan_id),
                    payment_method_id: payment_method_id ? Number(payment_method_id) : null,
                    amount: paymentAmount,
                    type: 'REPAYMENT'
                }
            });

            const borrowerRef = `REPAY-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
            const borrowerTx = await tx.walletTransaction.create({
                data: {
                    wallet_id: borrowerWallet.id,
                    user_id: userId,
                    type: 'REPAYMENT',
                    amount: paymentAmount,
                    fee: 0.00,
                    gateway: 'INTERNAL_VAULT',
                    reference_no: borrowerRef,
                    description: `Loan #${loan_id} Repayment to ${lenderName}`,
                    status: 'COMPLETED'
                }
            });

            if (updatedLenderWallet && lenderId) {
                const lenderRef = `YIELD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
                await tx.walletTransaction.create({
                    data: {
                        wallet_id: updatedLenderWallet.id,
                        user_id: lenderId,
                        type: 'TOP_UP',
                        amount: paymentAmount,
                        fee: 0.00,
                        gateway: 'INTERNAL_VAULT',
                        reference_no: lenderRef,
                        description: `Loan #${loan_id} Yield Payment from ${borrowerName}`,
                        status: 'COMPLETED'
                    }
                });
            }

            return {
                message: "Payment processed successfully.",
                newBalance,
                allPaid,
                wallet: updatedBorrowerWallet,
                borrowerTx,
                borrowerName,
                lenderName
            };
        });

        // 7. Real-Time WebSocket Alerts
        if (typeof sendToUser === 'function' && result.borrowerTx) {
            const loan = await prisma.loan.findUnique({ where: { id: Number(loan_id) } });
            if (loan?.lender_id) {
                sendToUser(loan.lender_id, {
                    type: "repayment_received",
                    title: "Repayment Received!",
                    message: `You received a repayment of ₱${paymentAmount.toLocaleString()} from ${result.borrowerName} for Loan #${loan_id}.`
                });
            }
        }

        if (typeof broadcast === 'function') {
            broadcast({ type: "marketplace_update" });
            broadcast({
                type: "admin_data_updated",
                action: "WALLET_TOPUP",
                newEvent: {
                    id: result.borrowerTx.id,
                    title: "Loan Repayment Completed",
                    desc: `₱${paymentAmount.toLocaleString()} paid by ${result.borrowerName} for Loan #${loan_id}.`,
                    time: "Just now",
                    source: result.borrowerTx.reference_no,
                    color: "text-indigo-600 bg-indigo-50"
                }
            });
        }

        res.json(result);
    } catch (err) {
        console.error("Payment error:", err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = { getPaymentsSummary, handleLoan };