const prisma = require('../lib/prisma');

const getDashboardSummary = async (req, res) => {
    try {
        const userId = req.user.id;

        // --- Current Balance + Active Loans count ---
        const activeLoans = await prisma.loan.findMany({
            where: { user_id: userId, status: 'ACTIVE' },
        });

        const activeLoansCount = activeLoans.length;
        const currentBalance = activeLoans.reduce(
            (sum, loan) => sum + Number(loan.outstanding_balance),
            0
        );

        // --- Next Payment: earliest unpaid/partially-paid installment
        // across the user's active loans ---
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

        // --- Repayment Progress: total REPAYMENT amount per calendar
        // month, trailing 9 months ---
        // NOTE: grouped in JS rather than a DB-level "group by month" query
        // — fine at dashboard scale; if transaction volume grows large,
        // this is a good candidate to move to a raw SQL query instead.
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
            const key = tx.created_at.toISOString().slice(0, 7); // "YYYY-MM"
            monthlyTotals[key] = (monthlyTotals[key] || 0) + Number(tx.amount);
        }

        const repaymentProgress = Object.entries(monthlyTotals)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([month, total]) => ({ month, total_paid: total }));

        // --- Recent Transactions ---
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
            // Repayments shown as negative (money leaving the borrower),
            // disbursements as positive (money received) — matches the
            // mockup's -$325.00 / +$5,000.00 convention.
            amount: Number(tx.amount) * (tx.type === 'REPAYMENT' ? -1 : 1),
            type: tx.type,
            status: 'Completed', // no pending/failed transaction states exist in the schema yet
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