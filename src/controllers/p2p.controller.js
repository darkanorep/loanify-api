const prisma = require('../lib/prisma');
const { sendToUser, broadcast } = require('../lib/websocket');


// 1. Lender creates a lending advertisement / offer
const createOffer = async (req, res) => {
    try {
        const lenderId = req.user.id;
        const { amount_available, interest_rate, term_months } = req.body;

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

        const offer = await prisma.p2pOffer.create({
            data: {
                lender_id: lenderId,
                amount_available: parseFloat(amount_available),
                interest_rate: parseFloat(interest_rate),
                term_months: parseInt(term_months), // Fixed: changed termMonths to term_months
                status: "ACTIVE"
            }
        });

        // Broadcast real-time marketplace update to all connected users
        broadcast({ type: "marketplace_update" });

        res.status(201).json({ message: "Lending offer published successfully.", offer });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. Fetch active lending offers for borrowers to browse
const getMarketplaceOffers = async (req, res) => {
    try {
        const offers = await prisma.p2pOffer.findMany({
            include: {
                lender: { select: { id: true, first_name: true, last_name: true } },
                applications: true // Include applications so frontend can check their statuses
            },
            orderBy: { created_at: 'desc' }
        });
        res.json(offers);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 3. Borrower applies to a specific lender's offer
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
            return res.status(400).json({ error: `Requested amount exceeds your credit limit ($${creditLimit}).` });
        }

        if (parseFloat(amount) > offer.amount_available) {
            return res.status(400).json({ error: `Requested amount exceeds lender's available balance ($${offer.amount_available}).` });
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
                message: `Someone just applied to borrow $${amount} from your offer!`,
                type: "new_application"
            }
        });

        // ==========================================
        // FIRE REAL-TIME NOTIFICATION TO LENDER VIA NATIVE WEBSOCKET
        // ==========================================
        sendToUser(offer.lender_id, {
            type: "new_application",
            title: "New Loan Application",
            message: `Someone just applied to borrow $${amount} from your offer!`,
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
const approveApplication = async (req, res) => {
    try {
        const lenderId = req.user.id;
        const { application_id } = req.body;

        const application = await prisma.p2pApplication.findUnique({
            where: { id: parseInt(application_id) },
            include: { offer: true }
        });

        if (!application || application.status !== "PENDING") {
            return res.status(404).json({ error: "Application not found or already processed." });
        }

        if (application.offer.lender_id !== lenderId) {
            return res.status(403).json({ error: "Unauthorized. You do not own this offer." });
        }

        if (application.amount > application.offer.amount_available) {
            return res.status(400).json({ error: "Insufficient funds available in your offer to approve this." });
        }

        // Run as a transaction so everything succeeds or fails together
        await prisma.$transaction(async (tx) => {
            // 1. Mark application as APPROVED
            await tx.p2pApplication.update({
                where: { id: application.id },
                data: { status: "APPROVED" }
            });

            // 2. Deduct amount from the lender's offer
            const updatedOffer = await tx.p2pOffer.update({
                where: { id: application.offer.id },
                data: { amount_available: { decrement: application.amount } }
            });

            // 3. Auto-close offer if balance hits 0
            if (updatedOffer.amount_available <= 0) {
                await tx.p2pOffer.update({
                    where: { id: application.offer.id },
                    data: { status: "CLOSED" }
                });
            }

            // 4. Calculate financial breakdown
            const principal = application.amount;
            const rate = application.offer.interest_rate / 100;
            const termMonths = application.offer.term_months;
            const totalInterest = principal * rate * (termMonths / 12);
            const totalRepayable = principal + totalInterest;
            const monthlyInstallment = totalRepayable / termMonths;

            // 5. Create the actual Loan record
            const newLoan = await tx.loan.create({
                data: {
                    user_id: application.borrower_id,
                    purpose: "P2P Marketplace Loan",
                    principal_amount: principal,
                    interest_rate: application.offer.interest_rate,
                    term_months: termMonths,
                    monthly_installment: monthlyInstallment,
                    total_repayable: totalRepayable,
                    outstanding_balance: totalRepayable,
                    status: "ACTIVE"
                }
            });

            // 6. Generate upcoming installment schedule rows so "Next Due" has dates to track
            const installmentsData = [];
            for (let i = 1; i <= termMonths; i++) {
                const dueDate = new Date();
                dueDate.setMonth(dueDate.getMonth() + i);
                installmentsData.push({
                    loan_id: newLoan.id,
                    installment_number: i,
                    amount_due: monthlyInstallment,
                    due_date: dueDate,
                    status: "PENDING"
                });
            }

            await tx.installment.createMany({
                data: installmentsData
            });
        });

        // Send real-time notification to the borrower via WebSocket
        sendToUser(application.borrower_id, {
            type: "loan_approved",
            title: "Loan Approved!",
            message: `Your loan application for ₱${application.amount} has been approved and added to your portfolio.`
        });

        if (typeof broadcast === 'function') {
            broadcast({ type: "marketplace_update" });
        }

        res.json({ message: "Application approved successfully. Loan and schedule created." });
    } catch (err) {
        res.status(500).json({ error: err.message });
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

        // Check ownership (adjust 'user_id' or 'lender_id' based on your Prisma schema)
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

        // Broadcast real-time marketplace update to all connected users
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

        await prisma.p2pOffer.delete({
            where: { id: offerId }
        });

        broadcast({ type: "marketplace_update" });

        res.json({ message: "Offer deleted successfully." });
    } catch (err) {
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

        // Send real-time notification to borrower
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
    applyToOffer,
    getLenderApplications,
    updateOffer,
    approveApplication,
    deleteOffer,
    getBorrowerApplications,
    cancelApplication,
    rejectApplication
};