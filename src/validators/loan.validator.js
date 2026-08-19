const Joi = require('joi');

const createLoanSchema = Joi.object({
    principal_amount: Joi.number().positive().min(500).max(50000).required(),
    term_months: Joi.number().integer().min(1).max(60).required(),
    purpose: Joi.string().max(255).allow('', null).optional(),
});

module.exports = { createLoanSchema };