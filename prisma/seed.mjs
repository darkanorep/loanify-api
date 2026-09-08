// NOTE: import path must match your generator's `output` in schema.prisma.
// Your generator block:
//   generator client {
//     provider = "prisma-client-js"
//     output   = "../generated/prisma"
//   }
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcrypt'; // or bcryptjs
import crypto from 'crypto';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { broadcast } = require('../src/lib/websocket.js');

// ---- Safety guard: never allow this to run against production -------------
if (process.env.NODE_ENV === 'production') {
    console.error('❌ Refusing to run seeder: NODE_ENV=production');
    process.exit(1);
}

if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set. Aborting.');
    process.exit(1);
}

// ---- Prisma 7: driver adapter is required, there is no default engine -----
const adapter = new PrismaPg({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
});

const prisma = new PrismaClient({ adapter });

// =============================================================================
// Shared helpers
// =============================================================================
function buildWeightedPool(weights) {
    const pool = [];
    for (const { value, weight } of weights) {
        for (let i = 0; i < weight; i++) pool.push(value);
    }
    return pool;
}

function randomFrom(pool) {
    return pool[Math.floor(Math.random() * pool.length)];
}

function randomBetween(min, max) {
    return Math.random() * (max - min) + min;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

function daysAgo(days) {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d;
}

function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
}

function clampToNow(date) {
    const now = new Date();
    return date.getTime() > now.getTime() ? now : date;
}

// =============================================================================
// PHASE 1 — Users
// =============================================================================
const TOTAL_USERS = Number(process.env.SEED_TOTAL_USERS ?? 10);
const USER_INSERT_BATCH_SIZE = Number(process.env.SEED_BATCH_SIZE ?? 1000);
const STATIC_HASHED_PASSWORD = await bcrypt.hash('Test1234!', 10);

const KYC_WEIGHTS = [
    { value: 'VERIFIED', weight: 50 },
    { value: 'PENDING', weight: 25 },
    { value: 'NOT_STARTED', weight: 20 },
    { value: 'REJECTED', weight: 5 },
];
const kycPool = buildWeightedPool(KYC_WEIGHTS);

const FIRST_NAMES = [
    'James', 'Maria', 'Juan', 'Anna', 'Carlos', 'Sofia', 'Miguel', 'Isabella',
    'Antonio', 'Camille', 'Rafael', 'Andrea', 'Diego', 'Patricia', 'Marco',
    'Angela', 'Luis', 'Christine', 'Paolo', 'Michelle',
];
const LAST_NAMES = [
    'Santos', 'Reyes', 'Cruz', 'Bautista', 'Ocampo', 'Garcia', 'Torres',
    'Flores', 'Ramos', 'Mendoza', 'Castillo', 'Villanueva', 'Delacruz',
    'Aquino', 'Fernandez', 'Rivera', 'Gonzales', 'Domingo', 'Salazar', 'Pascual',
];

function randomCreditScore() {
    return Math.floor(Math.random() * (850 - 500 + 1)) + 500;
}

function randomCreditLimit() {
    return round2(randomBetween(500, 50000));
}

function buildUserRow(index) {
    const uniqueHash = crypto.randomBytes(4).toString('hex');
    const firstName = randomFrom(FIRST_NAMES);
    const lastName = randomFrom(LAST_NAMES);

    return {
        first_name: firstName,
        last_name: lastName,
        full_name: `${firstName} ${lastName}`,
        email: `borrower_${index}_${uniqueHash}@loanify.test`,
        username: `user_${index}_${uniqueHash}`,
        password: STATIC_HASHED_PASSWORD,
        is_verified: true,
        kyc_status: randomFrom(kycPool),
        credit_score: randomCreditScore(),
        credit_limit: randomCreditLimit(),
        is_admin: false,
    };
}

