const { creditQueue } = require('../queues/creditQueue');
const prisma = require('../lib/prisma');
const Redis = require('ioredis');
const subscriber = new Redis();
const { broadcast } = require('../lib/websocket'); // Import native WebSocket broadcast

const getBorrowers = async (req, res) => {
    try {
        const { search, kyc_status, page = 1, limit = 10 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const where = {
            is_admin: false,
            ...(kyc_status && kyc_status !== 'ALL' && { kyc_status }),
            ...(search && {
                OR: [
                    { full_name: { contains: search, mode: 'insensitive' } },
                    { email: { contains: search, mode: 'insensitive' } },
                ],
            }),
        };

        const [borrowers, total] = await Promise.all([
            prisma.user.findMany({
                where,
                skip,
                take: Number(limit),
                orderBy: { id: 'desc' },
                select: {
                    id: true,
                    full_name: true,
                    email: true,
                    kyc_status: true,
                    credit_score: true,
                    credit_limit: true,
                    is_verified: true,
                }
            }),
            prisma.user.count({ where }),
        ]);

        res.json({
            borrowers,
            pagination: {
                total,
                page: Number(page),
                limit: Number(limit),
                pages: Math.ceil(total / Number(limit))
            }
        });
    } catch (err) {
        console.error("Admin borrowers fetch error:", err);
        res.status(500).json({ error: err.message || "Failed to fetch borrowers" });
    }
};

const triggerBatchCreditUpdate = async (req, res) => {
    try {
        const job = await creditQueue.add('refresh-all-limits', {}, {
            removeOnComplete: true,
            removeOnFail: false,
        });

        // Broadcast real-time update to all connected admin WebSockets
        broadcast({ type: "admin_data_updated", action: "BATCH_CREDIT_QUEUED", jobId: job.id });

        res.status(202).json({
            message: "Batch credit limit recalculation job queued successfully.",
            job_id: job.id,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const streamAdminEvents = (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    subscriber.subscribe('admin-activity-channel', (err) => {
        if (err) console.error('Failed to subscribe to Redis channel', err);
    });

    subscriber.on('message', (channel, message) => {
        if (channel === 'admin-activity-channel') {
            res.write(`data: ${message}\n\n`);
        }
    });

    req.on('close', () => {
        subscriber.unsubscribe('admin-activity-channel');
    });
};

const getDashboardStats = async (req, res) => {
    try {
        const now = new Date();
        const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);

        // 1. Total Active Loans Amount & Count
        const userAggregation = await prisma.user.aggregate({
            _sum: { credit_limit: true },
            where: { is_admin: false }
        });

        const activeNotesCount = await prisma.user.count({
            where: { is_admin: false }
        });

        // 2. Month-over-Month (MoM) calculation
        const currentMonthUsers = await prisma.user.aggregate({
            _sum: { credit_limit: true },
            where: { is_admin: false, created_at: { gte: startOfCurrentMonth } }
        });

        const lastMonthUsers = await prisma.user.aggregate({
            _sum: { credit_limit: true },
            where: { is_admin: false, created_at: { gte: startOfLastMonth, lte: endOfLastMonth } }
        });

        const currentVal = Number(currentMonthUsers._sum.credit_limit || 0);
        const lastVal = Number(lastMonthUsers._sum.credit_limit || 0);

        let momPercentage = 0;
        if (lastVal > 0) {
            momPercentage = ((currentVal - lastVal) / lastVal) * 100;
        } else if (currentVal > 0) {
            momPercentage = 100;
        }
        const formattedMoM = `${momPercentage >= 0 ? "+" : ""}${momPercentage.toFixed(1)}% MoM`;

        // 3. Platform Liquidity & Vault Pool Calculations
        const totalPool = 50000000; // Define your total platform liquidity pool ceiling (e.g., ₱50M)
        const allocatedAggregation = await prisma.loan.aggregate({
            _sum: { principal_amount: true },
            where: { status: { in: ['ACTIVE', 'APPROVED'] } }
        });
        const allocatedAmount = Number(allocatedAggregation._sum.principal_amount || 0);
        const reserveAmount = Math.max(0, totalPool - allocatedAmount);
        const utilizationRate = totalPool > 0 ? Number(((allocatedAmount / totalPool) * 100).toFixed(1)) : 0;

        // 4. Pending KYC Count
        const pendingKyc = await prisma.user.count({
            where: { kyc_status: 'PENDING' }
        });

        // 5. Portfolio Default Rate & NPL Calculations (PAR > 30 days)
        const defaultedLoansCount = await prisma.loan.count({
            where: { status: 'DEFAULTED' }
        });
        const totalLoansCount = await prisma.loan.count();
        const defaultRate = totalLoansCount > 0 ? Number(((defaultedLoansCount / totalLoansCount) * 100).toFixed(2)) : 0.00;

        const defaultedSumAggregation = await prisma.loan.aggregate({
            _sum: { outstanding_balance: true },
            where: { status: 'DEFAULTED' }
        });
        const nplAmount = Number(defaultedSumAggregation._sum.outstanding_balance || 0);

        res.json({
            totalActiveLoans: userAggregation._sum.credit_limit || 0,
            activeNotesCount,
            activeLoansMoM: formattedMoM,
            totalPool,
            allocatedAmount,
            reserveAmount,
            utilizationRate,
            pendingKyc,
            defaultRate,
            nplAmount,
        });
    } catch (err) {
        console.error("Dashboard stats error:", err);
        res.status(500).json({ error: "Failed to fetch dashboard statistics" });
    }
};

module.exports = { triggerBatchCreditUpdate, getBorrowers, streamAdminEvents, getDashboardStats };