const prisma = require('../lib/prisma');

const listPaymentMethods = async (req, res) => {
    try {
        const methods = await prisma.paymentMethod.findMany({
            where: { user_id: req.user.id },
            orderBy: [{ is_default: 'desc' }, { created_at: 'desc' }],
        });
        res.json({ payment_methods: methods });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const addPaymentMethod = async (req, res) => {
    try {
        const { type, institution_name, last_four, is_default } = req.body;
        const userId = req.user.id;

        // If this is the user's first linked account at all, make it the
        // default automatically regardless of what was passed in — there
        // should never be a state with accounts linked but none marked default.
        const existingCount = await prisma.paymentMethod.count({ where: { user_id: userId } });
        const shouldBeDefault = is_default === true || existingCount === 0;

        const method = await prisma.$transaction(async (tx) => {
            if (shouldBeDefault) {
                // Only one default at a time — unset any existing one first.
                await tx.paymentMethod.updateMany({
                    where: { user_id: userId, is_default: true },
                    data: { is_default: false },
                });
            }

            return tx.paymentMethod.create({
                data: {
                    user_id: userId,
                    type,
                    institution_name,
                    last_four,
                    is_default: shouldBeDefault,
                },
            });
        });

        res.status(201).json({ message: 'Payment method linked.', payment_method: method });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const deletePaymentMethod = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const userId = req.user.id;

        const method = await prisma.paymentMethod.findUnique({ where: { id } });
        if (!method || method.user_id !== userId) {
            return res.status(404).json({ error: 'Payment method not found.' });
        }

        await prisma.paymentMethod.delete({ where: { id } });

        // If the deleted one was the default and other accounts still
        // exist, promote the most recently added remaining one — otherwise
        // the user is left with linked accounts but no default at all.
        if (method.is_default) {
            const next = await prisma.paymentMethod.findFirst({
                where: { user_id: userId },
                orderBy: { created_at: 'desc' },
            });
            if (next) {
                await prisma.paymentMethod.update({
                    where: { id: next.id },
                    data: { is_default: true },
                });
            }
        }

        res.json({ message: 'Payment method removed.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const setDefaultPaymentMethod = async (req, res) => {
    try {
        const id = Number(req.params.id);
        const userId = req.user.id;

        const method = await prisma.paymentMethod.findUnique({ where: { id } });
        if (!method || method.user_id !== userId) {
            return res.status(404).json({ error: 'Payment method not found.' });
        }

        await prisma.$transaction([
            prisma.paymentMethod.updateMany({
                where: { user_id: userId, is_default: true },
                data: { is_default: false },
            }),
            prisma.paymentMethod.update({
                where: { id },
                data: { is_default: true },
            }),
        ]);

        res.json({ message: 'Default payment method updated.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const toggleAutopay = async (req, res) => {
    try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: '"enabled" must be true or false.' });
        }

        const user = await prisma.user.update({
            where: { id: req.user.id },
            data: { autopay_enabled: enabled },
        });

        res.json({ message: 'AutoPay setting updated.', autopay_enabled: user.autopay_enabled });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    listPaymentMethods,
    addPaymentMethod,
    deletePaymentMethod,
    setDefaultPaymentMethod,
    toggleAutopay,
};