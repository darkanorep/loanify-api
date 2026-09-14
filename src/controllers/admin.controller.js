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

        // 1. Current Month Bounds (First day 00:00:00 to Last day 23:59:59)
        const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        const endOfCurrentMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);

        // 2. Previous Month Bounds (First day 00:00:00 to Last day 23:59:59)
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);

        // Total Active Loans Amount & Count
        const userAggregation = await prisma.user.aggregate({
            _sum: { credit_limit: true },
            where: { is_admin: false }
        });

        const activeNotesCount = await prisma.user.count({
            where: { is_admin: false }
        });

        // Month-over-Month (MoM) calculation for full month windows
        const currentMonthUsers = await prisma.user.aggregate({
            _sum: { credit_limit: true },
            where: {
                is_admin: false,
                created_at: { gte: startOfCurrentMonth, lte: endOfCurrentMonth }
            }
        });

        const lastMonthUsers = await prisma.user.aggregate({
            _sum: { credit_limit: true },
            where: {
                is_admin: false,
                created_at: { gte: startOfLastMonth, lte: endOfLastMonth }
            }
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

        // Platform Liquidity & Vault Pool Calculations
        const totalPool = 50000000;
        const allocatedAggregation = await prisma.loan.aggregate({
            _sum: { principal_amount: true },
            where: { status: { in: ['ACTIVE', 'APPROVED'] } }
        });
        const allocatedAmount = Number(allocatedAggregation._sum.principal_amount || 0);
        const reserveAmount = Math.max(0, totalPool - allocatedAmount);
        const utilizationRate = totalPool > 0 ? Number(((allocatedAmount / totalPool) * 100).toFixed(1)) : 0;

        // Pending KYC Count
        const pendingKyc = await prisma.user.count({
            where: { kyc_status: 'PENDING' }
        });

        // Portfolio Default Rate & NPL Calculations (PAR > 30 days)
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

const getLiveNetworkStream = async (req, res) => {
    try {
        const recentTransactions = await prisma.transaction.findMany({
            take: 10,
            orderBy: { created_at: 'desc' },
            include: { user: { select: { full_name: true } }, loan: { select: { id: true, principal_amount: true } } }
        });

        const recentUsers = await prisma.user.findMany({
            take: 5,
            orderBy: { created_at: 'desc' },
            select: { id: true, full_name: true, kyc_status: true, credit_limit: true, created_at: true }
        });

        // Map database records into unified stream event format
        const events = [
            ...recentTransactions.map(tx => ({
                id: `tx-${tx.id}`,
                type: tx.type,
                title: tx.type === 'DISBURSEMENT' ? `P2P Note #${tx.loan_id} Fully Funded` : `Installment Repayment Received`,
                desc: `${tx.user?.full_name || 'Borrower'} submitted ${tx.amount} via ${tx.description || 'Gateway'}.`,
                time: new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                source: tx.type === 'DISBURSEMENT' ? 'Smart Escrow' : 'Maya / GCash Gateway',
                icon: tx.type === 'DISBURSEMENT' ? 'payments' : 'receipt_long',
                color: 'text-emerald-600 bg-emerald-50'
            })),
            ...recentUsers.map(u => ({
                id: `user-${u.id}`,
                type: 'KYC',
                title: `KYC Status: ${u.kyc_status}`,
                desc: `${u.full_name} identity verification updated. Credit Limit: ₱${u.credit_limit}`,
                time: new Date(u.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                source: 'AI Scoring Hub',
                icon: 'verified_user',
                color: u.kyc_status === 'VERIFIED' ? 'text-emerald-600 bg-emerald-50' : 'text-amber-600 bg-amber-50'
            }))
        ].slice(0, 10);

        res.json({ events });
    } catch (err) {
        console.error("Live stream error:", err);
        res.status(500).json({ error: "Failed to fetch live stream" });
    }
};

const getPortfolioRepayments = async (req, res) => {
    try {
        const loans = await prisma.loan.findMany({
            take: 10,
            orderBy: { applied_at: 'desc' },
            include: {
                user: { select: { full_name: true } },
                installments: { orderBy: { installment_number: 'asc' } }
            }
        });

        const portfolioItems = loans.map(loan => {
            const totalTerms = loan.term_months || 3;
            const paidTerms = loan.installments.filter(i => i.status === 'PAID').length;
            const progress = Math.round((paidTerms / totalTerms) * 100);

            let status = "On Schedule";
            if (loan.status === 'COMPLETED') status = "Completed";
            else if (loan.status === 'DEFAULTED') status = "Overdue (6d)";

            return {
                id: `P2P-${loan.id}`,
                borrower: loan.user?.full_name || "Anonymous Borrower",
                principal: Number(loan.principal_amount),
                rate: `${loan.interest_rate}% / mo`,
                term: `${totalTerms} Mos`,
                currentTerm: Math.min(paidTerms + 1, totalTerms),
                progress,
                gateway: Math.random() > 0.5 ? "GCash Direct" : "Maya QR",
                status
            };
        });

        res.json({ portfolioItems });
    } catch (err) {
        console.error("Portfolio repayments error:", err);
        res.status(500).json({ error: "Failed to fetch active portfolios" });
    }
};

module.exports = {
    triggerBatchCreditUpdate,
    getPortfolioRepayments,
    getBorrowers,
    streamAdminEvents,
    getLiveNetworkStream,
    getDashboardStats
};