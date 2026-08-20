const Joi = require('joi');

const addPaymentMethodSchema = Joi.object({
    type: Joi.string().valid('BANK_ACCOUNT', 'CARD').required(),
    institution_name: Joi.string().max(120).required(),
    // Exactly 4 digits — this is deliberately the ONLY number field this
    // system ever accepts. Never add a field for a full account/card
    // number here, even for testing.
    last_four: Joi.string().pattern(/^\d{4}$/).required(),
    is_default: Joi.boolean().optional(),
});

module.exports = { addPaymentMethodSchema };