const { creditQueue } = require('../queues/creditQueue');
const prisma = require('../lib/prisma');
const Redis = require('ioredis');
const subscriber = new Redis();

const getBorrowers = async (req, res) => {
    try {
        const { search, kyc_status, page = 1, limit = 10 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const where = {
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
                include: {
                    loans: {
                        select: { id: true, status: true, principal_amount: true, outstanding_balance: true }
                    }
                },
                skip,
                take: Number(limit),
                orderBy: { created_at: 'desc' },
            }),
            prisma.user.count({ where }),
        ]);

        res.json({
            borrowers,
            pagination: { total, page: Number(page), pages: Math.ceil(total / Number(limit)) }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const triggerBatchCreditUpdate = async (req, res) => {
    try {
        const job = await creditQueue.add('refresh-all-limits', {}, {
            removeOnComplete: true,
            removeOnFail: false,
        });

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

module.exports = { triggerBatchCreditUpdate, getBorrowers, streamAdminEvents };