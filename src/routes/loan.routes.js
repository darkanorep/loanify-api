const express = require('express');
const router = express.Router();
const { createLoan, approveLoan, getMyLoans } = require('../controllers/loan.controller');
const validate = require('../middlewares/validate');
const { createLoanSchema } = require('../validators/loan.validator');

router.get('/', getMyLoans);
router.post('/', validate(createLoanSchema), createLoan);

// ⚠️ Only `authenticate` here — no role check exists yet. Any logged-in
// user can currently hit this, including approving their own loan. Add a
// requireAdmin (or similar) middleware here once you have a role system —
// e.g. router.post('/:id/approve', authenticate, requireAdmin, approveLoan);
router.post('/:id/approve', approveLoan);

module.exports = router;