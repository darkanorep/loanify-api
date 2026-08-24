const prisma = require('../lib/prisma');

const getDashboardSummary = async (req, res) => {
    try {
        const userId = req.user.id;

        const activeLoans = await prisma.loan.findMany({
            where: { user_id: userId, status: 'ACTIVE' },
        });

        const activeLoansCount = activeLoans.length;
        const currentBalance = activeLoans.reduce(
            (sum, loan) => sum + Number(loan.outstanding_balance),
            0
        );

        const nextInstallment = await prisma.installment.findFirst({
            where: {
                loan: { user_id: userId, status: 'ACTIVE' },
                status: { in: ['PENDING', 'PARTIALLY_PAID'] },
            },
            orderBy: { due_date: 'asc' },
        });

        const nextPayment = nextInstallment
            ? {
                amount: Number(nextInstallment.amount_due) - Number(nextInstallment.amount_paid),
                due_date: nextInstallment.due_date,
            }
            : null;

        const nineMonthsAgo = new Date();
        nineMonthsAgo.setMonth(nineMonthsAgo.getMonth() - 8);
        nineMonthsAgo.setDate(1);

        const repaymentTransactions = await prisma.transaction.findMany({
            where: {
                user_id: userId,
                type: 'REPAYMENT',
                created_at: { gte: nineMonthsAgo },
            },
            select: { amount: true, created_at: true },
        });

        const monthlyTotals = {};
        for (const tx of repaymentTransactions) {
            const key = tx.created_at.toISOString().slice(0, 7);
            monthlyTotals[key] = (monthlyTotals[key] || 0) + Number(tx.amount);
        }

        const repaymentProgress = Object.entries(monthlyTotals)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, total]) => ({ month, total_paid: total }));

        const recentTransactions = await prisma.transaction.findMany({
            where: { user_id: userId },
            orderBy: { created_at: 'desc' },
            take: 10,
            include: { loan: { select: { purpose: true } } },
        });

        const formattedTransactions = recentTransactions.map((tx) => ({
            id: tx.id,
            date: tx.created_at,
            description: tx.type === 'DISBURSEMENT' ? 'Loan Disbursement' : 'Loan Repayment',
            purpose: tx.loan?.purpose || null,
            amount: Number(tx.amount) * (tx.type === 'REPAYMENT' ? -1 : 1),
            type: tx.type,
            // Fixed: was hardcoded 'Completed' for everything before, which
            // disagreed with payments.controller.js's Disbursement="Approved"
            // / Repayment="Completed" distinction. Now consistent across
            // both pages.
            status: tx.type === 'DISBURSEMENT' ? 'Approved' : 'Completed',
        }));

        res.json({
            current_balance: currentBalance,
            active_loans: activeLoansCount,
            next_payment: nextPayment,
            repayment_progress: repaymentProgress,
            recent_transactions: formattedTransactions,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = { getDashboardSummary };