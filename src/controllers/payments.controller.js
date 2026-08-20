const prisma = require('../lib/prisma');

const getPaymentsSummary = async (req, res) => {
    try {
        const userId = req.user.id;

        // --- Next Due Installment (across all active loans) ---
        const activeLoans = await prisma.loan.findMany({
            where: { user_id: userId, status: 'ACTIVE' },
        });

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
                : null, // null when not tied to a specific account — e.g. system-generated disbursements
            amount: Number(tx.amount) * (tx.type === 'REPAYMENT' ? -1 : 1),
            // No real status field exists on Transaction yet — derived from
            // type for now. Disbursements read as "Approved" (matches the
            // mockup), repayments as "Completed".
            status: tx.type === 'DISBURSEMENT' ? 'Approved' : 'Completed',
        }));

        res.json({
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