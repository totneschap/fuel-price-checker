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

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function hhmm(value) {
  return value ? value.slice(0, 5) : null;
}

// Stations that haven't published real hours report "00:00:00"/"00:00:00" with
// is_24_hours false, rather than leaving the fields blank - that's a placeholder, not
// a real (and extremely unusual) midnight-to-midnight closing time, so treat it as
// "unknown, don't show" the same as if the fields were empty.
function isUnpublished(open, close, is24h) {
  return !is24h && (!open || open === "00:00:00") && (!close || close === "00:00:00");
}

function extractOpeningTimes(row) {
  const openingTimes = {};
  for (const day of DAYS) {
    const prefix = `forecourts.opening_times.usual_days.${day}`;
    const open = row[`${prefix}.open_time`];
    const close = row[`${prefix}.close_time`];
    const is24h = row[`${prefix}.is_24_hours`] === "true";
    if (isUnpublished(open, close, is24h)) continue;
    openingTimes[day] = { open: hhmm(open), close: hhmm(close), is24h };
  }

  const bhOpen = row["forecourts.opening_times.bank_holiday.standard.open_time"];
  const bhClose = row["forecourts.opening_times.bank_holiday.standard.close_time"];
  const bhIs24h = row["forecourts.opening_times.bank_holiday.standard.is_24_hours"] === "true";
  if (!isUnpublished(bhOpen, bhClose, bhIs24h)) {
    openingTimes.bankHoliday = { open: hhmm(bhOpen), close: hhmm(bhClose), is24h: bhIs24h };
  }

  return Object.keys(openingTimes).length > 0 ? openingTimes : null;
}

const AMENITY_COLUMNS = {
  "forecourts.amenities.fuel_and_energy_services.adblue_pumps": "adblue_pumps",
  "forecourts.amenities.fuel_and_energy_services.adblue_packaged": "adblue_packaged",
  "forecourts.amenities.fuel_and_energy_services.lpg_pumps": "lpg_pumps",
  "forecourts.amenities.vehicle_services.car_wash": "car_wash",
  "forecourts.amenities.air_pump_or_screenwash": "air_pump_or_screenwash",
  "forecourts.amenities.water_filling": "water_filling",
  "forecourts.amenities.twenty_four_hour_fuel": "twenty_four_hour_fuel",
  "forecourts.amenities.customer_toilets": "customer_toilets"
};

function extractAmenities(row) {
  const amenities = Object.entries(AMENITY_COLUMNS)
    .filter(([column]) => row[column] === "true")
    .map(([, key]) => key);
  return amenities.length > 0 ? amenities : null;
}

// The CSV's price_change_effective_timestamp columns are plain JS Date.toString()
// output (e.g. "Mon Sep 14 2026 15:08:57 GMT+0000 (Coordinated Universal Time)"),
// parseable directly. This is per fuel type, not per station, since different grades
// can change price on different days.
const TIMESTAMP_COLUMNS = {
  E5: "forecourts.price_change_effective_timestamp.E5",
  E10: "forecourts.price_change_effective_timestamp.E10",
  B7: "forecourts.price_change_effective_timestamp.B7S",
  SDV: "forecourts.price_change_effective_timestamp.B7P",
  B10: "forecourts.price_change_effective_timestamp.B10",
  HVO: "forecourts.price_change_effective_timestamp.HVO"
};

function extractPriceChangedAt(row) {
  const result = {};
  for (const [code, column] of Object.entries(TIMESTAMP_COLUMNS)) {
    const raw = row[column];
    if (!raw) continue;
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) result[code] = parsed.toISOString();
  }
  return Object.keys(result).length > 0 ? result : null;
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
    prices,
    openingTimes: extractOpeningTimes(row),
    amenities: extractAmenities(row),
    priceChangedAt: extractPriceChangedAt(row)
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
