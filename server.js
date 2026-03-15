const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { Pool } = require("pg");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;

const pool = new Pool(buildDatabaseConfig());

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    serveStaticFile(response, url.pathname);
  } catch (error) {
    respondJson(response, 500, { error: error.message || "Unexpected server error." });
  }
});

async function startServer(host = HOST, port = PORT) {
  if (!pool.__tripSplitterReady) {
    await initializeDatabase();
    pool.__tripSplitterReady = true;
  }

  return new Promise((resolve) => {
    if (server.listening) {
      resolve(server);
      return;
    }

    server.listen(port, host, () => {
      console.log(`Trip Splitter running at http://${host}:${port}`);
      console.log("PostgreSQL connection pool initialized.");
      resolve(server);
    });
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL,
      paid_by TEXT NOT NULL REFERENCES members(id),
      split_mode TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expense_shares (
      expense_id TEXT NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      member_id TEXT NOT NULL REFERENCES members(id),
      amount NUMERIC(12, 2) NOT NULL,
      PRIMARY KEY (expense_id, member_id)
    );
  `);
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/state") {
    respondJson(response, 200, await readState());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/members") {
    const body = await readJsonBody(request);
    const name = String(body?.name || "").trim();
    if (!name) {
      respondJson(response, 400, { error: "Member name is required." });
      return;
    }

    const duplicate = await pool.query("SELECT 1 FROM members WHERE lower(name) = lower($1)", [name]);
    if (duplicate.rowCount) {
      respondJson(response, 409, { error: "That member already exists." });
      return;
    }

    await pool.query(
      "INSERT INTO members (id, name, created_at) VALUES ($1, $2, $3)",
      [randomUUID(), name, new Date().toISOString()]
    );

    respondJson(response, 201, await readState());
    return;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/members/")) {
    const memberId = decodeURIComponent(url.pathname.slice("/api/members/".length));
    const usage = await pool.query(`
      SELECT 1
      FROM expenses
      WHERE paid_by = $1
      UNION
      SELECT 1
      FROM expense_shares
      WHERE member_id = $1
      LIMIT 1
    `, [memberId]);

    if (usage.rowCount) {
      respondJson(response, 409, {
        error: "This member is already used in recorded expenses and cannot be removed.",
      });
      return;
    }

    const result = await pool.query("DELETE FROM members WHERE id = $1", [memberId]);
    if (!result.rowCount) {
      respondJson(response, 404, { error: "Member not found." });
      return;
    }

    respondJson(response, 200, await readState());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/expenses") {
    const body = await readJsonBody(request);
    const validation = await validateExpensePayload(body);
    if (validation.error) {
      respondJson(response, 400, { error: validation.error });
      return;
    }

    const expenseId = randomUUID();
    const createdAt = new Date().toISOString();

    await runTransaction(async (client) => {
      await client.query(
        `
          INSERT INTO expenses (id, title, amount, paid_by, split_mode, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
        [
          expenseId,
          validation.title,
          validation.amount,
          validation.paidBy,
          validation.splitMode,
          createdAt,
        ]
      );

      for (const share of validation.shares) {
        await client.query(
          `
            INSERT INTO expense_shares (expense_id, member_id, amount)
            VALUES ($1, $2, $3)
          `,
          [expenseId, share.memberId, share.amount]
        );
      }
    });

    respondJson(response, 201, await readState());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/reset") {
    await runTransaction(async (client) => {
      await client.query("DELETE FROM expense_shares");
      await client.query("DELETE FROM expenses");
      await client.query("DELETE FROM members");
    });
    respondJson(response, 200, await readState());
    return;
  }

  respondJson(response, 404, { error: "Route not found." });
}