async function seedUsers() {
    console.log(`🌱 [Users] Seeding ${TOTAL_USERS} users...`);
    const startedAt = Date.now();
    let seededCount = 0;

    for (let i = 0; i < TOTAL_USERS; i += USER_INSERT_BATCH_SIZE) {
        const currentBatchSize = Math.min(USER_INSERT_BATCH_SIZE, TOTAL_USERS - i);
        const batch = Array.from({ length: currentBatchSize }, (_, j) =>
            buildUserRow(i + j + 1)
        );

        try {
            const result = await prisma.user.createMany({
                data: batch,
                skipDuplicates: true,
            });
            seededCount += result.count;
            console.log(
                `[Users] Progress: ${i + currentBatchSize} / ${TOTAL_USERS} attempted ` +
                `(${result.count} inserted this batch, ${seededCount} total)`
            );
        } catch (err) {
            console.error(`❌ [Users] Batch failed at offset ${i}`);
            throw err;
        }
    }

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`✨ [Users] Done: ${seededCount} users inserted in ${elapsedSec}s`);
}

// =============================================================================
// PHASE 2 — Loans, Installments, Transactions
// =============================================================================
const LOAN_USER_BATCH_SIZE = Number(process.env.SEED_LOAN_USER_BATCH_SIZE ?? 500);

const TERM_OPTIONS = [3, 6, 9, 12, 18, 24];
const MONTHLY_RATE_MIN = 1.5; // Assumption: flat MONTHLY rate, not annual/APR.
const MONTHLY_RATE_MAX = 5.0;
const PRINCIPAL_MIN = 5000;
const PRINCIPAL_MAX = 50000;

const LOAN_PURPOSES = [
    'Medical expenses', 'Home renovation', 'Education', 'Business capital',
    'Debt consolidation', 'Emergency expenses', 'Travel', 'Wedding',
    null, null, // weight toward "no purpose given" being fairly common
];

const LOAN_COUNT_WEIGHTS = [
    { value: 0, weight: 35 },
    { value: 1, weight: 45 },
    { value: 2, weight: 20 },
];
const loanCountPool = buildWeightedPool(LOAN_COUNT_WEIGHTS);

const LOAN_STATUS_WEIGHTS = [
    { value: 'PENDING', weight: 10 },
    { value: 'APPROVED', weight: 8 },
    { value: 'ACTIVE', weight: 30 },
    { value: 'COMPLETED', weight: 35 },
    { value: 'REJECTED', weight: 7 },
    { value: 'DEFAULTED', weight: 5 },
    { value: 'CANCELLED', weight: 5 },
];
const loanStatusPool = buildWeightedPool(LOAN_STATUS_WEIGHTS);

