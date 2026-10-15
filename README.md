# Loanify API

Backend API for Loanify, a lending platform with user authentication, loans, peer-to-peer offers, payments, wallets, KYC, notifications, and messaging.

## Stack

- Node.js 20+
- Express 5
- PostgreSQL with Prisma
- Redis with BullMQ
- JWT authentication and Passport Google OAuth
- WebSocket support on the same HTTP server

## Requirements

- Node.js 20 or newer
- PostgreSQL
- Redis
- npm

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a local environment file:

   ```bash
   cp .env.example .env
   ```

   On Windows PowerShell, use:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Set the values in `.env`. At minimum, configure `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, and `SESSION_SECRET`. Configure email, Google OAuth, Sumsub, and PayMongo credentials when using those integrations.

4. Generate the Prisma client and apply the database schema:

   ```bash
   npx prisma generate
   npx prisma db push
   ```

5. Start the API:

   ```bash
   npm run dev
   ```

   For a production-style start, use `npm start`.

The API listens on `http://localhost:3000` by default. A health response is available at `GET /`.

## Docker

The included Compose configuration starts the API and Redis:

```bash
docker compose up --build
```

The container listens on port `3000` and is exposed locally on port `3001` by default. Configure the PostgreSQL connection and application secrets in `.env` before starting the stack.

## API

All API routes are prefixed with `/api`.

| Area | Base path | Authentication |
| --- | --- | --- |
| Authentication and OAuth | `/api/auth` | Public or route-specific |
| Profile | `/api/profile` | Bearer token |
| KYC | `/api/kyc` | Bearer token |
| Loans | `/api/loans` | Bearer token |
| Dashboard | `/api/dashboard` | Bearer token |
| Payments | `/api/payments` | Bearer token |
| Payment methods | `/api/payment-methods` | Bearer token |
| Peer-to-peer lending | `/api/p2p` | Bearer token |
| Notifications | `/api/notifications` | Bearer token |
| Chat | `/api/chat` | Bearer token |
| Wallet | `/api/wallet` | Bearer token |
| Administration | `/api/admin` | Bearer token and admin role |

Use the authentication endpoints to register or log in. Protected endpoints expect:

```http
Authorization: Bearer <token>
```

The server also accepts WebSocket connections on the same host and port as the API.

## Project structure

```text
.
├── index.js              # HTTP and WebSocket server entry point
├── route/api.js          # API route aggregation
├── src/controllers       # Request handlers
├── src/routes            # Feature route definitions
├── src/middlewares       # Authentication, authorization, and validation
├── src/services          # Scheduled and domain services
├── src/queues            # Background job queues and workers
├── prisma/schema.prisma  # Database schema
└── docker-compose.yml    # API and Redis services
```

## Environment

`.env.example` lists the supported configuration values. Never commit `.env` or credentials, JWT secrets, payment keys, OAuth secrets, or KYC provider keys to source control.

Important settings include:

- `PORT`, `NODE_ENV`, and `CLIENT_URL`
- `DATABASE_URL` and `REDIS_URL`
- `JWT_SECRET` and `SESSION_SECRET`
- `EMAIL_USER` and `EMAIL_PASS`
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GOOGLE_CALLBACK_URL`
- `SUMSUB_APP_TOKEN`, `SUMSUB_SECRET_KEY`, and `SUMSUB_LEVEL_NAME`
- `PAYMONGO_SECRET_KEY`

## Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the server with Nodemon |
| `npm start` | Start the server with Node.js |
| `npx prisma generate` | Generate the Prisma client |
| `npx prisma db push` | Apply the Prisma schema to the configured database |
