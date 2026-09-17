const retailers = require("./retailers");
const fuelFinder = require("./fuelFinder");
const fuelFinderCsv = require("./fuelFinderCsv");

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  Accept: "application/json,text/plain,*/*"
};

const FETCH_TIMEOUT_MS = 15000;

let cache = {
  stations: [],
  fetchedAt: null,
  retailerStatus: []
};

function toNumber(value) {
  const n = typeof value === "string" ? parseFloat(value) : value;
  return Number.isFinite(n) ? n : null;
}

function normalizeStation(raw, retailerName) {
  const lat = toNumber(raw.location?.latitude);
  const lon = toNumber(raw.location?.longitude);
  if (lat === null || lon === null) return null;

  const prices = {};
  for (const [fuel, price] of Object.entries(raw.prices || {})) {
    const n = toNumber(price);
    if (n !== null) prices[fuel] = n;
  }
  if (Object.keys(prices).length === 0) return null;

  return {
    id: `${retailerName}-${raw.site_id}`,
    retailer: retailerName,
    brand: raw.brand || retailerName,
    address: raw.address || "",
    postcode: raw.postcode || "",
    lat,
    lon,
    prices
  };
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: BROWSER_HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizedPostcode(postcode) {
  return (postcode || "").toUpperCase().replace(/\s+/g, "");
}

// An "authoritative" source (Fuel Finder, from CSV or the API) covers every UK
// forecourt by law, so it duplicates the legacy retailer feeds - prefer its data
// (more complete, and for the API, always fresh) and only keep legacy entries for
// sites it didn't report, matched by postcode.
function mergeAuthoritative(baseStations, authoritativeStations) {
  const authoritativePostcodes = new Set(
    authoritativeStations.map((s) => normalizedPostcode(s.postcode))
  );
  const remaining = baseStations.filter(
    (s) => !authoritativePostcodes.has(normalizedPostcode(s.postcode))
  );
  return [...remaining, ...authoritativeStations];
}

async function refreshPrices() {
  const results = await Promise.allSettled(
    retailers.map((r) => fetchWithTimeout(r.url))
  );

  let stations = [];
  const retailerStatus = [];

  results.forEach((result, i) => {
    const retailer = retailers[i];
    if (result.status === "fulfilled") {
      const data = result.value;
      const parsed = (data.stations || [])
        .map((s) => normalizeStation(s, retailer.name))
        .filter(Boolean);
      stations.push(...parsed);
      retailerStatus.push({
        name: retailer.name,
        ok: true,
        stationCount: parsed.length,
        feedLastUpdated: data.last_updated || null
      });
    } else {
      retailerStatus.push({
        name: retailer.name,
        ok: false,
        error: result.reason?.message || String(result.reason)
      });
    }
  });

  // Prefer a local Fuel Finder CSV export over the live API when both are available -
  // it needs no OAuth setup and has already proven to load real, complete data.
  if (await fuelFinderCsv.isAvailable()) {
    try {
      const { stations: ffStations, fileName, fileModifiedAt } = await fuelFinderCsv.loadStations();
      stations = mergeAuthoritative(stations, ffStations);
      retailerStatus.push({
        name: "Fuel Finder (CSV)",
        ok: true,
        stationCount: ffStations.length,
        fileName,
        fileModifiedAt
      });
    } catch (err) {
      retailerStatus.push({ name: "Fuel Finder (CSV)", ok: false, error: err.message });
    }
  } else if (fuelFinder.isConfigured()) {
    try {
      const { stations: ffStations, stationCount } = await fuelFinder.fetchStations();
      stations = mergeAuthoritative(stations, ffStations);
      retailerStatus.push({ name: "Fuel Finder (API)", ok: true, stationCount });
    } catch (err) {
      retailerStatus.push({ name: "Fuel Finder (API)", ok: false, error: err.message });
    }
  }

  cache = { stations, fetchedAt: new Date().toISOString(), retailerStatus };
  return cache;
}

function getCache() {
  return cache;
}

module.exports = { refreshPrices, getCache };