function buildLoanPlan(userId) {
    const status = randomFrom(loanStatusPool);
    const principal = round2(randomBetween(PRINCIPAL_MIN, PRINCIPAL_MAX));
    const rate = round2(randomBetween(MONTHLY_RATE_MIN, MONTHLY_RATE_MAX));
    const termMonths = randomFrom(TERM_OPTIONS);

    const totalInterest = round2(principal * (rate / 100) * termMonths);
    const totalRepayable = round2(principal + totalInterest);

    const baseInstallment = Math.floor((totalRepayable / termMonths) * 100) / 100;
    const lastInstallment = round2(totalRepayable - baseInstallment * (termMonths - 1));

    let appliedAt;
    let approvedAt = null;
    let disbursedAt = null;
    let completedAt = null;
    let isDisbursed = false;

    switch (status) {
        case 'PENDING':
            appliedAt = daysAgo(randomBetween(1, 30));
            break;

        case 'APPROVED':
            appliedAt = daysAgo(randomBetween(5, 40));
            approvedAt = new Date(appliedAt.getTime() + randomBetween(1, 3) * 86400000);
            break;

        case 'REJECTED':
            appliedAt = daysAgo(randomBetween(5, 60));
            break;

        case 'CANCELLED':
            appliedAt = daysAgo(randomBetween(5, 60));
            approvedAt =
                Math.random() < 0.5
                    ? new Date(appliedAt.getTime() + randomBetween(1, 3) * 86400000)
                    : null;
            break;

        case 'ACTIVE':
            appliedAt = daysAgo(randomBetween(30, 300));
            approvedAt = new Date(appliedAt.getTime() + randomBetween(1, 3) * 86400000);
            disbursedAt = new Date(approvedAt.getTime() + randomBetween(1, 2) * 86400000);
            isDisbursed = true;
            break;

        case 'COMPLETED': {
            const minDaysAgo = termMonths * 31 + 90;
            const maxDaysAgo = termMonths * 31 + 400;
            appliedAt = daysAgo(randomBetween(minDaysAgo, maxDaysAgo));
            approvedAt = new Date(appliedAt.getTime() + randomBetween(1, 3) * 86400000);
            disbursedAt = new Date(approvedAt.getTime() + randomBetween(1, 2) * 86400000);
            isDisbursed = true;
            break;
        }

        case 'DEFAULTED':
            appliedAt = daysAgo(randomBetween(200, 500));
            approvedAt = new Date(appliedAt.getTime() + randomBetween(1, 3) * 86400000);
            disbursedAt = new Date(approvedAt.getTime() + randomBetween(1, 2) * 86400000);
            isDisbursed = true;
            break;
    }

    const installmentPlans = [];
    let totalPaid = 0;

    if (isDisbursed) {
        const now = Date.now();

        for (let n = 1; n <= termMonths; n++) {
            const dueDate = addMonths(disbursedAt, n);
            const amountDue = n === termMonths ? lastInstallment : baseInstallment;
            const isDue = dueDate.getTime() <= now;

            let amountPaid = 0;
            let instStatus = 'PENDING';
            let paidAt = null;

            if (status === 'COMPLETED') {
                amountPaid = amountDue;
                instStatus = 'PAID';
                paidAt = clampToNow(new Date(dueDate.getTime() - randomBetween(0, 5) * 86400000));
            } else if (status === 'ACTIVE' && isDue) {
                if (Math.random() < 0.8) {
                    amountPaid = amountDue;
                    instStatus = 'PAID';
                    paidAt = clampToNow(new Date(dueDate.getTime() + randomBetween(0, 3) * 86400000));
                } else {
                    amountPaid = round2(amountDue * randomBetween(0.2, 0.7));
                    instStatus = 'PARTIALLY_PAID';
                    paidAt = clampToNow(new Date(dueDate.getTime() + randomBetween(0, 3) * 86400000));
                }
            } else if (status === 'DEFAULTED') {
                const paidCutoff = Math.floor(termMonths * randomBetween(0.2, 0.4));
                if (n <= paidCutoff) {
                    amountPaid = amountDue;
                    instStatus = 'PAID';
                    paidAt = clampToNow(new Date(dueDate.getTime() + randomBetween(0, 3) * 86400000));
                }
            }

            totalPaid += amountPaid;
            installmentPlans.push({
                installment_number: n,
                due_date: dueDate,
                amount_due: amountDue,
                amount_paid: amountPaid,
                status: instStatus,
                paid_at: paidAt,
            });
        }

        if (status === 'ACTIVE' && installmentPlans.every((i) => i.status === 'PAID')) {
            const last = installmentPlans[installmentPlans.length - 1];
            totalPaid -= last.amount_paid;
            last.amount_paid = 0;
            last.status = 'PENDING';
            last.paid_at = null;
        }
    }

    totalPaid = round2(totalPaid);
    const outstandingBalance = status === 'COMPLETED' ? 0 : round2(totalRepayable - totalPaid);

    if (status === 'COMPLETED') {
        completedAt = installmentPlans[installmentPlans.length - 1].paid_at;
    }

    const loanRow = {
        user_id: userId,
        purpose: randomFrom(LOAN_PURPOSES),
        principal_amount: principal,
        interest_rate: rate,
        term_months: termMonths,
        monthly_installment: baseInstallment,
        total_repayable: totalRepayable,
        total_paid: totalPaid,
        outstanding_balance: outstandingBalance,
        status,
        applied_at: appliedAt,
        approved_at: approvedAt,
        disbursed_at: disbursedAt,
        completed_at: completedAt,
    };

    return {
        loanRow,
        installmentPlans,
        disbursement: isDisbursed ? { amount: principal, created_at: disbursedAt } : null,
    };
}

