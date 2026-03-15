# Trip Splitter

A lightweight shared web app for tracking trip expenses across multiple phones.

## Features

- Add trip members.
- Record expenses with a title, total amount, and payer.
- Split bills equally across selected members.
- Split bills with exact per-person owed amounts.
- See live balances for each member.
- Simplify debts into a minimal repayment list at the end of the trip.
- Save shared trip data in PostgreSQL.

## Local run

1. Install dependencies:

   ```bash
   npm install
   ```

2. Set your database connection:

   ```bash
   DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/trip_splitter
   ```

3. Start the server:

   ```bash
   node server.js
   ```

4. Open `http://localhost:3000`.

## Railway

1. Create a Railway project.
2. Add a PostgreSQL service.
3. Deploy this app service in the same project.
4. Set `DATABASE_URL` from the Railway PostgreSQL service.
5. Railway will provide the public app URL for your group to use.

## Notes

- The server auto-creates the required tables on startup.
- Currency is currently formatted as USD in the browser.
- Members used by recorded expenses cannot be removed unless the trip is reset.
