const { Worker } = require('bullmq');
const prisma = require('../lib/prisma');
const { connection } = require('../queues/creditQueue');

const CHUNK_SIZE = 500;

async function computeCreditScore(userId) {
    // Retains existing heuristic evaluation logic
    const loans = await prisma.loan.findMany({
        where: { user_id: userId, status: { in: ['ACTIVE', 'COMPLETED', 'DEFAULTED'] } },
    });
    const installments = await prisma.installment.findMany({
        where: { loan: { user_id: userId } },
    });
    let score = 600;
    const now = new Date();

    for (const inst of installments) {
        if (inst.status === 'PAID') {
            score += (inst.paid_at && new Date(inst.paid_at) <= new Date(inst.due_date)) ? 3 : -5;
        } else if (new Date(inst.due_date) <= now) {
            score -= 8;
        }
    }
    for (const loan of loans) {
        if (loan.status === 'COMPLETED') score += 20;
        if (loan.status === 'DEFAULTED') score -= 120;
    }
    return Math.max(300, Math.min(850, Math.round(score)));
}

function creditLimitForScore(score) {
    if (score >= 800) return 50000;
    if (score >= 740) return 20000;
    if (score >= 670) return 10000;
    if (score >= 580) return 5000;
    return 500;
}

const worker = new Worker('credit-recalculation', async (job) => {
    let skip = 0;
    let updatedCount = 0;

    while (true) {
        const users = await prisma.user.findMany({
            skip,
            take: CHUNK_SIZE,
            select: { id: true },
        });

        if (users.length === 0) break;

        for (const user of users) {
            const score = await computeCreditScore(user.id);
            const newLimit = creditLimitForScore(score);

            await prisma.user.update({
                where: { id: user.id },
                data: { credit_score: score, credit_limit: newLimit },
            });
            updatedCount++;
        }

        skip += CHUNK_SIZE;
        await job.updateProgress(updatedCount);
    }

    return { updatedCount };
}, { connection });