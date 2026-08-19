const prisma = require('../lib/prisma');

// Placeholder business rule — move to a proper loan-product config/table
// once you have more than one rate tier.
const FLAT_INTEREST_RATE = 5.00; // percent

const createLoan = async (req, res) => {
    try {
        const { principal_amount, term_months, purpose } = req.body;
        const userId = req.user.id; // populated by the auth middleware

        const principal = Number(principal_amount);
        const totalInterest = principal * (FLAT_INTEREST_RATE / 100);
        const totalRepayable = principal + totalInterest;
        // Rounded for display now. NOTE: when installments are actually
        // generated at approval time, don't just repeat this monthly figure
        // term_months times — rounding N installments independently can
        // leave the sum a few cents off total_repayable. Standard fix: the
        // last installment absorbs whatever remainder is left over.
        const monthlyInstallment = Math.round((totalRepayable / term_months) * 100) / 100;

        const loan = await prisma.loan.create({
            data: {
                user_id: userId,
                purpose: purpose || null,
                principal_amount: principal,
                interest_rate: FLAT_INTEREST_RATE,
                term_months,
                monthly_installment: monthlyInstallment,
                total_repayable: totalRepayable,
                total_paid: 0,
                outstanding_balance: totalRepayable,
                status: 'PENDING',
            },
        });

        res.status(201).json({ message: 'Loan application submitted.', loan });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ⚠️ SECURITY GAP: this only requires `authenticate` (any logged-in user),
// not an admin/staff role — there is no role system in this app yet. As
// written, ANY authenticated user could approve ANY loan, including their
// own. Do not expose this to regular users in the frontend until a proper
// role check gates it. See note where this is registered in loan.routes.js.
const approveLoan = async (req, res) => {
    try {
        const loanId = Number(req.params.id);

        const loan = await prisma.loan.findUnique({ where: { id: loanId } });
        if (!loan) {
            return res.status(404).json({ error: 'Loan not found.' });
        }
        if (loan.status !== 'PENDING') {
            return res.status(400).json({
                error: `Loan cannot be approved from status "${loan.status}".`,
            });
        }

        const now = new Date();
        const monthlyInstallment = Number(loan.monthly_installment);
        const totalRepayable = Number(loan.total_repayable);
        const termMonths = loan.term_months;

        // Build the installment schedule. Every installment but the last
        // uses the stored monthly figure; the last one absorbs whatever
        // rounding remainder is left, so the schedule's sum always exactly
        // equals total_repayable (independently rounding every installment
        // can otherwise leave the total a few cents off).
        const installmentsData = [];
        let runningTotal = 0;
        for (let i = 1; i <= termMonths; i++) {
            const dueDate = new Date(now);
            dueDate.setMonth(dueDate.getMonth() + i);

            const isLast = i === termMonths;
            const amountDue = isLast
                ? Math.round((totalRepayable - runningTotal) * 100) / 100
                : monthlyInstallment;

            runningTotal += amountDue;

            installmentsData.push({
                loan_id: loanId,
                installment_number: i,
                due_date: dueDate,
                amount_due: amountDue,
                amount_paid: 0,
                status: 'PENDING',
            });
        }

        // All-or-nothing: the loan status change, the full installment
        // schedule, and the disbursement transaction must succeed together.
        // Without wrapping this in a transaction, a mid-operation failure
        // could leave a loan marked ACTIVE with no installments generated.
        const result = await prisma.$transaction(async (tx) => {
            const updatedLoan = await tx.loan.update({
                where: { id: loanId },
                data: {
                    status: 'ACTIVE',
                    approved_at: now,
                    disbursed_at: now,
                },
            });

            await tx.installment.createMany({ data: installmentsData });

            await tx.transaction.create({
                data: {
                    loan_id: loanId,
                    user_id: loan.user_id,
                    type: 'DISBURSEMENT',
                    amount: loan.principal_amount,
                    description: 'Loan disbursed',
                },
            });

            return updatedLoan;
        });

        res.json({ message: 'Loan approved and disbursed.', loan: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = { createLoan, approveLoan };