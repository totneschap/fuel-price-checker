// Integration with the official UK government "Fuel Finder" API
// (https://www.developer.fuel-finder.service.gov.uk/), the mandatory scheme under
// The Motor Fuel Price (Open Data) Regulations 2025 that covers EVERY UK forecourt,
// including retailers with no free public feed (Sainsbury's, BP, Shell, independents...).
//
// This is disabled unless FUEL_FINDER_CLIENT_ID / FUEL_FINDER_CLIENT_SECRET are set.
// Get those by registering an application via a GOV.UK One Login at:
//   https://www.developer.fuel-finder.service.gov.uk/fuel-finder/get-started-ifr/onelogin
//
// The endpoints below were confirmed by hand against a real registered application
// (Sept 2026) - the public docs describe fields but never publish the literal URLs,
// so this isn't guesswork: token endpoint is JSON (not form-encoded, unlike a standard
// OAuth2 client-credentials request), and the token comes back nested under `data`.
const { normalizeCountry } = require("./ukCountry");

const FUEL_TYPE_MAP = {
  E10: "E10",
  E5: "E5",
  B7_STANDARD: "B7",
  B7_PREMIUM: "SDV",
  B10: "B10",
  HVO: "HVO"
};

const TOKEN_URL =
  process.env.FUEL_FINDER_TOKEN_URL ||
  "https://www.fuel-finder.service.gov.uk/api/v1/oauth/generate_access_token";
const API_BASE =
  process.env.FUEL_FINDER_API_BASE || "https://www.fuel-finder.service.gov.uk/api/v1";

function isConfigured() {
  return Boolean(process.env.FUEL_FINDER_CLIENT_ID && process.env.FUEL_FINDER_CLIENT_SECRET);
}

let cachedToken = null; // { value, expiresAt }

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30000) {
    return cachedToken.value;
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.FUEL_FINDER_CLIENT_ID,
      client_secret: process.env.FUEL_FINDER_CLIENT_SECRET
    })
  });

  if (!res.ok) {
    throw new Error(`Fuel Finder token request failed: HTTP ${res.status}`);
  }

  const body = await res.json();
  if (!body.success || !body.data?.access_token) {
    throw new Error(`Fuel Finder token request failed: ${body.message || "unexpected response shape"}`);
  }

  cachedToken = {
    value: body.data.access_token,
    expiresAt: Date.now() + (body.data.expires_in || 3600) * 1000
  };
  return cachedToken.value;
}

// Paginates via `batch-number` (500 records/batch, confirmed empirically) - the API
// returns HTTP 404 ("Requested batch N is not available") once you're past the end,
// which is the actual stop signal, not an empty array or a `next` link.
async function fetchAllPages(path, token) {
  const items = [];
  const MAX_BATCHES = 500; // safety cap - real data is ~17 batches as of Sept 2026

  for (let batch = 1; batch <= MAX_BATCHES; batch++) {
    const res = await fetch(`${API_BASE}${path}?batch-number=${batch}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.status === 404) break; // past the last batch
    if (!res.ok) throw new Error(`Fuel Finder API request failed: HTTP ${res.status} (${path}, batch ${batch})`);

    const pageItems = await res.json();
    if (!Array.isArray(pageItems) || pageItems.length === 0) break;
    items.push(...pageItems);
  }

  return items;
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

// Stations that haven't published real hours report "00:00:00"/"00:00:00" with
// is_24_hours false, rather than omitting the fields - that's a placeholder, not a
// real (and extremely unusual) midnight-to-midnight closing time, so it's treated the
// same as "unknown, don't show".
function isUnpublished(open, close, is24h) {
  return !is24h && (!open || open === "00:00:00") && (!close || close === "00:00:00");
}

function hhmm(value) {
  return value ? value.slice(0, 5) : null;
}

function extractOpeningTimes(info) {
  const usualDays = info.opening_times?.usual_days;
  if (!usualDays) return null;

  const openingTimes = {};
  for (const day of DAYS) {
    const d = usualDays[day];
    if (!d || isUnpublished(d.open, d.close, d.is_24_hours)) continue;
    openingTimes[day] = { open: hhmm(d.open), close: hhmm(d.close), is24h: Boolean(d.is_24_hours) };
  }

  const bh = info.opening_times?.bank_holiday;
  if (bh && !isUnpublished(bh.open_time, bh.close_time, bh.is_24_hours)) {
    openingTimes.bankHoliday = { open: hhmm(bh.open_time), close: hhmm(bh.close_time), is24h: Boolean(bh.is_24_hours) };
  }

  return Object.keys(openingTimes).length > 0 ? openingTimes : null;
}

function normalizePrices(feedPrices) {
  const prices = {};
  const priceChangedAt = {};
  for (const entry of feedPrices || []) {
    const mapped = FUEL_TYPE_MAP[entry.fuel_type] || entry.fuel_type;
    const price = Number(entry.price);
    if (!mapped || !Number.isFinite(price)) continue;
    prices[mapped] = price;
    // Already ISO 8601/RFC 3339 per the API docs - no parsing needed.
    if (entry.price_change_effective_timestamp) priceChangedAt[mapped] = entry.price_change_effective_timestamp;
  }
  return { prices, priceChangedAt };
}

async function fetchStations() {
  const token = await getAccessToken();

  const [infoRecords, priceRecords] = await Promise.all([
    fetchAllPages("/pfs", token),
    fetchAllPages("/pfs/fuel-prices", token)
  ]);

  const priceByNodeId = new Map(priceRecords.map((p) => [p.node_id, p]));

  const stations = infoRecords
    .map((info) => {
      const priceRecord = priceByNodeId.get(info.node_id);
      if (!priceRecord) return null;

      const { prices, priceChangedAt } = normalizePrices(priceRecord.fuel_prices);
      if (Object.keys(prices).length === 0) return null;

      const lat = Number(info.location?.latitude);
      const lon = Number(info.location?.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

      const address = [info.location?.address_line_1, info.location?.address_line_2]
        .filter(Boolean)
        .join(", ");

      return {
        id: `FuelFinder-${info.node_id}`,
        retailer: "Fuel Finder",
        brand: info.brand_name || info.trading_name || "Unknown",
        address,
        postcode: info.location?.postcode || "",
        country: normalizeCountry(info.location?.country),
        lat,
        lon,
        prices,
        openingTimes: extractOpeningTimes(info),
        amenities: Array.isArray(info.amenities) && info.amenities.length > 0 ? info.amenities : null,
        priceChangedAt: Object.keys(priceChangedAt).length > 0 ? priceChangedAt : null
      };
    })
    .filter(Boolean);

  return { stations, stationCount: stations.length };
}

module.exports = { isConfigured, fetchStations };
