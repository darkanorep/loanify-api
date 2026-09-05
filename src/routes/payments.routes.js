const express = require('express');
const router = express.Router();
const { getPaymentsSummary, handleLoan } = require('../controllers/payments.controller');
const validate = require('../middlewares/validate');
const { makePaymentSchema } = require('../validators/payment.validator');

router.get('/summary', getPaymentsSummary);
router.post('/pay', validate(makePaymentSchema), handleLoan);

module.exports = router;