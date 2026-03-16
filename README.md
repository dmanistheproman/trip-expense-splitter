# Trip Splitter

A lightweight shared web app for tracking trip expenses across multiple phones.

## Features

- Add trip members.
- Record expenses with a title, total amount, and payer.
- Split bills equally across selected members.
- Split bills with exact per-person owed amounts.
- Choose an expense currency and convert it to SGD using the historical day rate.
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

3. Optional: set your XChange API key for server-side FX lookups:

   ```bash
   XCHANGE_API_KEY=your_secret_key
   ```

4. Start the server:

   ```bash
   node server.js
   ```

5. Open `http://localhost:3000`.

## Browser-only test mode

- Open `local.html` directly in a browser.
- This version does not use Node, PostgreSQL, or Railway.
- Data is stored in `localStorage` in that browser only.

## Railway

1. Create a Railway project.
2. Add a PostgreSQL service.
3. Deploy this app service in the same project.
4. Set `DATABASE_URL` from the Railway PostgreSQL service.
5. Set `XCHANGE_API_KEY` in Railway for paid FX lookups.
6. Railway will provide the public app URL for your group to use.

## Notes

- The server auto-creates the required tables on startup.
- Historical FX rates are fetched from XChange when `XCHANGE_API_KEY` is set, otherwise the server falls back to Frankfurter.
- Balances and settlements are shown in SGD; each expense also shows its original currency.
- Members used by recorded expenses cannot be removed unless the trip is reset.
