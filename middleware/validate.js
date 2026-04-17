/**
 * Joi Validation Middleware
 * Wraps a Joi schema and validates req.body (or req.query / req.params).
 *
 * Usage:
 *   const validate = require('../middleware/validate');
 *   const schemas  = require('../utils/validators');
 *   router.post('/login', validate(schemas.auth.login), authController.login);
 */

const validate = (schema, source = 'body') => {
    return (req, res, next) => {
        const data = req[source];
        const { error, value } = schema.validate(data, {
            abortEarly: false,       // report ALL errors, not just the first
            stripUnknown: true,       // remove fields not in the schema
            convert: true             // coerce types where possible
        });

        if (error) {
            const errors = error.details.map((d) => ({
                field: d.path.join('.'),
                message: d.message.replace(/"/g, '')
            }));
            return res.status(422).json({
                success: false,
                message: 'Validation failed',
                errors
            });
        }

        // Replace body/query/params with the cleaned, validated value
        req[source] = value;
        next();
    };
};

module.exports = validate;
