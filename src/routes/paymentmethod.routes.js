const express = require('express');
const router = express.Router();
const {
    listPaymentMethods,
    addPaymentMethod,
    deletePaymentMethod,
    setDefaultPaymentMethod,
    toggleAutopay,
} = require('../controllers/paymentMethod.controller');
const validate = require('../middlewares/validate');
const { addPaymentMethodSchema } = require('../validators/paymentMethod.validator');

router.get('/', listPaymentMethods);
router.post('/', validate(addPaymentMethodSchema), addPaymentMethod);
router.delete('/:id', deletePaymentMethod);
router.patch('/:id/default', setDefaultPaymentMethod);
router.patch('/autopay', toggleAutopay);

module.exports = router;