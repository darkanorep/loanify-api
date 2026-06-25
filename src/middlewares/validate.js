const validate = (schema) => (req, res, next) => {
    const { error } = schema.validate(req.body, { abortEarly: false });
    if (error) {
        return res.status(422).json({
            errors: error.details.map((e) => e.message)
        });
    }
    next();
};

module.exports = validate;