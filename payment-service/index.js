const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const payments = {};

app.get('/health', (req, res) => res.status(200).json({ status: "UP" }));

app.post('/payments', (req, res) => {
    const { bookingId, amount } = req.body;

    if (amount === 999 || amount <= 0) {
        return res.status(400).json({ status: "FAILED", message: "Transaction Declined" });
    }

    const existingId = Object.keys(payments).find(id => payments[id].bookingId === bookingId);
    if (existingId) {
        return res.status(201).json({ paymentId: existingId });
    }

    const paymentId = crypto.randomUUID();
    payments[paymentId] = { bookingId, amount, status: "COMPLETED" };

    return res.status(201).json({ paymentId });
});

app.post('/refunds', (req, res) => {
    const { paymentId } = req.body;
    if (payments[paymentId]) {
        payments[paymentId].status = "REFUNDED";
    }
    return res.status(201).json({ paymentId, status: "REFUNDED" });
});

app.listen(PORT, () => console.log(`Payment service operational on port ${PORT}`));