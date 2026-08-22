const Joi = require('joi');

const makePaymentSchema = Joi.object({
    loan_id: Joi.number().integer().required(),
    amount: Joi.number().positive().required(),
    payment_method_id: Joi.number().integer().required(),
});

module.exports = { makePaymentSchema };