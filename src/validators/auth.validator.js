const Joi = require('joi');

const registerSchema = Joi.object({
    first_name: Joi.string().required(),
    middle_name: Joi.string().optional().allow('', null),
    last_name: Joi.string().required(),
    email: Joi.string().email().required(),
    phone_number: Joi.string().pattern(/^\+\d{1,3}\d{4,14}(?:x.+)?$/).required(),
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

const forgotPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
});

const resetPasswordSchema = Joi.object({
  email: Joi.string().email().required(),
  otp: Joi.string().length(6).required(),
  new_password: Joi.string().min(8).required(),
});

module.exports = { 
    registerSchema, 
    verifyOtpSchema, 
    resendOtpSchema, loginSchema,
    forgotPasswordSchema,
    resetPasswordSchema 
};