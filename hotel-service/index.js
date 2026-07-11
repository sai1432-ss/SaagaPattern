const express = require('express');
const crypto = require('crypto');
const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const reservations = {};

app.get('/health', (req, res) => res.status(200).json({ status: "UP" }));

app.post('/reservations', async (req, res) => {
    const { bookingId, failAt, delayAt, serviceName } = req.body;

    // 1. Requirement 9 Check: If instruction matches this service, pause for 35 seconds
    if (delayAt === serviceName) {
        console.log(`[${serviceName}] Delaying response intentionally for 35 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 35000));
    }

    // Requirement 6 Check
    if (failAt === serviceName) {
        return res.status(400).json({ status: "FAILED", message: `Intentional failure at ${serviceName}` });
    }

    const existingId = Object.keys(reservations).find(id => reservations[id].bookingId === bookingId);
    if (existingId) {
        return res.status(201).json({ reservationId: existingId });
    }

    const reservationId = crypto.randomUUID();
    reservations[reservationId] = { bookingId, status: "CONFIRMED" };

    return res.status(201).json({ reservationId });
});

app.delete('/reservations/:reservationId', (req, res) => {
    const { reservationId } = req.params;
    if (reservations[reservationId]) {
        reservations[reservationId].status = "CANCELLED";
    }
    return res.status(204).send();
});

app.listen(PORT, () => console.log(`Asset service operating on port ${PORT}`));