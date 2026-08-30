const prisma = require('../lib/prisma');

// --- Credit scoring ---
// This is a simplified, fully-explainable heuristic based on this
// platform's own loan/payment history — NOT a real credit bureau score
// (FICO/VantageScore). Do not present this as an official score or use it
// for real credit decisions without legal/compliance review — US lending
// is governed by fair-lending laws (ECOA, FCRA) that this does not attempt
// to satisfy. Computed fresh on every request rather than stored, since
// it's fully derivable from existing data and would go stale otherwise.

const BASE_SCORE = 600;
const MIN_SCORE = 300;
const MAX_SCORE = 850;

async function computeCreditScore(userId) {
    const loans = await prisma.loan.findMany({
        where: { user_id: userId, status: { in: ['ACTIVE', 'COMPLETED', 'DEFAULTED'] } },
    });

    const installments = await prisma.installment.findMany({
        where: { loan: { user_id: userId } },
    });

    let score = BASE_SCORE;
    const now = new Date();

    for (const inst of installments) {
        const isPastDue = new Date(inst.due_date) <= now;

        if (inst.status === 'PAID') {
            const paidOnTime = inst.paid_at && new Date(inst.paid_at) <= new Date(inst.due_date);
            score += paidOnTime ? 3 : -5;
        } else if (isPastDue) {
            // Due date has passed and it's still unpaid/partially paid
            score -= 8;
        }
    }

    for (const loan of loans) {
        if (loan.status === 'COMPLETED') score += 20;
        if (loan.status === 'DEFAULTED') score -= 120;
    }

    const totalBorrowed = loans.reduce((sum, l) => sum + Number(l.principal_amount), 0);
    const currentOutstanding = loans
        .filter((l) => l.status === 'ACTIVE')
        .reduce((sum, l) => sum + Number(l.outstanding_balance), 0);

    if (totalBorrowed > 0) {
        const utilization = currentOutstanding / totalBorrowed;
        if (utilization > 0.8) score -= 15;
        else if (utilization < 0.3 && currentOutstanding > 0) score += 5;
    }

    return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(score)));
}

function ratingLabel(score) {
    if (score >= 800) return 'Exceptional';
    if (score >= 740) return 'Excellent';
    if (score >= 670) return 'Good';
    if (score >= 580) return 'Fair';
    return 'Poor';
}

// Tiered credit limit derived from score. Placeholder business rule — real
// underwriting would also weigh income, existing debt elsewhere, etc.
function creditLimitForScore(score) {
    if (score >= 800) return 50000;
    if (score >= 740) return 20000;
    if (score >= 670) return 10000;
    if (score >= 580) return 5000;
    return 1000;
}

const getProfile = async (req, res) => {
    try {
        const user = await prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const score = await computeCreditScore(user.id);

        res.json({
            full_name: user.full_name || `${user.first_name} ${user.last_name}`.trim(),
            email: user.email,
            phone_number: user.phone_number,
            kyc_status: user.kyc_status,
            credit_score: score,
            credit_rating: ratingLabel(score),
            credit_limit: creditLimitForScore(score),
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// Only full_name is editable here — email and phone are intentionally left
// out, since they're tied to login/OTP verification and shouldn't change
// without a stronger re-verification flow than a plain profile edit.
const updateProfile = async (req, res) => {
    try {
        const { full_name } = req.body;
        if (!full_name || !full_name.trim()) {
            return res.status(400).json({ error: 'Full name is required.' });
        }

        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: { full_name: full_name.trim() },
        });

        res.json({ message: 'Profile updated.', full_name: user.full_name });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = { getProfile, updateProfile };