async function seedLoans() {
    console.log('🌱 [Loans] Seeding loans, installments, and transactions...');

    const users = await prisma.user.findMany({ select: { id: true } });
    console.log(`[Loans] Found ${users.length} users.`);

    let totalLoans = 0;
    let totalInstallments = 0;
    let totalTransactions = 0;

    for (let i = 0; i < users.length; i += LOAN_USER_BATCH_SIZE) {
        const userBatch = users.slice(i, i + LOAN_USER_BATCH_SIZE);

        const plans = [];
        for (const { id: userId } of userBatch) {
            const loanCount = randomFrom(loanCountPool);
            for (let k = 0; k < loanCount; k++) {
                plans.push(buildLoanPlan(userId));
            }
        }

        if (plans.length === 0) continue;

        try {
            const insertedLoans = await prisma.loan.createManyAndReturn({
                data: plans.map((p) => p.loanRow),
                select: { id: true },
            });

            if (insertedLoans.length !== plans.length) {
                throw new Error(
                    `Row count mismatch: expected ${plans.length} loans, got ${insertedLoans.length}`
                );
            }

            const installmentRows = [];
            const disbursementTxRows = [];

            plans.forEach((plan, idx) => {
                const loanId = insertedLoans[idx].id;
                for (const inst of plan.installmentPlans) {
                    installmentRows.push({ ...inst, loan_id: loanId });
                }
                if (plan.disbursement) {
                    disbursementTxRows.push({
                        loan_id: loanId,
                        user_id: plan.loanRow.user_id,
                        type: 'DISBURSEMENT',
                        amount: plan.disbursement.amount,
                        description: 'Loan disbursement',
                        created_at: plan.disbursement.created_at,
                    });
                }
            });

            let insertedInstallments = [];
            if (installmentRows.length > 0) {
                insertedInstallments = await prisma.installment.createManyAndReturn({
                    data: installmentRows,
                    select: { id: true, loan_id: true, amount_paid: true, paid_at: true },
                });
            }

            const userIdByLoanId = new Map(
                plans.map((p, idx) => [insertedLoans[idx].id, p.loanRow.user_id])
            );

            const repaymentTxRows = insertedInstallments
                .filter((inst) => Number(inst.amount_paid) > 0)
                .map((inst) => ({
                    loan_id: inst.loan_id,
                    user_id: userIdByLoanId.get(inst.loan_id),
                    installment_id: inst.id,
                    type: 'REPAYMENT',
                    amount: Number(inst.amount_paid),
                    description: 'Installment repayment',
                    created_at: inst.paid_at ?? new Date(),
                }));

            const allTxRows = [...disbursementTxRows, ...repaymentTxRows];
            if (allTxRows.length > 0) {
                await prisma.transaction.createMany({ data: allTxRows });
            }

            totalLoans += insertedLoans.length;
            totalInstallments += insertedInstallments.length;
            totalTransactions += allTxRows.length;

            console.log(
                `[Loans] Users ${Math.min(i + LOAN_USER_BATCH_SIZE, users.length)}/${users.length} — ` +
                `+${insertedLoans.length} loans, +${insertedInstallments.length} installments, ` +
                `+${allTxRows.length} transactions`
            );
        } catch (err) {
            console.error(`❌ [Loans] Batch failed at user offset ${i}`);
            throw err;
        }
    }

    console.log(
        `✨ [Loans] Done: ${totalLoans} loans, ${totalInstallments} installments, ${totalTransactions} transactions`
    );
}

// =============================================================================
// Orchestration
// =============================================================================
async function main() {
    if (process.env.SEED_RESET === 'true') {
        console.log('⚠️  SEED_RESET=true — truncating dependent tables first...');
        await prisma.$executeRawUnsafe(
            'TRUNCATE TABLE "Transaction", "Installment", "Loan", "User" RESTART IDENTITY CASCADE'
        );
    }

    await seedUsers();
    await seedLoans();

    // Notify the running Express server via HTTP so it broadcasts to all active WebSockets
    try {
        await fetch('http://localhost:3000/api/admin/broadcast-seed', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.parse(JSON.stringify({ type: "admin_data_updated", action: "DATABASE_SEEDED" }))
        });
        console.log('📡 Broadcast notification sent to running server.');
    } catch (err) {
        console.warn('⚠️ Could not notify server via HTTP (Is the backend server running?):', err.message);
    }

    console.log('🎉 All seeding phases completed successfully!');
}

main()
    .catch((e) => {
        console.error('Seeding error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });