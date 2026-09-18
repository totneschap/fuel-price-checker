// Tracks daily fuel price snapshots in Postgres so the national dashboard can show
// "biggest price movers in the last 24 hours" - something a single live snapshot
// can't answer on its own. Needs DATABASE_URL (a free Neon/Supabase Postgres works
// fine) - entirely optional, degrades gracefully to "movers unavailable" without it.
//
// Render's free tier wipes the local filesystem on every deploy, so this data has to
// live somewhere external to survive - a small daily snapshot table, not per-request
// writes, keeps a free-tier Postgres instance comfortably within its limits.
const { Pool } = require("pg");

let pool = null;

function isConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }
  return pool;
}

async function ensureSchema() {
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS price_history (
      station_id TEXT NOT NULL,
      fuel_code TEXT NOT NULL,
      price NUMERIC NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (station_id, fuel_code)
    )
  `);
}

const SNAPSHOT_INTERVAL_HOURS = 23; // just under a day, so it drifts earlier rather than later
const CHUNK_SIZE = 1000; // rows per multi-row upsert, well under Postgres's param limit

async function lastSnapshotAt() {
  const { rows } = await getPool().query("SELECT MAX(recorded_at) AS at FROM price_history");
  return rows[0]?.at ? new Date(rows[0].at) : null;
}

function chunk(array, size) {
  const chunks = [];
  for (let i = 0; i < array.length; i += size) chunks.push(array.slice(i, i + size));
  return chunks;
}

async function upsertBatch(rows) {
  if (rows.length === 0) return;
  const values = [];
  const placeholders = rows
    .map((r, i) => {
      const base = i * 4;
      values.push(r.stationId, r.fuelCode, r.price, r.recordedAt);
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
    })
    .join(",");

  await getPool().query(
    `INSERT INTO price_history (station_id, fuel_code, price, recorded_at)
     VALUES ${placeholders}
     ON CONFLICT (station_id, fuel_code) DO UPDATE SET price = EXCLUDED.price, recorded_at = EXCLUDED.recorded_at`,
    values
  );
}

// Only actually snapshots if enough time has passed since the last one - safe to call
// on every price refresh (every 20 min) without spamming the database.
async function maybeSnapshot(stations) {
  const last = await lastSnapshotAt();
  if (last && Date.now() - last.getTime() < SNAPSHOT_INTERVAL_HOURS * 60 * 60 * 1000) {
    return { taken: false };
  }

  const now = new Date();
  const rows = [];
  for (const station of stations) {
    for (const [fuelCode, price] of Object.entries(station.prices)) {
      rows.push({ stationId: station.id, fuelCode, price, recordedAt: now });
    }
  }

  for (const batch of chunk(rows, CHUNK_SIZE)) {
    await upsertBatch(batch);
  }

  return { taken: true, rowCount: rows.length };
}

// Compares current station prices against the last snapshot, returning the biggest
// drops and rises for one fuel type. "24h" is approximate - it's really "since the
// last daily snapshot", which lands within a few hours of 24h by design.
async function getMovers(stations, fuelCode, limit = 5) {
  const { rows } = await getPool().query(
    "SELECT station_id, price, recorded_at FROM price_history WHERE fuel_code = $1",
    [fuelCode]
  );
  if (rows.length === 0) return { drops: [], rises: [], since: null };

  const previousByStation = new Map(rows.map((r) => [r.station_id, Number(r.price)]));
  const since = rows[0].recorded_at;

  const changes = stations
    .filter((s) => typeof s.prices[fuelCode] === "number" && previousByStation.has(s.id))
    .map((s) => {
      const previousPrice = previousByStation.get(s.id);
      const currentPrice = s.prices[fuelCode];
      return { ...s, previousPrice, currentPrice, delta: currentPrice - previousPrice };
    })
    .filter((s) => s.delta !== 0);

  const drops = [...changes].sort((a, b) => a.delta - b.delta).slice(0, limit);
  const rises = [...changes].sort((a, b) => b.delta - a.delta).slice(0, limit);

  return { drops, rises, since };
}

module.exports = { isConfigured, ensureSchema, maybeSnapshot, getMovers };
