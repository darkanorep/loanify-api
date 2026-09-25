const Joi = require('joi');

const makePaymentSchema = Joi.object({
    loan_id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    amount: Joi.number().positive().required(),
    payment_method_id: Joi.alternatives().try(Joi.string(), Joi.number()).required(),
    payment_source: Joi.string().valid("INTERNAL_WALLET", "LINKED_ACCOUNT").optional() // <-- Add this
});

module.exports = { makePaymentSchema };