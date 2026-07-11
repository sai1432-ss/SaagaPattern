CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS sagas (
    saga_id UUID PRIMARY KEY,
    status VARCHAR(255) NOT NULL,
    current_step VARCHAR(255) NOT NULL,
    flight_res_id VARCHAR(255),
    hotel_res_id VARCHAR(255),
    car_res_id VARCHAR(255),
    payment_id VARCHAR(255),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS saga_logs (
    log_id SERIAL PRIMARY KEY,
    saga_id UUID NOT NULL REFERENCES sagas(saga_id) ON DELETE CASCADE,
    step_name VARCHAR(255) NOT NULL,
    status VARCHAR(255) NOT NULL,
    details TEXT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);