const prisma = require('../lib/prisma');
const crypto = require('crypto');
const { broadcast } = require('../lib/websocket');

// 1. Fetch current user wallet balance & recent transactions
const getWalletOverview = async (req, res) => {
    try {
        const userId = req.user.id;

        let wallet = await prisma.wallet.findUnique({
            where: { user_id: userId }
        });

        if (!wallet) {
            wallet = await prisma.wallet.create({
                data: { user_id: userId, available_balance: 0, escrow_balance: 0 }
            });
        }

        const transactions = await prisma.walletTransaction.findMany({
            where: { user_id: userId },
            take: 15,
            orderBy: { created_at: 'desc' },
            include: { loan: { select: { id: true, purpose: true } } }
        });

        res.json({
            availableBalance: Number(wallet.available_balance),
            escrowBalance: Number(wallet.escrow_balance),
            totalBalance: Number(wallet.available_balance) + Number(wallet.escrow_balance),
            transactions
        });
    } catch (err) {
        console.error("Wallet overview error:", err);
        res.status(500).json({ error: "Failed to retrieve wallet information." });
    }
};

// 2. Process Gateway Top-Up (GCash / Maya)
const processTopUp = async (req, res) => {
    const { amount, gateway } = req.body;
    const userId = req.user.id;

    if (!amount || Number(amount) <= 0) {
        return res.status(400).json({ error: "Invalid top-up amount." });
    }

    try {
        const referenceNo = `TOP-${gateway}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.upsert({
                where: { user_id: userId },
                update: { available_balance: { increment: amount } },
                create: { user_id: userId, available_balance: amount, escrow_balance: 0 }
            });

            const transaction = await tx.walletTransaction.create({
                data: {
                    wallet_id: wallet.id,
                    user_id: userId,
                    type: 'TOP_UP',
                    amount,
                    gateway: gateway || 'GCash Direct',
                    reference_no: referenceNo,
                    description: `Wallet top-up via ${gateway || 'GCash'}`,
                    status: 'COMPLETED'
                }
            });

            return { wallet, transaction };
        });

        // Real-time broadcast notification
        broadcast({
            type: "admin_data_updated",
            action: "LIVE_STREAM_EVENT",
            newEvent: {
                id: result.transaction.id,
                title: `Wallet Top-Up Cleared`,
                desc: `User submitted ₱${Number(amount).toLocaleString()} via ${gateway || 'GCash Direct'}.`,
                time: "Just now",
                source: referenceNo,
                color: "text-emerald-600 bg-emerald-50"
            }
        });

        res.json({
            message: `Successfully topped up ₱${Number(amount).toLocaleString()} via ${gateway}.`,
            balance: Number(result.wallet.available_balance),
            referenceNo
        });
    } catch (err) {
        console.error("Top-up error:", err);
        res.status(500).json({ error: "Top-up process failed." });
    }
};

module.exports = { getWalletOverview, processTopUp };