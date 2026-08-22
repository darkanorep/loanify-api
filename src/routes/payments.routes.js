const express = require('express');
const router = express.Router();
const { getPaymentsSummary } = require('../controllers/payments.controller');
const { makePayment } = require('../controllers/payment.controller');
const validate = require('../middlewares/validate');
const { makePaymentSchema } = require('../validators/payment.validator');

router.get('/summary', getPaymentsSummary);
router.post('/pay', validate(makePaymentSchema), makePayment);

module.exports = router;