const prisma = require('../lib/prisma');

const getPaymentsSummary = async (req, res) => {
    try {
        const userId = req.user.id;

        // --- Active loans, with their next-due installment for the
        // Make Payment modal's "Select Loan Account" list ---
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

        // --- Next Due Installment (aggregate, across all active loans) ---
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

        // --- Linked accounts ---
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
                : null,
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
            autopay_enabled: user.autopay_enabled,
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

        const result = await prisma.$transaction(async (tx) => {
            const loan = await tx.loan.findUnique({
                where: { id: Number(loan_id), user_id: userId },
                include: { installments: { orderBy: { due_date: 'asc' } }, user: true }
            });

            if (!loan || loan.status !== 'ACTIVE') {
                throw new Error("Active loan not found.");
            }

            let remainingPayment = Number(amount);

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
                    }
                });
            }

            await tx.transaction.create({
                data: {
                    user_id: userId,
                    loan_id: Number(loan_id),
                    payment_method_id: payment_method_id ? Number(payment_method_id) : null,
                    amount: Number(amount),
                    type: 'REPAYMENT'
                }
            });

            const newBalance = Math.max(0, Number(loan.outstanding_balance) - Number(amount));
            await tx.loan.update({
                where: { id: Number(loan_id) },
                data: { outstanding_balance: newBalance }
            });

            const updatedInstallments = await tx.installment.findMany({
                where: { loan_id: Number(loan_id) }
            });

            const allPaid = updatedInstallments.every(inst => inst.status === 'PAID');

            if (allPaid) {
                const hasLatePayments = updatedInstallments.some(inst => inst.status === 'LATE');

                await tx.loan.update({
                    where: { id: Number(loan_id) },
                    data: { status: 'COMPLETED' }
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

            return { message: "Payment processed successfully.", newBalance, allPaid };
        });

        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = { getPaymentsSummary, handleLoan };