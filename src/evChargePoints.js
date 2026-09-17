// EV charge point locations from Open Charge Map (https://openchargemap.org) - a free,
// community-maintained open database. Needs a free API key (sign up at
// openchargemap.org, no ID verification) set as OCM_API_KEY in .env.
//
// Unlike the petrol feeds, OCM's own UsageCost field is free text and often just says
// "pay via operator app" rather than a real number - see evTariffs.js for the
// indicative per-network pricing shown alongside these results instead.
const evTariffs = require("./evTariffs");

const FETCH_TIMEOUT_MS = 15000;

function isConfigured() {
  return Boolean(process.env.OCM_API_KEY);
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "X-API-Key": process.env.OCM_API_KEY },
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizePoi(poi) {
  const lat = poi.AddressInfo?.Latitude;
  const lon = poi.AddressInfo?.Longitude;
  if (typeof lat !== "number" || typeof lon !== "number") return null;

  const connections = (poi.Connections || [])
    .filter((c) => c.ConnectionType || c.PowerKW)
    .map((c) => ({
      type: c.ConnectionType?.Title || "Unknown",
      powerKW: typeof c.PowerKW === "number" ? c.PowerKW : null,
      quantity: c.Quantity || 1,
      operational: c.StatusType ? c.StatusType.IsOperational : null
    }));
  if (connections.length === 0) return null;

  const operator = poi.OperatorInfo?.Title || null;

  return {
    id: `OCM-${poi.ID}`,
    name: poi.AddressInfo?.Title || operator || "Charge point",
    operator: operator || "Unknown operator",
    address: [poi.AddressInfo?.AddressLine1, poi.AddressInfo?.Town].filter(Boolean).join(", "),
    postcode: poi.AddressInfo?.Postcode || "",
    lat,
    lon,
    isOperational: poi.StatusType ? poi.StatusType.IsOperational !== false : true,
    connections,
    maxPowerKW: connections.reduce((max, c) => Math.max(max, c.powerKW || 0), 0),
    usageCostText: poi.UsageCost || null,
    tariff: evTariffs.lookupTariff(operator)
  };
}

async function fetchNearby(lat, lon, radiusMiles) {
  const params = new URLSearchParams({
    output: "json",
    countrycode: "GB",
    latitude: lat,
    longitude: lon,
    distance: radiusMiles,
    distanceunit: "Miles",
    maxresults: "500",
    compact: "false",
    verbose: "true"
  });

  const data = await fetchWithTimeout(`https://api.openchargemap.io/v3/poi/?${params}`);
  return (data || []).map(normalizePoi).filter(Boolean);
}

module.exports = { isConfigured, fetchNearby };
