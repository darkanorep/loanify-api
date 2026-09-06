// NOTE: import path must match your generator's `output` in schema.prisma.
// Your generator block:
//   generator client {
//     provider = "prisma-client-js"
//     output   = "../generated/prisma"
//   }
// so from prisma/seed.mjs, the relative path is:
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import crypto from 'crypto';

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
    // Prisma v6 used a 5s connection timeout by default; the `pg` driver's
    // own default is 0 (no timeout). Setting this explicitly avoids a hung
    // seed script if the DB is unreachable.
    connectionTimeoutMillis: 5000,
});

const prisma = new PrismaClient({ adapter });

// ---- Config (overridable via env for quick local smoke tests) -------------
const TOTAL_USERS = Number(process.env.SEED_TOTAL_USERS ?? 20000);
const BATCH_SIZE = Number(process.env.SEED_BATCH_SIZE ?? 1000);
const STATIC_HASHED_PASSWORD =
    '$2b$10$TKh8H1.PfQx37YgCzwiKb.KjNyWgaHb9cbcoQgdIVFlYg7B77UdFm';

// Weighted distribution — more realistic than uniform random for dev data
// that's meant to exercise dashboards, filters, and reports.
const KYC_WEIGHTS = [
    { status: 'VERIFIED', weight: 50 },
    { status: 'PENDING', weight: 25 },
    { status: 'NOT_STARTED', weight: 20 },
    { status: 'REJECTED', weight: 5 },
];

function buildWeightedPool(weights) {
    const pool = [];
    for (const { status, weight } of weights) {
        for (let i = 0; i < weight; i++) pool.push(status);
    }
    return pool;
}

const kycPool = buildWeightedPool(KYC_WEIGHTS);

// Small pools for readable, semi-realistic test names. Not exhaustive —
// this is dev/test data, not a name-generation library.
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

function randomKycStatus() {
    return kycPool[Math.floor(Math.random() * kycPool.length)];
}

function randomCreditScore() {
    return Math.floor(Math.random() * (850 - 500 + 1)) + 500;
}

function randomCreditLimit() {
    // Round to 2 decimal places — this is a monetary field.
    const raw = Math.random() * 49500 + 500;
    return Math.round(raw * 100) / 100;
}

function randomFrom(pool) {
    return pool[Math.floor(Math.random() * pool.length)];
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
        kyc_status: randomKycStatus(),
        credit_score: randomCreditScore(),
        credit_limit: randomCreditLimit(),
        is_admin: false,
    };
}

async function main() {
    console.log(`🌱 Starting database seeding for ${TOTAL_USERS} users...`);
    console.log(`   Batch size: ${BATCH_SIZE}`);

    const startedAt = Date.now();
    let seededCount = 0;

    for (let i = 0; i < TOTAL_USERS; i += BATCH_SIZE) {
        const currentBatchSize = Math.min(BATCH_SIZE, TOTAL_USERS - i);
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
                `Progress: ${i + currentBatchSize} / ${TOTAL_USERS} attempted ` +
                `(${result.count} inserted this batch, ${seededCount} total inserted)`
            );
        } catch (err) {
            // Log which batch failed and re-throw — better to stop and know
            // exactly where it broke than to silently skip a chunk of data.
            console.error(
                `❌ Batch failed at offset ${i} (rows ${i + 1}-${i + currentBatchSize})`
            );
            throw err;
        }
    }

    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
        `✨ Seeding completed: ${seededCount} users inserted in ${elapsedSec}s`
    );
}

main()
    .catch((e) => {
        console.error('Seeding error:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
