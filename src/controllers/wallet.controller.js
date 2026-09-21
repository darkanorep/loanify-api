const prisma = require('../lib/prisma');
const crypto = require('crypto');
const { broadcast } = require('../lib/websocket');
require('dotenv').config();

const PAYMONGO_SECRET_KEY = process.env.PAYMONGO_SECRET_KEY;
/**
 * Initiate PayMongo Sandbox Checkout (GCash, Maya, & Card)
 * POST /api/wallet/paymongo-topup
 */
const initiatePaymongoTopup = async (req, res) => {
    try {
        const { amount, gateway } = req.body;
        const userId = req.user.id;

        const parsedAmount = Math.round(parseFloat(amount) * 100);
        if (isNaN(parsedAmount) || parsedAmount < 10000) {
            return res.status(400).json({ error: "Minimum top-up amount is ₱100." });
        }

        const selectedGateway = String(gateway).toUpperCase();
        const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";

        // Determine correct channel for PayMongo
        let channelType = 'gcash';
        if (selectedGateway === 'MAYA') channelType = 'paymaya';
        if (selectedGateway === 'CARD') channelType = 'card';

        const response = await fetch("https://api.paymongo.com/v1/checkout_sessions", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`
            },
            body: JSON.stringify({
                data: {
                    attributes: {
                        amount: parsedAmount,
                        currency: "PHP",
                        payment_method_types: [channelType],
                        success_url: `${baseUrl}/payment-success.html`,
                        cancel_url: `${baseUrl}/payment-failed.html`,
                        description: `Sandbox Loanify ${selectedGateway} Wallet Top-Up`,
                        line_items: [
                            {
                                name: `${selectedGateway} Sandbox Cash-In`,
                                amount: parsedAmount,
                                currency: "PHP",
                                quantity: 1
                            }
                        ],
                        metadata: {
                            userId: userId.toString(),
                            environment: "sandbox_simulation"
                        }
                    }
                }
            })
        });

        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.errors?.[0]?.detail || "Failed to create Sandbox simulation session.");
        }

        return res.json({
            checkoutUrl: data.data.attributes.checkout_url,
            sourceId: data.data.id
        });

    } catch (err) {
        console.error("PayMongo Sandbox error:", err);
        return res.status(500).json({ error: err.message });
    }
};

/**
 * Verify PayMongo Sandbox Payment & Update Prisma Wallet
 * POST /api/wallet/paymongo-verify
 */
const verifyPaymongoTopup = async (req, res) => {
    try {
        const { sourceId } = req.body;
        const userId = req.user.id;

        if (!sourceId) {
            return res.status(400).json({ error: "Source or Session ID is required." });
        }

        const authHeader = `Basic ${Buffer.from(PAYMONGO_SECRET_KEY + ":").toString("base64")}`;

        // Fetch Checkout Session details from PayMongo
        const sessionRes = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${sourceId}`, {
            headers: { "Authorization": authHeader }
        });
        const sessionData = await sessionRes.json();

        if (!sessionRes.ok || !sessionData?.data) {
            return res.status(400).json({ error: "Unable to verify Sandbox Checkout session." });
        }

        const session = sessionData.data;

        // Safely extract and parse amount
        const rawAmount = session.attributes.amount || session.attributes.line_items?.[0]?.amount || 0;
        const amountInPhp = parseFloat(rawAmount) / 100;

        if (isNaN(amountInPhp) || amountInPhp <= 0) {
            return res.status(400).json({ error: "Invalid payment amount retrieved from session." });
        }

        // Map PayMongo channel name to Prisma PaymentGateway enum
        const rawChannel = session.attributes.payment_method_types?.[0]?.toUpperCase() || '';
        let channel = 'GCASH';
        if (rawChannel === 'PAYMAYA' || rawChannel === 'MAYA') channel = 'MAYA';
        if (rawChannel === 'CARD') channel = 'CARD';

        const referenceNo = `SANDBOX-${sourceId.slice(-8).toUpperCase()}`;

        // 1. Prevent duplicate balance updates
        const existingTx = await prisma.walletTransaction.findUnique({
            where: { reference_no: referenceNo }
        });

        if (existingTx) {
            const wallet = await prisma.wallet.findUnique({ where: { user_id: userId } });
            return res.json({ message: "Sandbox transaction already credited.", wallet, transaction: existingTx });
        }

        // 2. Atomically credit Prisma Wallet
        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.upsert({
                where: { user_id: userId },
                update: {
                    available_balance: { increment: amountInPhp }
                },
                create: {
                    available_balance: amountInPhp,
                    escrow_balance: 0.00,
                    user: {
                        connect: { id: userId }
                    }
                }
            });

            const transaction = await tx.walletTransaction.create({
                data: {
                    wallet_id: wallet.id,
                    user_id: userId,
                    type: 'TOP_UP',
                    amount: amountInPhp,
                    fee: 0.00,
                    gateway: channel,
                    reference_no: referenceNo,
                    description: `PayMongo Sandbox ${channel} Cash-In`,
                    status: 'COMPLETED'
                }
            });

            return { wallet, transaction };
        });

        // Dynamic badge color based on gateway
        let badgeColor = "text-blue-600 bg-blue-50";
        if (channel === 'MAYA') badgeColor = "text-emerald-600 bg-emerald-50";
        if (channel === 'CARD') badgeColor = "text-indigo-600 bg-indigo-50";

        // 3. Broadcast real-time update
        broadcast({
            type: "admin_data_updated",
            action: "WALLET_TOPUP",
            newEvent: {
                id: result.transaction.id,
                title: `Sandbox Top-Up Completed`,
                desc: `₱${amountInPhp.toLocaleString()} credited to wallet.`,
                time: "Just now",
                source: referenceNo,
                color: badgeColor
            }
        });

        return res.json({
            message: "Sandbox wallet balance updated successfully.",
            wallet: result.wallet,
            transaction: result.transaction
        });

    } catch (err) {
        console.error("PayMongo Sandbox verification error:", err);
        return res.status(500).json({ error: err.message || "Failed to verify Sandbox payment." });
    }
};

