// Integration with the official UK government "Fuel Finder" API
// (https://www.developer.fuel-finder.service.gov.uk/), the mandatory scheme under
// The Motor Fuel Price (Open Data) Regulations 2025 that covers EVERY UK forecourt,
// including retailers with no free public feed (Sainsbury's, BP, Shell, independents...).
//
// This is disabled unless FUEL_FINDER_CLIENT_ID / FUEL_FINDER_CLIENT_SECRET are set,
// since it requires registering an application via a GOV.UK One Login at:
//   https://www.developer.fuel-finder.service.gov.uk/fuel-finder/get-started-ifr/onelogin
// That registration screen reveals your account's actual token URL and API base URL -
// paste those into .env as FUEL_FINDER_TOKEN_URL / FUEL_FINDER_API_BASE alongside your
// client ID/secret. The generic developer docs don't publish those literal URLs, so the
// defaults below are best-effort placeholders and may need a one-line correction once
// you can see your real dashboard.
//
// Maps the API's fuel_type codes onto the same short codes the free retailer feeds use,
// so both sources merge into one consistent list for the frontend.
const FUEL_TYPE_MAP = {
  E10: "E10",
  E5: "E5",
  B7_Standard: "B7",
  B7_Premium: "SDV",
  B10: "B10",
  HVO: "HVO"
};

const TOKEN_URL =
  process.env.FUEL_FINDER_TOKEN_URL ||
  "https://api.fuelfinder.service.gov.uk/oauth/token";
const API_BASE =
  process.env.FUEL_FINDER_API_BASE || "https://api.fuelfinder.service.gov.uk/v1";

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
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.FUEL_FINDER_CLIENT_ID,
      client_secret: process.env.FUEL_FINDER_CLIENT_SECRET,
      scope: "fuelfinder.read"
    })
  });

  if (!res.ok) {
    throw new Error(`Fuel Finder token request failed: HTTP ${res.status}`);
  }

  const body = await res.json();
  cachedToken = {
    value: body.access_token,
    expiresAt: Date.now() + (body.expires_in || 3600) * 1000
  };
  return cachedToken.value;
}

// Follows whichever pagination shape the API uses (a `next` URL, or a `nextCursor` /
// `nextPageToken` field to append as a query param) up to a sane page cap so a bug or
// unexpected shape can't loop forever.
async function fetchAllPages(path, token) {
  const items = [];
  let url = `${API_BASE}${path}`;
  let cursor = null;
  const MAX_PAGES = 200;

  for (let page = 0; page < MAX_PAGES; page++) {
    const requestUrl = cursor ? `${url}${url.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : url;
    const res = await fetch(requestUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) throw new Error(`Fuel Finder API request failed: HTTP ${res.status} (${requestUrl})`);

    const body = await res.json();
    const pageItems = Array.isArray(body) ? body : body.data || body.items || body.results || [];
    items.push(...pageItems);

    const next = body.next || body.nextPageUrl || body.links?.next || body.meta?.nextCursor || body.nextCursor;
    if (!next || pageItems.length === 0) break;

    if (typeof next === "string" && next.startsWith("http")) {
      url = next;
      cursor = null;
    } else {
      cursor = next;
    }
  }

  return items;
}

const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];

function extractOpeningTimes(info) {
  const usualDays = info.opening_times?.usual_days;
  if (!usualDays) return null;

  const openingTimes = {};
  for (const day of DAYS) {
    const d = usualDays[day];
    if (!d || (!d.open && !d.close && !d.is_24_hours)) continue;
    openingTimes[day] = { open: d.open || null, close: d.close || null, is24h: Boolean(d.is_24_hours) };
  }

  const bh = info.opening_times?.bank_holidays;
  if (bh && (bh.open_time || bh.close_time || bh.is_24_hours)) {
    openingTimes.bankHoliday = { open: bh.open_time || null, close: bh.close_time || null, is24h: Boolean(bh.is_24_hours) };
  }

  return Object.keys(openingTimes).length > 0 ? openingTimes : null;
}

function normalizePrices(feedPrices) {
  const prices = {};
  for (const entry of feedPrices || []) {
    const mapped = FUEL_TYPE_MAP[entry.fuel_type] || entry.fuel_type;
    const price = Number(entry.price);
    if (mapped && Number.isFinite(price)) prices[mapped] = price;
  }
  return prices;
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

      const prices = normalizePrices(priceRecord.fuel_prices);
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
        lat,
        lon,
        prices,
        openingTimes: extractOpeningTimes(info),
        amenities: Array.isArray(info.amenities) && info.amenities.length > 0 ? info.amenities : null
      };
    })
    .filter(Boolean);

  return { stations, stationCount: stations.length };
}

module.exports = { isConfigured, fetchStations };
