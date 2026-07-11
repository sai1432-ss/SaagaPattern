const express = require('express');
const { Pool } = require('pg');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const SERVICES = {
    flight: 'http://flight_service:3000',
    hotel: 'http://hotel_service:3000',
    car: 'http://car_service:3000',
    payment: 'http://payment_service:3000'
};

async function createSagaRecord(sagaId, status, currentStep) {
    await pool.query('INSERT INTO sagas (saga_id, status, current_step) VALUES ($1, $2, $3)', [sagaId, status, currentStep]);
}
async function updateSagaStatus(sagaId, status, currentStep) {
    await pool.query('UPDATE sagas SET status = $1, current_step = $2, updated_at = NOW() WHERE saga_id = $3', [status, currentStep, sagaId]);
}
async function logSagaStep(sagaId, stepName, status, details = null) {
    await pool.query('INSERT INTO saga_logs (saga_id, step_name, status, details) VALUES ($1, $2, $3, $4)', [sagaId, stepName, status, details]);
}
async function saveStepResourceId(sagaId, dbColumn, resourceId) {
    await pool.query(`UPDATE sagas SET ${dbColumn} = $1 WHERE saga_id = $2`, [resourceId, sagaId]);
}

app.get('/health', (req, res) => res.status(200).json({ status: "UP" }));

async function runSagaPipeline(sagaId, body) {
    const { flightDetails = {}, hotelDetails = {}, carDetails = {}, failAt = null, delayAt = null } = body;
    const amount = 350; 

    // Forwarding delayAt config down to specific nodes
    const pipeline = [
        { name: 'RESERVE_FLIGHT', url: `${SERVICES.flight}/reservations`, payload: { bookingId: sagaId, failAt, delayAt, serviceName: 'flight', ...flightDetails }, type: 'asset', dbCol: 'flight_res_id' },
        { name: 'RESERVE_HOTEL', url: `${SERVICES.hotel}/reservations`, payload: { bookingId: sagaId, failAt, delayAt, serviceName: 'hotel', ...hotelDetails }, type: 'asset', dbCol: 'hotel_res_id' },
        { name: 'RESERVE_CAR', url: `${SERVICES.car}/reservations`, payload: { bookingId: sagaId, failAt, delayAt, serviceName: 'car', ...carDetails }, type: 'asset', dbCol: 'car_res_id' },
        { name: 'PROCESS_PAYMENT', url: `${SERVICES.payment}/payments`, payload: { bookingId: sagaId, amount }, type: 'payment', dbCol: 'payment_id' }
    ];

    const completedSteps = [];

    try {
        for (const step of pipeline) {
            await updateSagaStatus(sagaId, 'STARTED', step.name);
            await logSagaStep(sagaId, step.name, 'STARTED');

            // CRITICAL FIX: Added explicit 30000ms (30 second) client connection timeout window
            const response = await axios.post(step.url, step.payload, { timeout: 30000 });

            if (response.status === 200 || response.status === 201) {
                await logSagaStep(sagaId, step.name, 'COMPLETED');
                const trackingId = step.type === 'asset' ? response.data.reservationId : response.data.paymentId;
                step.trackingId = trackingId;
                completedSteps.push(step);

                if (trackingId) {
                    await saveStepResourceId(sagaId, step.dbCol, trackingId);
                }
            } else {
                throw new Error(`Failed at ${step.name} step`);
            }
        }

        await updateSagaStatus(sagaId, 'COMPLETED', 'CONFIRMED');
        await logSagaStep(sagaId, 'CONFIRMED', 'COMPLETED');

    } catch (error) {
        // Intercept explicitly for custom network socket timeout log statements
        const errorMessage = error.code === 'ECONNABORTED' 
            ? 'Transaction timeout exceeded: Service failed to respond within 30 seconds' 
            : (error.response?.data?.message || error.message);
            
        await logSagaStep(sagaId, 'FORWARD_PIPELINE_FAILED', 'FAILED', errorMessage);
        
        // Execute compensating rollbacks loop backwards
        for (let i = completedSteps.length - 1; i >= 0; i--) {
            const step = completedSteps[i];
            const compName = step.name.replace('RESERVE', 'CANCEL').replace('PROCESS', 'REFUND');

            try {
                await logSagaStep(sagaId, compName, 'STARTED');
                if (step.type === 'asset') {
                    await axios.delete(`${step.url}/${step.trackingId}`, { timeout: 10000 });
                } else {
                    await axios.post(`${SERVICES.payment}/refunds`, { paymentId: step.trackingId }, { timeout: 10000 });
                }
                await logSagaStep(sagaId, compName, 'COMPLETED');
            } catch (compError) {
                await logSagaStep(sagaId, compName, 'FAILED', compError.message);
            }
        }
        await updateSagaStatus(sagaId, 'FAILED', 'ROLLBACK_COMPLETE');
    }
}

app.post('/bookings', async (req, res) => {
    try {
        const sagaId = crypto.randomUUID();
        await createSagaRecord(sagaId, 'STARTED', 'START');
        await logSagaStep(sagaId, 'START', 'STARTED');

        runSagaPipeline(sagaId, req.body);

        return res.status(201).json({
            sagaId: sagaId,
            status: "STARTED"
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
});

app.get('/bookings/:sagaId', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sagas WHERE saga_id = $1', [req.params.sagaId]);
        if (result.rows.length === 0) return res.status(404).json({ message: "Not found" });
        const row = result.rows[0];
        return res.status(200).json({
            sagaId: row.saga_id,
            status: row.status,
            createdAt: row.created_at,
            steps: {
                flightReservationId: row.flight_res_id || null,
                hotelReservationId: row.hotel_res_id || null,
                carReservationId: row.car_res_id || null,
                paymentId: row.payment_id || null
            }
        });
    } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.get('/sagas/:sagaId/log', async (req, res) => {
    try {
        const result = await pool.query('SELECT step_name, status, created_at FROM saga_logs WHERE saga_id = $1 ORDER BY log_id ASC', [req.params.sagaId]);
        return res.status(200).json({
            sagaId: req.params.sagaId,
            logs: result.rows.map(row => ({ stepName: row.step_name, status: row.status, timestamp: row.created_at }))
        });
    } catch (err) { return res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => console.log(`Orchestrator active on port ${PORT}`));