const prisma = require('../lib/prisma');

const makePayment = async (req, res) => {
    try {
        const userId = req.user.id;
        const { loan_id, amount, payment_method_id } = req.body;

        const loan = await prisma.loan.findUnique({ where: { id: loan_id } });
        if (!loan || loan.user_id !== userId) {
            return res.status(404).json({ error: 'Loan not found.' });
        }
        if (loan.status !== 'ACTIVE') {
            return res
                .status(400)
                .json({ error: `Cannot make a payment on a loan with status "${loan.status}".` });
        }

        const paymentMethod = await prisma.paymentMethod.findUnique({
            where: { id: payment_method_id },
        });
        if (!paymentMethod || paymentMethod.user_id !== userId) {
            return res.status(404).json({ error: 'Payment method not found.' });
        }

        const outstanding = Number(loan.outstanding_balance);
        const paymentAmount = Number(amount);

        // Small epsilon tolerance for floating point comparison — without
        // it, a payment of exactly the full balance could get rejected due
        // to a trailing 0.0000000001 rounding artifact.
        if (paymentAmount > outstanding + 0.01) {
            return res.status(400).json({
                error: `Payment exceeds the outstanding balance of $${outstanding.toFixed(2)}.`,
            });
        }

        // Apply the payment to the oldest unpaid/partially-paid
        // installments first, rolling overflow into the next one.
        const installments = await prisma.installment.findMany({
            where: { loan_id, status: { in: ['PENDING', 'PARTIALLY_PAID'] } },
            orderBy: { due_date: 'asc' },
        });

        let remaining = paymentAmount;
        const installmentUpdates = [];
        for (const inst of installments) {
            if (remaining <= 0) break;
            const instRemaining = Number(inst.amount_due) - Number(inst.amount_paid);
            const applied = Math.min(remaining, instRemaining);
            const newPaid = Number(inst.amount_paid) + applied;
            const isFullyPaid = newPaid >= Number(inst.amount_due) - 0.01;

            installmentUpdates.push({
                id: inst.id,
                amount_paid: newPaid,
                status: isFullyPaid ? 'PAID' : 'PARTIALLY_PAID',
                paid_at: isFullyPaid ? new Date() : inst.paid_at,
            });

            remaining -= applied;
        }

        const newTotalPaid = Number(loan.total_paid) + paymentAmount;
        const newOutstanding = Math.max(0, outstanding - paymentAmount);
        const isLoanComplete = newOutstanding <= 0.01;

        // All-or-nothing: installment updates, loan balance update, and the
        // transaction record must succeed together.
        const result = await prisma.$transaction(async (tx) => {
            for (const upd of installmentUpdates) {
                await tx.installment.update({
                    where: { id: upd.id },
                    data: {
                        amount_paid: upd.amount_paid,
                        status: upd.status,
                        paid_at: upd.paid_at,
                    },
                });
            }

            const updatedLoan = await tx.loan.update({
                where: { id: loan_id },
                data: {
                    total_paid: newTotalPaid,
                    outstanding_balance: newOutstanding,
                    status: isLoanComplete ? 'COMPLETED' : loan.status,
                    completed_at: isLoanComplete ? new Date() : loan.completed_at,
                },
            });

            const transaction = await tx.transaction.create({
                data: {
                    loan_id,
                    user_id: userId,
                    type: 'REPAYMENT',
                    amount: paymentAmount,
                    payment_method_id,
                    description: 'Loan repayment',
                },
            });

            return { updatedLoan, transaction };
        });

        res.status(201).json({
            message: 'Payment successful.',
            loan: result.updatedLoan,
            transaction: result.transaction,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = { makePayment };