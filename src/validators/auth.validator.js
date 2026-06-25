const Joi = require('joi');

const registerSchema = Joi.object({
    first_name: Joi.string().required(),
    middle_name: Joi.string().optional().allow('', null),
    last_name: Joi.string().required(),
    email: Joi.string().email().required(),
    phone_number: Joi.string().pattern(/^[0-9]{11}$/).required().messages({
        'string.pattern.base': 'Phone number must be 11 digits'
    }),
    username: Joi.string().min(3).max(30).required(),
    password: Joi.string().min(6).required(),
});

const verifyOtpSchema = Joi.object({
    email: Joi.string().email().required(),
    otp: Joi.string().length(6).required(),
});

const resendOtpSchema = Joi.object({
    email: Joi.string().email().required(),
});

const loginSchema = Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required(),
});

module.exports = { registerSchema, verifyOtpSchema, resendOtpSchema, loginSchema };