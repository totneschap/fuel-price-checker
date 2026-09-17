// Loads the official Fuel Finder CSV export (downloaded manually, or via the email
// subscription at https://www.developer.fuel-finder.service.gov.uk/) from the local
// data/ folder. This covers every UK forecourt by law, including retailers with no
// free public feed (Sainsbury's, BP, Shell, independents...).
//
// The file is re-read from disk on every refresh cycle, so dropping a newer export
// into data/ (any filename, .csv extension) picks it up automatically - it just has
// to be the only .csv file there, or the most recently modified one.
const fs = require("fs/promises");
const path = require("path");
const { parse } = require("csv-parse/sync");

const DATA_DIR = path.join(__dirname, "..", "data");

// Maps the CSV's fuel columns onto the same short codes the free retailer feeds use.
const FUEL_COLUMNS = {
  E5: "forecourts.fuel_price.E5",
  E10: "forecourts.fuel_price.E10",
  B7: "forecourts.fuel_price.B7S",
  SDV: "forecourts.fuel_price.B7P",
  B10: "forecourts.fuel_price.B10",
  HVO: "forecourts.fuel_price.HVO"
};

async function findLatestCsv() {
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true }).catch(() => []);
  const csvFiles = entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".csv"));
  if (csvFiles.length === 0) return null;

  const withStats = await Promise.all(
    csvFiles.map(async (f) => {
      const full = path.join(DATA_DIR, f.name);
      const stat = await fs.stat(full);
      return { path: full, mtime: stat.mtimeMs };
    })
  );
  withStats.sort((a, b) => b.mtime - a.mtime);
  return withStats[0];
}

function toNumber(value) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeRow(row) {
  const lat = toNumber(row["forecourts.location.latitude"]);
  const lon = toNumber(row["forecourts.location.longitude"]);
  if (lat === null || lon === null) return null;

  const prices = {};
  for (const [code, column] of Object.entries(FUEL_COLUMNS)) {
    const price = toNumber(row[column]);
    if (price !== null) prices[code] = price;
  }
  if (Object.keys(prices).length === 0) return null;

  const address = [
    row["forecourts.location.address_line_1"],
    row["forecourts.location.address_line_2"],
    row["forecourts.location.city"]
  ]
    .filter(Boolean)
    .join(", ");

  return {
    id: `FuelFinder-${row["forecourts.node_id"]}`,
    retailer: "Fuel Finder",
    brand: row["forecourts.brand_name"] || row["forecourts.trading_name"] || "Unknown",
    address,
    postcode: row["forecourts.location.postcode"] || "",
    lat,
    lon,
    prices
  };
}

async function isAvailable() {
  return Boolean(await findLatestCsv());
}

async function loadStations() {
  const latest = await findLatestCsv();
  if (!latest) return { stations: [], fileName: null, fileModifiedAt: null };

  const raw = await fs.readFile(latest.path, "utf8");
  const rows = parse(raw, { columns: true, skip_empty_lines: true, relax_column_count: true });
  const stations = rows.map(normalizeRow).filter(Boolean);

  return {
    stations,
    fileName: path.basename(latest.path),
    fileModifiedAt: new Date(latest.mtime).toISOString()
  };
}

module.exports = { isAvailable, loadStations };
