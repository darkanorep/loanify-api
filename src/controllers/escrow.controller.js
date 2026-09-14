const prisma = require('../lib/prisma');
const crypto = require('crypto');
const { broadcast } = require('../lib/websocket');

const handleEscrowBid = async (req, res) => {
    try {
        const { loanId, bidAmount } = req.body;
        const result = await placeEscrowHold({
            lenderId: req.user.id,
            loanId,
            bidAmount
        });
        res.json({ message: "Escrow hold successfully created.", ...result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

const handleLoanDisbursement = async (req, res) => {
    try {
        const { loanId } = req.body;
        const result = await disburseLoanFromEscrow({
            loanId,
            adminId: req.user.id
        });
        res.json({ message: "Loan successfully disbursed to borrower wallet.", ...result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

const handleEscrowRefund = async (req, res) => {
    try {
        const { lenderId, loanId, holdAmount } = req.body;
        const result = await refundEscrowHold({
            lenderId,
            loanId,
            holdAmount
        });
        res.json({ message: "Escrow hold successfully refunded.", ...result });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
};

module.exports = {
    handleEscrowBid,
    handleLoanDisbursement,
    handleEscrowRefund
};