async function validateExpensePayload(body) {
  const title = String(body?.title || "").trim();
  const amount = roundCurrency(body?.amount);
  const paidBy = String(body?.paidBy || "");
  const splitMode = body?.splitMode === "custom" ? "custom" : "equal";
  const rawShares = Array.isArray(body?.shares) ? body.shares : [];

  if (!title) {
    return { error: "Expense title is required." };
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Expense amount must be greater than zero." };
  }

  const membersResult = await pool.query("SELECT id FROM members");
  const memberIds = new Set(membersResult.rows.map((row) => row.id));

  if (!memberIds.has(paidBy)) {
    return { error: "Payer must be one of the trip members." };
  }

  if (rawShares.length === 0) {
    return { error: "Choose at least one member to split this expense with." };
  }

  const seenMembers = new Set();
  const shares = [];

  for (const rawShare of rawShares) {
    const memberId = String(rawShare?.memberId || "");
    const shareAmount = roundCurrency(rawShare?.amount);

    if (!memberIds.has(memberId)) {
      return { error: "Each share must reference a valid trip member." };
    }

    if (seenMembers.has(memberId)) {
      return { error: "Duplicate members were included in the split." };
    }

    if (!Number.isFinite(shareAmount) || shareAmount < 0) {
      return { error: "Each owed amount must be zero or greater." };
    }

    seenMembers.add(memberId);
    shares.push({ memberId, amount: shareAmount });
  }

  const totalShares = roundCurrency(shares.reduce((sum, share) => sum + share.amount, 0));
  if (Math.abs(totalShares - amount) > 0.009) {
    return { error: "Split amounts must add up exactly to the total expense." };
  }

  return { title, amount, paidBy, splitMode, shares };
}

async function readState() {
  const membersResult = await pool.query(`
    SELECT id, name, created_at AS "createdAt"
    FROM members
    ORDER BY created_at ASC, name ASC
  `);

  const expensesResult = await pool.query(`
    SELECT id, title, amount::float8 AS amount, paid_by AS "paidBy", split_mode AS "splitMode", created_at AS "createdAt"
    FROM expenses
    ORDER BY created_at DESC, id DESC
  `);

  const sharesResult = await pool.query(`
    SELECT expense_id AS "expenseId", member_id AS "memberId", amount::float8 AS amount
    FROM expense_shares
    ORDER BY expense_id ASC, member_id ASC
  `);

  const shareMap = new Map();
  for (const share of sharesResult.rows) {
    const list = shareMap.get(share.expenseId) || [];
    list.push({
      memberId: share.memberId,
      amount: roundCurrency(share.amount),
    });
    shareMap.set(share.expenseId, list);
  }

  return {
    members: membersResult.rows,
    expenses: expensesResult.rows.map((expense) => ({
      ...expense,
      amount: roundCurrency(expense.amount),
      shares: shareMap.get(expense.id) || [],
      participants: (shareMap.get(expense.id) || []).map((share) => share.memberId),
    })),
  };
}

function serveStaticFile(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const resolvedPath = path.normalize(path.join(ROOT_DIR, safePath));

  if (!resolvedPath.startsWith(ROOT_DIR)) {
    respondText(response, 403, "Forbidden");
    return;
  }

  if (!fs.existsSync(resolvedPath) || fs.statSync(resolvedPath).isDirectory()) {
    respondText(response, 404, "Not found");
    return;
  }

  const extension = path.extname(resolvedPath).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
  }[extension] || "application/octet-stream";

  response.writeHead(200, { "Content-Type": contentType });
  response.end(fs.readFileSync(resolvedPath));
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body is too large."));
      }
    });

    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });

    request.on("error", reject);
  });
}

function respondJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function respondText(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  response.end(body);
}

async function runTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await work(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function buildDatabaseConfig() {
  const ssl = shouldUseSsl() ? { rejectUnauthorized: false } : undefined;

  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl,
    };
  }

  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    user: process.env.PGUSER || "postgres",
    password: process.env.PGPASSWORD || "postgres",
    database: process.env.PGDATABASE || "trip_splitter",
    ssl,
  };
}

function shouldUseSsl() {
  if (process.env.DISABLE_DB_SSL === "true") {
    return false;
  }

  if (process.env.DATABASE_URL) {
    return true;
  }

  return !["127.0.0.1", "localhost"].includes(process.env.PGHOST || "127.0.0.1");
}

function roundCurrency(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

module.exports = {
  pool,
  startServer,
  server,
};
