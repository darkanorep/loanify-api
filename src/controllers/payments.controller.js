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
                    amount:
                        Number(nextInstallment.amount_due) - Number(nextInstallment.amount_paid),
                    due_date: nextInstallment.due_date,
                    active_loan_count: activeLoans.length,
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

module.exports = { getPaymentsSummary };