/**
 * Mock Direct Simulation Endpoint (No External Requests)
 * POST /api/wallet/topup
 */
const handleWalletTopUp = async (req, res) => {
    try {
        const { amount, gateway } = req.body;
        const userId = req.user.id;

        const parsedAmount = parseFloat(amount);
        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: "Invalid top-up amount. Must be greater than ₱0." });
        }

        const validGateways = ['GCASH', 'MAYA', 'CARD', 'INSTAPAY', 'INTERNAL_VAULT'];
        const selectedGateway = validGateways.includes(gateway) ? gateway : 'GCASH';

        const refPrefix = selectedGateway === 'CARD' ? 'CARD' : (selectedGateway === 'MAYA' ? 'MAYA' : 'GCSH');
        const referenceNo = `${refPrefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

        const result = await prisma.$transaction(async (tx) => {
            const wallet = await tx.wallet.upsert({
                where: { user_id: userId },
                update: { available_balance: { increment: parsedAmount } },
                create: {
                    available_balance: parsedAmount,
                    escrow_balance: 0.00,
                    user: { connect: { id: userId } }
                }
            });

            const transaction = await tx.walletTransaction.create({
                data: {
                    wallet_id: wallet.id,
                    user_id: userId,
                    type: 'TOP_UP',
                    amount: parsedAmount,
                    fee: 0.00,
                    gateway: selectedGateway,
                    reference_no: referenceNo,
                    description: `Mock ${selectedGateway} Local Sandbox Top-Up`,
                    status: 'COMPLETED'
                }
            });

            return { wallet, transaction };
        });

        let badgeColor = "text-blue-600 bg-blue-50";
        if (selectedGateway === 'MAYA') badgeColor = "text-emerald-600 bg-emerald-50";
        if (selectedGateway === 'CARD') badgeColor = "text-indigo-600 bg-indigo-50";

        broadcast({
            type: "admin_data_updated",
            action: "WALLET_TOPUP",
            newEvent: {
                id: result.transaction.id,
                title: `${selectedGateway} Local Sandbox Completed`,
                desc: `₱${parsedAmount.toLocaleString()} deposited to wallet.`,
                time: "Just now",
                source: referenceNo,
                color: badgeColor
            }
        });

        return res.json({
            message: `Mock ${selectedGateway} simulation completed successfully.`,
            wallet: result.wallet,
            transaction: result.transaction
        });

    } catch (err) {
        console.error("Local simulation error:", err);
        return res.status(500).json({ error: "Failed to process local simulation top-up." });
    }
};

/**
 * Get Wallet Overview & Transactions
 * GET /api/wallet/overview
 */
const getWalletOverview = async (req, res) => {
    try {
        const userId = req.user.id;

        let wallet = await prisma.wallet.findUnique({
            where: { user_id: userId }
        });

        if (!wallet) {
            wallet = await prisma.wallet.create({
                data: {
                    available_balance: 0.00,
                    escrow_balance: 0.00,
                    user: { connect: { id: userId } }
                }
            });
        }

        const transactions = await prisma.walletTransaction.findMany({
            where: { user_id: userId },
            orderBy: { created_at: 'desc' },
            take: 15
        });

        return res.json({
            id: wallet.id,
            available_balance: wallet.available_balance,
            escrow_balance: wallet.escrow_balance,
            transactions
        });
    } catch (err) {
        console.error("Fetch wallet overview error:", err);
        return res.status(500).json({ error: "Failed to retrieve wallet information." });
    }
};

module.exports = {
    initiatePaymongoTopup,
    verifyPaymongoTopup,
    handleWalletTopUp,
    getWalletOverview
};