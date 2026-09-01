const prisma = require('../lib/prisma');

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

        res.status(201).json({ message: "Lending offer published successfully.", offer });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// 2. Fetch active lending offers for borrowers to browse
const getMarketplaceOffers = async (req, res) => {
    try {
        const offers = await prisma.p2pOffer.findMany({
            where: { status: "ACTIVE" },
            include: {
                lender: {
                    select: { first_name: true, last_name: true, credit_score: true }
                }
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

        const offer = await prisma.p2pOffer.findUnique({ where: { id: parseInt(offer_id) } });
        if (!offer || offer.status !== "ACTIVE") {
            return res.status(404).json({ error: "Lending offer not found or closed." });
        }

        if (borrowerId === offer.lender_id) {
            return res.status(400).json({ error: "You cannot apply to your own lending offer." });
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

        // ==========================================
        // FIRE REAL-TIME NOTIFICATION TO LENDER
        // ==========================================
        const io = req.app.get('io');
        if (io) {
            io.to(`user_${offer.lender_id}`).emit('new_application', {
                title: "New Loan Application",
                message: `Someone just applied to borrow $${amount} from your offer!`,
                application_id: application.id
            });
        }

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

        // Define calculations before the transaction block
        const principal = application.amount;
        const rate = application.offer.interest_rate / 100;
        const totalInterest = principal * rate * (application.offer.term_months / 12);
        const totalRepayable = principal + totalInterest;
        const monthlyInstallment = totalRepayable / application.offer.term_months;

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
                data: { amount_available: { decrement: principal } }
            });

            // 3. Auto-close offer if balance hits 0
            if (updatedOffer.amount_available <= 0) {
                await tx.p2pOffer.update({
                    where: { id: application.offer.id },
                    data: { status: "CLOSED" }
                });
            }

            // 4. Create the actual Loan record for the borrower
            await tx.loan.create({
                data: {
                    user_id: application.borrower_id,
                    purpose: "P2P Marketplace Loan",
                    principal_amount: principal,
                    interest_rate: application.offer.interest_rate,
                    term_months: application.offer.term_months,
                    monthly_installment: monthlyInstallment,
                    total_repayable: totalRepayable,
                    outstanding_balance: totalRepayable,
                    status: "ACTIVE" 
                }
            });
        });

        res.json({ message: "Application approved successfully. Loan created." });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    createOffer,
    getMarketplaceOffers,
    applyToOffer,
    getLenderApplications, // Add this
    approveApplication     // Add this
};