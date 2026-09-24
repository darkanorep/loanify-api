const prisma = require('../lib/prisma');
const { sendToUser, broadcast } = require('../lib/websocket');
const crypto = require("crypto");

// 1. Lender creates a lending advertisement / offer
const createOffer = async (req, res) => {
    try {
        const lenderId = req.user.id;
        const { amount_available, interest_rate, term_months, confirm_direct_funding } = req.body;

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

        // Execute auto top-up (if needed), balance deduction, escrow allocation, and offer creation atomically
        const result = await prisma.$transaction(async (tx) => {
            let wallet = await tx.wallet.findUnique({
                where: { user_id: lenderId }
            });

            if (!wallet) {
                wallet = await tx.wallet.create({
                    data: { user_id: lenderId, available_balance: 0.00, escrow_balance: 0.00 }
                });
            }

            const availableBal = Number(wallet.available_balance);

            // AUTO DIRECT FUNDING: Check if wallet available balance is less than offer amount
            if (availableBal < offerAmount) {
                const requiredDifference = offerAmount - availableBal;

                // Query lender's primary/default payment method
                const primaryPaymentMethod = await tx.paymentMethod.findFirst({
                    where: { user_id: lenderId, is_default: true }
                });

                if (!primaryPaymentMethod) {
                    throw new Error(
                        `Insufficient wallet balance (₱${availableBal.toLocaleString()}). Please add a primary payment method or top up first.`
                    );
                }

                // If user has not confirmed direct funding yet, return confirmation payload to prompt frontend modal
                if (!confirm_direct_funding) {
                    return {
                        requires_confirmation: true,
                        required_difference: requiredDifference,
                        payment_method: `${primaryPaymentMethod.institution_name} (*${primaryPaymentMethod.last_four})`
                    };
                }

                // Auto top-up the exact difference into available_balance
                await tx.wallet.update({
                    where: { id: wallet.id },
                    data: {
                        available_balance: { increment: requiredDifference }
                    }
                });

                // Audit log entry for Auto Direct Funding top-up
                const autoRef = `AUTOCARD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
                await tx.walletTransaction.create({
                    data: {
                        wallet_id: wallet.id,
                        user_id: lenderId,
                        type: 'TOP_UP',
                        amount: requiredDifference,
                        fee: 0.00,
                        gateway: primaryPaymentMethod.type === 'CARD' ? 'CARD' : 'INTERNAL_VAULT',
                        reference_no: autoRef,
                        description: `Auto Direct Funding for Offer via ${primaryPaymentMethod.institution_name} (*${primaryPaymentMethod.last_four})`,
                        status: 'COMPLETED'
                    }
                });
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

            // Record wallet transaction audit log for escrow hold
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

        // Prompt frontend confirmation modal if required difference exists and hasn't been confirmed
        if (result.requires_confirmation) {
            return res.json(result);
        }

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

        if (!application_id) {
            return res.status(400).json({ error: "application_id is required." });
        }

        // 1. Fetch Application with P2pOffer and Borrower details
        const application = await prisma.p2pApplication.findUnique({
            where: { id: parseInt(application_id) },
            include: {
                offer: {
                    include: {
                        lender: { select: { id: true, first_name: true, last_name: true, full_name: true } }
                    }
                },
                borrower: { select: { id: true, first_name: true, last_name: true, full_name: true } }
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
        const termMonths = application.offer.term_months || 1;
        const interestRate = application.offer.interest_rate || 5.0;

        // Name construction for transaction descriptions
        const lenderObj = application.offer.lender;
        const borrowerObj = application.borrower;
        const lenderName = lenderObj?.full_name || `${lenderObj?.first_name || ''} ${lenderObj?.last_name || ''}`.trim() || `Lender #${lenderId}`;
        const borrowerName = borrowerObj?.full_name || `${borrowerObj?.first_name || ''} ${borrowerObj?.last_name || ''}`.trim() || `Borrower #${borrowerId}`;

        // Repayment Calculations
        const totalInterest = loanAmount * (interestRate / 100);
        const totalRepayable = loanAmount + totalInterest;
        const monthlyInstallment = totalRepayable / termMonths;

        // Execute atomic multi-table transaction
        const result = await prisma.$transaction(async (tx) => {
            // 1. Verify Lender's Escrow Balance
            const lenderWallet = await tx.wallet.findUnique({
                where: { user_id: lenderId }
            });

            if (!lenderWallet || Number(lenderWallet.escrow_balance) < loanAmount) {
                throw new Error("Insufficient escrow funds allocated for this offer.");
            }

            // 2. Fetch or Create Borrower's Wallet
            let borrowerWallet = await tx.wallet.findUnique({
                where: { user_id: borrowerId }
            });

            if (!borrowerWallet) {
                borrowerWallet = await tx.wallet.create({
                    data: {
                        user_id: borrowerId,
                        available_balance: 0.00,
                        escrow_balance: 0.00
                    }
                });
            }

            // 3. Deduct ONLY the actual disbursed amount from Lender's ESCROW Balance
            const updatedLenderWallet = await tx.wallet.update({
                where: { id: lenderWallet.id },
                data: { escrow_balance: { decrement: loanAmount } }
            });

            // 4. Credit exact disbursed amount to Borrower's AVAILABLE Balance
            const updatedBorrowerWallet = await tx.wallet.update({
                where: { id: borrowerWallet.id },
                data: { available_balance: { increment: loanAmount } }
            });

            // 5. Update Application Status to APPROVED
            const updatedApplication = await tx.p2pApplication.update({
                where: { id: application.id },
                data: { status: "APPROVED" }
            });

            // 6. Partial Offer Deduction: Update remaining offer liquidity
            const remainingOfferAmount = Number(application.offer.amount_available) - loanAmount;
            const offerStatus = remainingOfferAmount <= 0 ? "CLOSED" : "ACTIVE";

            await tx.p2pOffer.update({
                where: { id: application.offer_id },
                data: {
                    amount_available: Math.max(0, remainingOfferAmount),
                    status: offerStatus
                }
            });

            // 7. Create Active Loan Record
            const newLoan = await tx.loan.create({
                data: {
                    user_id: borrowerId,
                    lender_id: lenderId,
                    purpose: "P2P Marketplace Loan",
                    principal_amount: loanAmount,
                    interest_rate: interestRate,
                    term_months: termMonths,
                    monthly_installment: monthlyInstallment,
                    total_repayable: totalRepayable,
                    outstanding_balance: totalRepayable,
                    status: "ACTIVE",
                    approved_at: new Date(),
                    disbursed_at: new Date()
                }
            });

            // Generate Installment Schedule Rows for the Loan
            const installmentRows = [];
            for (let i = 1; i <= termMonths; i++) {
                const dueDate = new Date();
                dueDate.setMonth(dueDate.getMonth() + i);

                installmentRows.push({
                    loan_id: newLoan.id,
                    installment_number: i,
                    due_date: dueDate,
                    amount_due: monthlyInstallment,
                    amount_paid: 0.00,
                    status: "PENDING"
                });
            }

            // Bulk insert installments
            await tx.installment.createMany({
                data: installmentRows
            });

            // 8. Create Ledger Audit Entries
            const lenderRef = `DISBURSED-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
            const borrowerRef = `FUNDED-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

            // Lender Ledger Transaction Entry
            const lenderTx = await tx.walletTransaction.create({
                data: {
                    wallet_id: lenderWallet.id,
                    user_id: lenderId,
                    loan_id: newLoan.id,
                    type: 'DISBURSEMENT',
                    amount: loanAmount,
                    fee: 0.00,
                    gateway: 'INTERNAL_VAULT',
                    reference_no: lenderRef,
                    description: `P2P Loan Disbursed to ${borrowerName}`,
                    status: 'COMPLETED'
                }
            });

            // Borrower Ledger Transaction Entry
            const borrowerTx = await tx.walletTransaction.create({
                data: {
                    wallet_id: updatedBorrowerWallet.id,
                    user_id: borrowerId,
                    loan_id: newLoan.id,
                    type: 'TOP_UP',
                    amount: loanAmount,
                    fee: 0.00,
                    gateway: 'INTERNAL_VAULT',
                    reference_no: borrowerRef,
                    description: `P2P Loan Disbursed from ${lenderName}`,
                    status: 'COMPLETED'
                }
            });

            return {
                loan: newLoan,
                application: updatedApplication,
                lenderWallet: updatedLenderWallet,
                borrowerWallet: updatedBorrowerWallet,
                borrowerTx
            };
        });

        // Real-Time WebSocket Notifications & Marketplace Event Broadcasts
        if (typeof sendToUser === 'function') {
            sendToUser(borrowerId, {
                type: "loan_approved",
                title: "Loan Approved! 🎉",
                message: `Your loan application for ₱${loanAmount.toLocaleString()} has been approved by ${lenderName}. Funds are available in your wallet.`
            });
        }

        if (typeof broadcast === 'function') {
            broadcast({ type: "marketplace_update" });
            broadcast({
                type: "admin_data_updated",
                action: "P2P_LOAN_APPROVED",
                newEvent: {
                    id: result.borrowerTx.id,
                    title: "P2P Loan Approved",
                    desc: `₱${loanAmount.toLocaleString()} disbursed to ${borrowerName}`,
                    time: "Just now",
                    source: result.borrowerTx.reference_no,
                    color: "text-emerald-600 bg-emerald-50"
                }
            });
        }

        return res.json({
            message: "Loan application approved and funds disbursed successfully.",
            data: result
        });

    } catch (err) {
        console.error("Approve application error:", err);
        return res.status(500).json({ error: err.message || "Failed to approve application." });
    }
};

const updateOffer = async (req, res) => {
    try {
        const userId = req.user.id;
        const offerId = Number(req.params.id);
        const { amount_available, interest_rate, term_months, confirm_direct_funding } = req.body;

        const offer = await prisma.p2pOffer.findUnique({
            where: { id: offerId },
            include: {
                applications: {
                    where: { status: "PENDING" }
                }
            }
        });

        if (!offer) {
            return res.status(404).json({ error: "Offer not found." });
        }

        if (offer.user_id !== userId && offer.lender_id !== userId) {
            return res.status(403).json({ error: "Unauthorized to edit this offer." });
        }

        if (offer.status === "CLOSED") {
            return res.status(400).json({ error: "Cannot edit a closed offer." });
        }

        if (offer.applications && offer.applications.length > 0) {
            return res.status(400).json({
                error: "Cannot edit offer while there are pending applications attached to it."
            });
        }

        const newAmount = amount_available ? parseFloat(amount_available) : Number(offer.amount_available);
        const currentOfferAmount = Number(offer.amount_available);
        const amountDelta = newAmount - currentOfferAmount;

        const result = await prisma.$transaction(async (tx) => {
            let wallet = await tx.wallet.findUnique({
                where: { user_id: userId }
            });

            if (!wallet) {
                wallet = await tx.wallet.create({
                    data: { user_id: userId, available_balance: 0.00, escrow_balance: 0.00 }
                });
            }

            let transaction = null;

            if (amountDelta > 0) {
                // INCREASING OFFER AMOUNT
                const availableBal = Number(wallet.available_balance);

                if (availableBal < amountDelta) {
                    const requiredDifference = amountDelta - availableBal;

                    const primaryPaymentMethod = await tx.paymentMethod.findFirst({
                        where: { user_id: userId, is_default: true }
                    });

                    if (!primaryPaymentMethod) {
                        throw new Error(
                            `Insufficient wallet balance (₱${availableBal.toLocaleString()}). Please add a primary payment method to cover the additional ₱${requiredDifference.toLocaleString()}.`
                        );
                    }

                    if (!confirm_direct_funding) {
                        return {
                            requires_confirmation: true,
                            required_difference: requiredDifference,
                            payment_method: `${primaryPaymentMethod.institution_name} (*${primaryPaymentMethod.last_four})`
                        };
                    }

                    // Auto top-up exact difference into available_balance
                    await tx.wallet.update({
                        where: { id: wallet.id },
                        data: {
                            available_balance: { increment: requiredDifference }
                        }
                    });

                    const autoRef = `AUTOCARD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
                    await tx.walletTransaction.create({
                        data: {
                            wallet_id: wallet.id,
                            user_id: userId,
                            type: 'TOP_UP',
                            amount: requiredDifference,
                            fee: 0.00,
                            gateway: primaryPaymentMethod.type === 'CARD' ? 'CARD' : 'INTERNAL_VAULT',
                            reference_no: autoRef,
                            description: `Auto Direct Funding for Offer Top-Up via ${primaryPaymentMethod.institution_name} (*${primaryPaymentMethod.last_four})`,
                            status: 'COMPLETED'
                        }
                    });
                }

                // Deduct from available balance and move to escrow
                await tx.wallet.update({
                    where: { id: wallet.id },
                    data: {
                        available_balance: { decrement: amountDelta },
                        escrow_balance: { increment: amountDelta }
                    }
                });

                const refNo = `ESCROW-HOLD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                transaction = await tx.walletTransaction.create({
                    data: {
                        wallet_id: wallet.id,
                        user_id: userId,
                        type: 'ESCROW_HOLD',
                        amount: amountDelta,
                        fee: 0.00,
                        gateway: 'INTERNAL_VAULT',
                        reference_no: refNo,
                        description: `P2P Offer #${offerId} Increased by ₱${amountDelta.toLocaleString()}`,
                        status: 'COMPLETED'
                    }
                });

            } else if (amountDelta < 0) {
                // DECREASING OFFER AMOUNT (e.g. ₱999,999 down to ₱9,999)
                const releaseAmount = Math.abs(amountDelta);
                const currentEscrow = Number(wallet.escrow_balance);
                const actualRelease = Math.min(currentEscrow, releaseAmount);

                // Transfer excess escrow balance back to available balance
                await tx.wallet.update({
                    where: { id: wallet.id },
                    data: {
                        escrow_balance: { decrement: actualRelease },
                        available_balance: { increment: actualRelease }
                    }
                });

                // Record Wallet Transaction Audit Log for Escrow Release
                const refNo = `ESCROW-RELEASE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                transaction = await tx.walletTransaction.create({
                    data: {
                        wallet_id: wallet.id,
                        user_id: userId,
                        type: 'ESCROW_RELEASE',
                        amount: actualRelease,
                        fee: 0.00,
                        gateway: 'INTERNAL_VAULT',
                        reference_no: refNo,
                        description: `P2P Offer #${offerId} Adjusted - Released ₱${actualRelease.toLocaleString()} to Available Balance`,
                        status: 'COMPLETED'
                    }
                });
            }

            const updatedOffer = await tx.p2pOffer.update({
                where: { id: offerId },
                data: {
                    amount_available: amount_available ? parseFloat(amount_available) : undefined,
                    interest_rate: interest_rate ? parseFloat(interest_rate) : undefined,
                    term_months: term_months ? parseInt(term_months) : undefined,
                }
            });

            const updatedWallet = await tx.wallet.findUnique({
                where: { user_id: userId }
            });

            return { updatedOffer, wallet: updatedWallet, transaction };
        });

        if (result.requires_confirmation) {
            return res.json(result);
        }

        if (typeof broadcast === 'function') {
            broadcast({ type: "marketplace_update" });

            if (result.transaction) {
                broadcast({
                    type: "admin_data_updated",
                    action: "P2P_OFFER_UPDATED",
                    newEvent: {
                        id: result.transaction.id,
                        title: "Offer Adjusted",
                        desc: result.transaction.description,
                        time: "Just now",
                        source: result.transaction.reference_no,
                        color: "text-emerald-600 bg-emerald-50"
                    }
                });
            }
        }

        return res.json(result.updatedOffer);
    } catch (err) {
        console.error("Update offer error:", err);
        return res.status(500).json({ error: err.message });
    }
};

const deleteOffer = async (req, res) => {
    try {
        const userId = req.user.id;
        const offerId = Number(req.params.id);

        // Fetch offer and pending applications
        const offer = await prisma.p2pOffer.findUnique({
            where: { id: offerId },
            include: {
                applications: {
                    where: { status: "PENDING" }
                }
            }
        });

        if (!offer) {
            return res.status(404).json({ error: "Offer not found." });
        }

        const lenderId = offer.lender_id || offer.user_id;
        if (lenderId !== userId) {
            return res.status(403).json({ error: "Unauthorized to delete this offer." });
        }

        // Prevent cancellation if there are PENDING applications waiting for review
        if (offer.applications && offer.applications.length > 0) {
            return res.status(400).json({
                error: "Cannot cancel offer with pending applications. Please approve or reject them first."
            });
        }

        const refundAmount = Number(offer.amount_available);

        const result = await prisma.$transaction(async (tx) => {
            let updatedWallet = null;
            let transaction = null;

            // Release remaining available liquidity from Escrow back to Available Balance
            if (refundAmount > 0) {
                const wallet = await tx.wallet.findUnique({
                    where: { user_id: userId }
                });

                if (wallet) {
                    const currentEscrow = Number(wallet.escrow_balance);
                    const actualUnlockAmount = Math.min(currentEscrow, refundAmount);

                    if (actualUnlockAmount > 0) {
                        updatedWallet = await tx.wallet.update({
                            where: { user_id: userId },
                            data: {
                                available_balance: { increment: actualUnlockAmount },
                                escrow_balance: { decrement: actualUnlockAmount }
                            }
                        });

                        const referenceNo = `ESCROW-RELEASE-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
                        transaction = await tx.walletTransaction.create({
                            data: {
                                wallet_id: wallet.id,
                                user_id: userId,
                                type: 'ESCROW_RELEASE',
                                amount: actualUnlockAmount,
                                fee: 0.00,
                                gateway: 'INTERNAL_VAULT',
                                reference_no: referenceNo,
                                description: `Escrow Released from Cancelled P2P Offer #${offerId}`,
                                status: 'COMPLETED'
                            }
                        });
                    }
                }
            }

            // Count total historical applications (APPROVED, REJECTED, etc.)
            const totalAppsCount = await tx.p2pApplication.count({
                where: { offer_id: offerId }
            });

            if (totalAppsCount > 0) {
                // DO NOT DELETE: Soft close offer to preserve Loan & Installment timeline history
                await tx.p2pOffer.update({
                    where: { id: offerId },
                    data: {
                        status: "CLOSED",
                        amount_available: 0
                    }
                });
            } else {
                // Safe to hard delete only if no historical applications ever existed
                await tx.p2pOffer.delete({
                    where: { id: offerId }
                });
            }

            return { wallet: updatedWallet, transaction };
        });

        if (typeof broadcast === 'function') {
            broadcast({ type: "marketplace_update" });
            if (result.transaction) {
                broadcast({
                    type: "admin_data_updated",
                    action: "P2P_OFFER_CANCELLED",
                    newEvent: {
                        id: result.transaction.id,
                        title: "Escrow Released",
                        desc: `₱${refundAmount.toLocaleString()} returned to available balance.`,
                        time: "Just now",
                        source: result.transaction.reference_no,
                        color: "text-emerald-600 bg-emerald-50"
                    }
                });
            }
        }

        return res.json({
            message: "Offer closed successfully and remaining escrow restored to available balance.",
            wallet: result.wallet
        });

    } catch (err) {
        console.error("Delete offer error:", err);
        return res.status(500).json({ error: err.message });
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

        if (!application_id) {
            return res.status(400).json({ error: "application_id is required." });
        }

        // 1. Fetch Application with Offer, Lender, and Borrower details
        const application = await prisma.p2pApplication.findUnique({
            where: { id: Number(application_id) },
            include: {
                offer: {
                    include: {
                        lender: { select: { id: true, first_name: true, last_name: true, full_name: true } }
                    }
                },
                borrower: { select: { id: true, first_name: true, last_name: true, full_name: true } }
            }
        });

        if (!application) {
            return res.status(404).json({ error: "Application not found." });
        }

        if (application.status !== "PENDING") {
            return res.status(400).json({ error: "Application has already been processed." });
        }

        const lenderId = application.offer.lender_id || application.offer.user_id;
        if (lenderId !== userId) {
            return res.status(403).json({ error: "Unauthorized. You do not own this offer." });
        }

        const borrowerId = application.borrower_id;
        const loanAmount = Number(application.amount);
        const lenderObj = application.offer.lender;
        const lenderName = lenderObj?.full_name || `${lenderObj?.first_name || ''} ${lenderObj?.last_name || ''}`.trim() || `Lender #${userId}`;

        // 2. Mark Application as REJECTED in database
        const updatedApp = await prisma.p2pApplication.update({
            where: { id: Number(application_id) },
            data: { status: 'REJECTED' }
        });

        // Note: Offer amount_available & Lender escrow_balance remain UNTOUCHED
        // so other prospective borrowers can still apply for the offer funds.

        // 3. Send Real-Time WebSocket Alerts
        if (typeof sendToUser === 'function') {
            sendToUser(borrowerId, {
                type: "loan_rejected",
                title: "Loan Application Rejected",
                message: `Your loan application for ₱${loanAmount.toLocaleString()} was rejected by ${lenderName}.`
            });
        }

        if (typeof broadcast === 'function') {
            // Signal all connected clients to update their UI
            broadcast({ type: "marketplace_update" });

            // Admin event audit log
            broadcast({
                type: "admin_data_updated",
                action: "P2P_APPLICATION_REJECTED",
                newEvent: {
                    id: `APP-REJECT-${application.id}`,
                    title: "P2P Application Declined",
                    desc: `Application #${application.id} for ₱${loanAmount.toLocaleString()} declined by ${lenderName}`,
                    time: "Just now",
                    source: `APP-${application.id}`,
                    color: "text-rose-600 bg-rose-50"
                }
            });
        }

        return res.json({
            message: "Loan application rejected successfully.",
            data: updatedApp
        });

    } catch (err) {
        console.error("Reject application error:", err);
        return res.status(500).json({ error: err.message || "Failed to reject application." });
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