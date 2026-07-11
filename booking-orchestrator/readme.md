# Distributed Saga Pattern Booking Orchestrator

A fault-tolerant, asynchronous distributed booking system implementing the **Saga Orchestration Pattern** using Node.js, Express, Docker Compose, and PostgreSQL. The system coordinates transactions across four independent microservices (Flight, Hotel, Car, and Payment) and handles automated backward compensation (rollbacks) and network timeouts.

---

## System Architecture

This project implements an **Orchestrator-based Saga Pattern** to maintain eventual consistency across distributed microservices without locking database rows indefinitely.

### 1. Success Scenario Pipeline

When all services respond successfully, the orchestrator executes transactions sequentially in a forward pipeline.

```
[Postman Client] --(POST /bookings)--> [Orchestrator] (Returns 201 STARTED instantly)
|
(Runs in Background)
|
├──> [Flight Service] (POST /reservations) -> 201 OK
├──> [Hotel Service]  (POST /reservations) -> 201 OK
├──> [Car Service]    (POST /reservations) -> 201 OK
└──> [Payment Service](POST /payments)     -> 201 OK
|
[Updates DB Status to COMPLETED]
```

### 2. Failure & Rollback Scenario Pipeline

If a participant microservice fails (or times out after 30 seconds), the forward pipeline halts immediately, and the compensation engine triggers `DELETE`/`POST` rollback actions in reverse order.

```
[Orchestrator] ──> [Flight Service] (POST /reservations) ──> 201 Success (Tracked)
[Orchestrator] ──> [Hotel Service]  (POST /reservations) ──> 400 Bad Request / Timeout
│
(Forward execution stops immediately; Car and Payment are bypassed)
│
└──> [Compensating Rollback Engine]
│
└──> [Flight Service] (DELETE /reservations/{id}) ──> 204 Cancelled
│
[Updates DB Status to FAILED]
```

---

## Infrastructure Requirements

Ensure you have the following installed on your host environment:
* **Git** (for cloning the repository)
* **Docker Desktop** (with Docker Compose engine active)
* **Postman** (for executing API validation scenarios)

---

## Quick Start Guide

### 1. Clone the Repository

Clone the project from GitHub to your local machine:

```bash
git clone https://github.com/<your-username>/SagaPattern.git
```

### 2. Navigate to the Project Directory

```bash
cd SagaPattern
```

### 3. Build and Start the Cluster

From your terminal root directory (`/SagaPattern`), execute the following command to spin up all 6 network-isolated containers:

```bash
docker-compose down -v
docker-compose up --build -d
```

### 4. Verify Container Health State

Ensure all services are running smoothly by checking the health statuses:

```bash
docker-compose ps
```

---

## API Verification Suite

### Scenario 1: Successful Sequential Booking Flow

Tests the complete end-to-end forward pipeline where all participants return a success status code.

**Method:** POST

**URL:** `http://localhost:3000/bookings`

**Headers:** `Content-Type: application/json`

**Request Body:**

```json
{
  "userId": "user-123",
  "flightDetails": { "flightNumber": "AI-502" },
  "hotelDetails": { "hotelName": "Novotel Hyd" },
  "carDetails": { "carType": "Sedan" }
}
```

**Instant Response (201 Created):**

```json
{
  "sagaId": "d74f1978-c4bb-494d-a6ca-b526cd7af339",
  "status": "STARTED"
}
```

### Scenario 2: Dynamic Failure and Compensating Rollback

Instructs the system to fail at the Hotel step using the explicit `failAt` parameter.

**Method:** POST

**URL:** `http://localhost:3000/bookings`

**Request Body:**

```json
{
  "userId": "user-456",
  "failAt": "hotel",
  "flightDetails": {},
  "hotelDetails": {},
  "carDetails": {}
}
```

### Scenario 3: 30-Second Resilience Network Timeout

Instructs the Car service to simulate a 35-second network lag, triggering the orchestrator's built-in 30-second client connection ceiling limit.

**Method:** POST

**URL:** `http://localhost:3000/bookings`

**Request Body:**

```json
{
  "userId": "user-789",
  "delayAt": "car",
  "flightDetails": {},
  "hotelDetails": {},
  "carDetails": {}
}
```

---

## Audit Trail and Status Inspection

### 1. Retrieve Current Lifecycle Status

Inspects the global state machine record along with individual participant resource keys.

**Method:** GET

**URL:** `http://localhost:3000/bookings/{sagaId}`

**Response Output Structure (200 OK):**

```json
{
  "sagaId": "d74f1978-c4bb-494d-a6ca-b526cd7af339",
  "status": "COMPLETED",
  "createdAt": "2026-07-10T16:22:40.846Z",
  "steps": {
    "flightReservationId": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "hotelReservationId": "8bf756d1-4221-4d9a-8cbb-18f4a311bde5",
    "carReservationId": "2c94ad83-f30a-42b1-bce2-643bf711a9e8",
    "paymentId": "9fa48f12-b36c-481e-812d-11dcf43229b1"
  }
}
```

### 2. View Detailed Audit Trail Logs

Retrieves the execution history sequence order directly from the database transaction records.

**Method:** GET

**URL:** `http://localhost:3000/sagas/{sagaId}/log`

**Response Output Structure (200 OK):**

```json
{
  "sagaId": "d74f1978-c4bb-494d-a6ca-b526cd7af339",
  "logs": [
    { "stepName": "START", "status": "STARTED", "timestamp": "2026-07-10T16:22:40.846Z" },
    { "stepName": "RESERVE_FLIGHT", "status": "STARTED", "timestamp": "2026-07-10T16:22:40.870Z" },
    { "stepName": "RESERVE_FLIGHT", "status": "COMPLETED", "timestamp": "2026-07-10T16:22:40.994Z" },
    { "stepName": "CONFIRMED", "status": "COMPLETED", "timestamp": "2026-07-10T16:22:41.117Z" }
  ]
}
```

---