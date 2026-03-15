# File Overview

## Core app files

### `index.html`

- Defines the main page structure for the trip expense tracker.
- Contains the sections for members, expense entry, balances, settlement summary, and expense history.
- Loads the shared styles from `style.css` and the browser logic from `app.js`.

### `style.css`

- Holds the visual design for the app.
- Uses a mobile-first layout so the interface works well on phones first, then expands for larger screens.
- Styles forms, cards, buttons, sync status, summaries, and responsive layout behavior.

### `app.js`

- Runs in the browser as the frontend logic.
- Handles user actions like adding members, submitting expenses, resetting the trip, and syncing data.
- Calls the backend API with `fetch`.
- Renders members, balances, simplified settlements, and expense history into the page.

### `server.js`

- Runs in Node.js as the backend server.
- Serves the static frontend files such as `index.html`, `style.css`, and `app.js`.
- Exposes API routes like `/api/state`, `/api/members`, `/api/expenses`, and `/api/reset`.
- Connects to PostgreSQL using `pg`.
- Creates the required database tables automatically on startup if they do not exist.

## Project metadata

### `package.json`

- Describes the Node project.
- Lists dependencies, currently including `pg` for PostgreSQL.
- Defines scripts such as `npm start` and `npm run dev`.

### `package-lock.json`

- Records the exact dependency versions installed for the project.
- Helps keep installs reproducible across machines and deployments.

### `README.md`

- Provides setup and usage instructions for the project.
- Explains how to run the app locally and how to connect it to Railway/PostgreSQL.

### `.gitignore`

- Tells Git which files or folders should not be committed.
- Currently excludes `node_modules`.

## Generated or environment-specific files

### `node_modules/`

- Created by `npm install`.
- Contains installed packages used by the app.
- Not normally committed to Git.
