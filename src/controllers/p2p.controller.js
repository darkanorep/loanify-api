const prisma = require('../lib/prisma');
const { sendToUser, broadcast } = require('../lib/websocket');
const crypto = require("crypto");

// 1. Lender creates a lending advertisement / offer
const createOffer = async (req, res) => {
    try {
        const lenderId = req.user.id;
        const { amount_available, interest_rate, term_months } = req.body;

        const offerAmount = parseFloat(amount_available);
        const parsedRate = parseFloat(interest_rate);
        const parsedTerm = parseInt(term_months);

        if (isNaN(offerAmount) || offerAmount <= 0) {
            return res.status(400).json({ error: "Invalid offer amount." });
        }

        // Check if the user already has an active offer
        const existingOffer = await prisma.p2pOffer.findFirst({
            where: {
                lender_id: lenderId,
                status: "ACTIVE"
            }
        });

        if (existingOffer) {
            return res.status(400).json({
                error: "You already have an active lending offer. You can only have one active offer at a time."
            });
        }

        // Execute balance deduction, escrow allocation, and offer creation atomically
        const result = await prisma.$transaction(async (tx) => {
            // Check available wallet balance
            const wallet = await tx.wallet.findUnique({
                where: { user_id: lenderId }
            });

            if (!wallet || Number(wallet.available_balance) < offerAmount) {
                throw new Error("Insufficient available balance to fund this lending offer.");
            }

            // Lock funds: move from available_balance to escrow_balance
            const updatedWallet = await tx.wallet.update({
                where: { user_id: lenderId },
                data: {
                    available_balance: { decrement: offerAmount },
                    escrow_balance: { increment: offerAmount }
                }
            });

            // Create P2P Offer
            const offer = await tx.p2pOffer.create({
                data: {
                    lender_id: lenderId,
                    amount_available: offerAmount,
                    interest_rate: parsedRate,
                    term_months: parsedTerm,
                    status: "ACTIVE"
                }
            });

            // Record wallet transaction audit log
            const referenceNo = `OFFER-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            const transaction = await tx.walletTransaction.create({
                data: {
                    wallet_id: wallet.id,
                    user_id: lenderId,
                    type: 'ESCROW_HOLD',
                    amount: offerAmount,
                    fee: 0.00,
                    gateway: 'INTERNAL_VAULT',
                    reference_no: referenceNo,
                    description: `P2P Note Allocation (${parsedRate}% for ${parsedTerm}m)`,
                    status: 'COMPLETED'
                }
            });

            return { wallet: updatedWallet, offer, transaction };
        });

        // Broadcast WebSocket updates
        broadcast({ type: "marketplace_update" });
        broadcast({
            type: "admin_data_updated",
            action: "WALLET_TOPUP",
            newEvent: {
                id: result.transaction.id,
                title: `P2P Offer Created`,
                desc: `₱${offerAmount.toLocaleString()} locked into escrow.`,
                time: "Just now",
                source: result.transaction.reference_no,
                color: "text-amber-600 bg-amber-50"
            }
        });

        return res.status(201).json({
            message: "Lending offer published and funds placed in escrow successfully.",
            offer: result.offer,
            wallet: result.wallet
        });

    } catch (err) {
        console.error("Create offer error:", err);
        return res.status(400).json({ error: err.message || "Failed to publish lending offer." });
    }
};

// 2. Fetch active offers for the public Marketplace
const getMarketplaceOffers = async (req, res) => {
    try {
        const offers = await prisma.p2pOffer.findMany({
            where: {
                status: "ACTIVE",
                amount_available: { gt: 0 } // Exclude ₱0 available offers
            },
            include: {
                lender: {
                    select: {
                        id: true,
                        first_name: true,
                        last_name: true,
                        full_name: true
                    }
                },
                applications: true
            },
            orderBy: { created_at: "desc" }
        });

        res.json(offers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 3. Fetch lender's own offers (including CLOSED or 0 balance offers)
const getMyOffers = async (req, res) => {
    try {
        const lenderId = req.user.id;

        const offers = await prisma.p2pOffer.findMany({
            where: { lender_id: lenderId },
            include: {
                applications: true
            },
            orderBy: { created_at: "desc" }
        });

        res.json(offers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 4. Borrower applies to a specific lender's offer
const applyToOffer = async (req, res) => {
    try {
        const borrowerId = req.user.id;
        const { offer_id, amount } = req.body;

        const [borrower, offer] = await Promise.all([
            prisma.user.findUnique({ where: { id: borrowerId } }),
            prisma.p2pOffer.findUnique({ where: { id: parseInt(offer_id) } })
        ]);

        if (!offer || offer.status !== "ACTIVE") {
            return res.status(404).json({ error: "Lending offer not found or closed." });
        }

        if (borrowerId === offer.lender_id) {
            return res.status(400).json({ error: "You cannot apply to your own lending offer." });
        }

        const creditLimit = Number(borrower?.credit_limit || 500);
        if (parseFloat(amount) > creditLimit) {
            return res.status(400).json({ error: `Requested amount exceeds your credit limit (₱${creditLimit.toLocaleString()}).` });
        }

        if (parseFloat(amount) > offer.amount_available) {
            return res.status(400).json({ error: `Requested amount exceeds lender's available balance (₱${Number(offer.amount_available).toLocaleString()}).` });
        }

        const application = await prisma.p2pApplication.create({
            data: {
                offer_id: offer.id,
                borrower_id: borrowerId,
                amount: parseFloat(amount),
                status: "PENDING"
            }
        });

        const notifRecord = await prisma.notification.create({
            data: {
                user_id: offer.lender_id,
                title: "New Loan Application",
                message: `Someone just applied to borrow ₱${amount.toLocaleString()} from your offer!`,
                type: "new_application"
            }
        });

        sendToUser(offer.lender_id, {
            type: "new_application",
            title: "New Loan Application",
            message: `Someone just applied to borrow ₱${amount.toLocaleString()} from your offer!`,
            application_id: application.id
        });

        sendToUser(offer.lender_id, notifRecord);

        res.status(201).json({ message: "Application submitted to lender successfully.", application });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const getLenderApplications = async (req, res) => {
    try {
        const lenderId = req.user.id;
        const applications = await prisma.p2pApplication.findMany({
            where: {
                offer: { lender_id: lenderId },
                status: "PENDING"
            },
            include: {
                borrower: {
                    select: { first_name: true, last_name: true, credit_score: true }
                },
                offer: true
            },
            orderBy: { created_at: 'desc' }
        });

        res.json(applications);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 5. Lender approves a borrower's application
// Inside approveApplication in src/controllers/p2p.controller.js

const approveApplication = async (req, res) => {
    try {
        const lenderId = req.user.id;
        const { application_id } = req.body;

        const application = await prisma.p2pApplication.findUnique({
            where: { id: parseInt(application_id) },
            include: {
                offer: {
                    include: {
                        lender: { select: { first_name: true, last_name: true, full_name: true } }
                    }
                },
                borrower: { select: { first_name: true, last_name: true, full_name: true } }
            }
        });

        if (!application || application.status !== "PENDING") {
            return res.status(404).json({ error: "Application not found or already processed." });
        }

        if (application.offer.lender_id !== lenderId) {
            return res.status(403).json({ error: "Unauthorized. You do not own this offer." });
        }

        const loanAmount = Number(application.amount);
        const borrowerId = application.borrower_id;

        // Construct names for readable transaction descriptions
        const lenderObj = application.offer.lender;
        const borrowerObj = application.borrower;

        const lenderName = lenderObj?.full_name || `${lenderObj?.first_name || ''} ${lenderObj?.last_name || ''}`.trim() || `Lender #${lenderId}`;
        const borrowerName = borrowerObj?.full_name || `${borrowerObj?.first_name || ''} ${borrowerObj?.last_name || ''}`.trim() || `Borrower #${borrowerId}`;

        const result = await prisma.$transaction(async (tx) => {
            // ... (keep previous wallet deduction/credit and loan generation steps 1-7) ...

            // 8. Create Ledger Audit Transactions
            const lenderRef = `DISBURSED-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
            const borrowerRef = `FUNDED-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

            // Lender Ledger Entry
            const lenderTx = await tx.walletTransaction.create({
                data: {
                    wallet_id: lenderWallet.id,
                    user_id: lenderId,
                    type: 'DISBURSEMENT',
                    amount: loanAmount,
                    fee: 0.00,
                    gateway: 'INTERNAL_VAULT',
                    reference_no: lenderRef,
                    description: `P2P Loan Disbursed to ${borrowerName}`,
                    status: 'COMPLETED'
                }
            });

            // Borrower Ledger Entry (Display Lender's Name)
            const borrowerTx = await tx.walletTransaction.create({
                data: {
                    wallet_id: updatedBorrowerWallet.id,
                    user_id: borrowerId,
                    type: 'TOP_UP',
                    amount: loanAmount,
                    fee: 0.00,
                    gateway: 'INTERNAL_VAULT',
                    reference_no: borrowerRef,
                    description: `P2P Loan Disbursed from ${lenderName}`,
                    status: 'COMPLETED'
                }
            });

            return { loan: newLoan, lenderWallet: updatedLenderWallet, borrowerWallet: updatedBorrowerWallet, borrowerTx };
        });

        // ... (keep WebSocket notifications and res.json) ...

    } catch (err) {
        console.error("Approve application error:", err);
        res.status(500).json({ error: err.message || "Failed to approve application." });
    }
};

const updateOffer = async (req, res) => {
    try {
        const userId = req.user.id;
        const offerId = Number(req.params.id);
        const { amount_available, interest_rate, term_months } = req.body;

        const offer = await prisma.p2pOffer.findUnique({
            where: { id: offerId }
        });

        if (!offer) {
            return res.status(404).json({ error: "Offer not found." });
        }

        if (offer.user_id !== userId && offer.lender_id !== userId) {
            return res.status(403).json({ error: "Unauthorized to edit this offer." });
        }

        const updatedOffer = await prisma.p2pOffer.update({
            where: { id: offerId },
            data: {
                amount_available: amount_available ? parseFloat(amount_available) : undefined,
                interest_rate: interest_rate ? parseFloat(interest_rate) : undefined,
                term_months: term_months ? parseInt(term_months) : undefined,
            }
        });

        broadcast({ type: "marketplace_update" });

        res.json(updatedOffer);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const deleteOffer = async (req, res) => {
    try {
        const userId = req.user.id;
        const offerId = Number(req.params.id);

        const offer = await prisma.p2pOffer.findUnique({
            where: { id: offerId }
        });

        if (!offer) {
            return res.status(404).json({ error: "Offer not found." });
        }

        if (offer.user_id !== userId && offer.lender_id !== userId) {
            return res.status(403).json({ error: "Unauthorized to delete this offer." });
        }

        const refundAmount = Number(offer.amount_available);
        const isOfferActive = offer.status === "ACTIVE";

        // Execute escrow refund and deletion atomically
        const result = await prisma.$transaction(async (tx) => {
            let updatedWallet = null;
            let transaction = null;

            if (isOfferActive && refundAmount > 0) {
                const wallet = await tx.wallet.findUnique({
                    where: { user_id: userId }
                });

                if (wallet) {
                    updatedWallet = await tx.wallet.update({
                        where: { user_id: userId },
                        data: {
                            available_balance: { increment: refundAmount },
                            escrow_balance: { decrement: refundAmount }
                        }
                    });

                    const referenceNo = `RELEASE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                    transaction = await tx.walletTransaction.create({
                        data: {
                            wallet_id: wallet.id,
                            user_id: userId,
                            type: 'ESCROW_RELEASE',
                            amount: refundAmount,
                            fee: 0.00,
                            gateway: 'INTERNAL_VAULT',
                            reference_no: referenceNo,
                            description: `P2P Offer Deleted - Escrow Refund`,
                            status: 'COMPLETED'
                        }
                    });
                }
            }

            await tx.p2pOffer.delete({
                where: { id: offerId }
            });

            return { wallet: updatedWallet, transaction };
        });

        broadcast({ type: "marketplace_update" });

        if (result.transaction) {
            broadcast({
                type: "admin_data_updated",
                action: "WALLET_TOPUP",
                newEvent: {
                    id: result.transaction.id,
                    title: `Escrow Released`,
                    desc: `₱${refundAmount.toLocaleString()} returned to available balance.`,
                    time: "Just now",
                    source: result.transaction.reference_no,
                    color: "text-emerald-600 bg-emerald-50"
                }
            });
        }

        res.json({
            message: "Offer deleted successfully and funds restored to available balance.",
            wallet: result.wallet
        });
    } catch (err) {
        console.error("Delete offer error:", err);
        res.status(500).json({ error: err.message });
    }
};

const getBorrowerApplications = async (req, res) => {
    try {
        const userId = req.user.id;
        const applications = await prisma.p2pApplication.findMany({
            where: { borrower_id: userId },
            include: {
                offer: {
                    include: {
                        lender: { select: { id: true, first_name: true, last_name: true } }
                    }
                }
            },
            orderBy: { created_at: 'desc' }
        });
        res.json(applications);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const cancelApplication = async (req, res) => {
    try {
        const userId = req.user.id;
        const appId = Number(req.params.id);

        const application = await prisma.p2pApplication.findUnique({
            where: { id: appId }
        });

        if (!application) {
            return res.status(404).json({ error: "Application not found." });
        }

        if (application.borrower_id !== userId) {
            return res.status(403).json({ error: "Unauthorized to cancel this application." });
        }

        if (application.status !== 'PENDING') {
            return res.status(400).json({ error: "Only pending applications can be cancelled." });
        }

        await prisma.p2pApplication.delete({
            where: { id: appId }
        });

        broadcast({ type: "marketplace_update" });

        res.json({ message: "Application cancelled successfully." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const rejectApplication = async (req, res) => {
    try {
        const userId = req.user.id;
        const { application_id } = req.body;

        const application = await prisma.p2pApplication.findUnique({
            where: { id: Number(application_id) },
            include: { offer: true }
        });

        if (!application) return res.status(404).json({ error: "Application not found." });
        if (application.offer.user_id !== userId && application.offer.lender_id !== userId) {
            return res.status(403).json({ error: "Unauthorized." });
        }

        const updatedApp = await prisma.p2pApplication.update({
            where: { id: Number(application_id) },
            data: { status: 'REJECTED' }
        });

        sendToUser(application.borrower_id, {
            type: "loan_rejected",
            title: "Loan Application Rejected",
            message: `Your loan application for ₱${application.amount} was rejected by the lender.`
        });

        broadcast({ type: "marketplace_update" });
        res.json(updatedApp);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    createOffer,
    getMarketplaceOffers,
    getMyOffers,
    applyToOffer,
    getLenderApplications,
    updateOffer,
    approveApplication,
    deleteOffer,
    getBorrowerApplications,
    cancelApplication,
    rejectApplication
};