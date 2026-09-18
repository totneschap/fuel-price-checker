// Server-rendered national fuel price dashboard at /uk-fuel-prices-live, inspired by
// petrolprices.co.uk's live tracker: national averages, extremes, top 10 cheapest/
// priciest, regional and brand breakdowns, computed fresh from the live cache on each
// request. "Price movers" (biggest 24h changes) only appears when priceHistory has a
// database configured - it needs a snapshot to compare against, which a single live
// snapshot can't provide on its own.
const { brandLogoUrl } = require("./brandLogos");

const BASE_URL = "https://ukfuelchecker.co.uk";
const FUELS = [
  { code: "E10", label: "Petrol (E10)" },
  { code: "B7", label: "Diesel (B7)" }
];
const COUNTRIES = ["England", "Scotland", "Wales", "Northern Ireland"];
const MAJOR_BRANDS = [
  { match: /asda/i, name: "Asda" },
  { match: /tesco/i, name: "Tesco" },
  { match: /morrisons/i, name: "Morrisons" },
  { match: /sainsbury/i, name: "Sainsbury's" },
  { match: /\bbp\b/i, name: "BP" },
  { match: /shell/i, name: "Shell" },
  { match: /esso/i, name: "Esso" },
  { match: /texaco/i, name: "Texaco" },
  { match: /\bjet\b/i, name: "JET" },
  { match: /applegreen/i, name: "Applegreen" },
  { match: /costco/i, name: "Costco" }
];

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[c]);
}

function stationsWithFuel(stations, fuelCode) {
  return stations.filter((s) => typeof s.prices[fuelCode] === "number");
}

function average(stations, fuelCode) {
  if (stations.length === 0) return null;
  const sum = stations.reduce((acc, s) => acc + s.prices[fuelCode], 0);
  return sum / stations.length;
}

function extremes(stations, fuelCode) {
  if (stations.length === 0) return null;
  let min = stations[0];
  let max = stations[0];
  for (const s of stations) {
    if (s.prices[fuelCode] < min.prices[fuelCode]) min = s;
    if (s.prices[fuelCode] > max.prices[fuelCode]) max = s;
  }
  return { min, max };
}

function regionalCheapest(stations, fuelCode) {
  return COUNTRIES.map((country) => {
    const inCountry = stations.filter((s) => s.country === country);
    if (inCountry.length === 0) return { country, cheapest: null };
    const cheapest = inCountry.reduce((a, b) => (a.prices[fuelCode] <= b.prices[fuelCode] ? a : b));
    return { country, cheapest };
  }).filter((r) => r.cheapest);
}

function brandCheapest(stations, fuelCode) {
  return MAJOR_BRANDS.map(({ match, name }) => {
    const matching = stations.filter((s) => match.test(s.brand));
    if (matching.length === 0) return null;
    const cheapest = matching.reduce((a, b) => (a.prices[fuelCode] <= b.prices[fuelCode] ? a : b));
    return { name, price: cheapest.prices[fuelCode] };
  })
    .filter(Boolean)
    .sort((a, b) => a.price - b.price);
}

function stationRow(station, fuelCode, extraLine) {
  const logo = brandLogoUrl(station.brand);
  return `
    <li class="station-card">
      <div class="station-info">
        <div class="station-brand">
          ${logo ? `<img class="loc-brand-logo" src="${logo}" alt="" />` : ""}
          ${escapeHtml(station.brand)}
        </div>
        <div class="station-address">${escapeHtml(station.address)}${station.postcode ? ", " + escapeHtml(station.postcode) : ""}</div>
        ${extraLine || ""}
      </div>
      <div class="station-price">
        <span class="pence">${station.prices[fuelCode].toFixed(1)}p</span>
      </div>
    </li>`;
}

function rankedList(stations, fuelCode, order, limit) {
  const sorted = [...stations].sort((a, b) =>
    order === "asc" ? a.prices[fuelCode] - b.prices[fuelCode] : b.prices[fuelCode] - a.prices[fuelCode]
  );
  const rows = sorted.slice(0, limit).map((s) => stationRow(s, fuelCode));
  return `<ul class="results loc-results">${rows.join("")}</ul>`;
}

function moversList(movers, fuelCode) {
  if (!movers || movers.drops.length === 0) return "";

  const row = (m, arrow, cls) => `
    <li class="station-card">
      <div class="station-info">
        <div class="station-brand">${arrow ? `<span class="mover-arrow ${cls}">${arrow}</span>` : ""}${escapeHtml(m.brand)}</div>
        <div class="station-address">${escapeHtml(m.address)}${m.postcode ? ", " + escapeHtml(m.postcode) : ""}</div>
        <div class="station-distance">${m.previousPrice.toFixed(1)}p &rarr; ${m.currentPrice.toFixed(1)}p</div>
      </div>
      <div class="station-price ${cls}">
        <span class="pence">${m.delta > 0 ? "+" : ""}${m.delta.toFixed(1)}p</span>
      </div>
    </li>`;

  return `
    <div class="movers-grid">
      <div>
        <h3>Biggest drops</h3>
        <ul class="results loc-results">${movers.drops.map((m) => row(m, "&#9660;", "cheap")).join("")}</ul>
      </div>
      <div>
        <h3>Biggest rises</h3>
        <ul class="results loc-results">${movers.rises.map((m) => row(m, "&#9650;", "pricey")).join("")}</ul>
      </div>
    </div>`;
}

function fuelSection(cache, fuel, moversForFuel) {
  const stations = stationsWithFuel(cache.stations, fuel.code);
  if (stations.length === 0) return `<h2>${fuel.label}</h2><p class="empty-note">No current data for this fuel type.</p>`;

  const avg = average(stations, fuel.code);
  const ext = extremes(stations, fuel.code);
  const regional = regionalCheapest(stations, fuel.code);
  const brands = brandCheapest(stations, fuel.code);

  const regionalRows = regional
    .map(
      (r) => `<li><strong>${r.country}:</strong> ${r.cheapest.prices[fuel.code].toFixed(1)}p at ${escapeHtml(r.cheapest.brand)}, ${escapeHtml(r.cheapest.postcode)}</li>`
    )
    .join("");

  const brandChips = brands
    .map((b) => `<span class="city-chip">${escapeHtml(b.name)}: <strong>${b.price.toFixed(1)}p</strong></span>`)
    .join("");

  return `
    <h2>${fuel.label}</h2>
    <div class="stats-bar">
      <div class="stat-chip"><span class="stat-value">${avg.toFixed(1)}p</span><span class="stat-label">national average</span></div>
      <div class="stat-chip"><span class="stat-value">${ext.min.prices[fuel.code].toFixed(1)}p</span><span class="stat-label">cheapest (${escapeHtml(ext.min.postcode)})</span></div>
      <div class="stat-chip"><span class="stat-value">${ext.max.prices[fuel.code].toFixed(1)}p</span><span class="stat-label">most expensive (${escapeHtml(ext.max.postcode)})</span></div>
      <div class="stat-chip"><span class="stat-value">${(ext.max.prices[fuel.code] - ext.min.prices[fuel.code]).toFixed(1)}p</span><span class="stat-label">UK spread</span></div>
    </div>

    ${moversForFuel && moversForFuel.drops.length > 0 ? `<h3>Biggest movers since ${new Date(moversForFuel.since).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" })}</h3>${moversList(moversForFuel, fuel.code)}` : ""}

    <h3>Top 10 cheapest</h3>
    ${rankedList(stations, fuel.code, "asc", 10)}

    <h3>Top 10 most expensive</h3>
    ${rankedList(stations, fuel.code, "desc", 10)}

    <h3>Cheapest by nation</h3>
    <ul class="regional-list">${regionalRows}</ul>

    <h3>Cheapest by major brand</h3>
    <p class="city-chip-row">${brandChips}</p>
  `;
}

function renderNationalDashboard(cache, movers) {
  const updated = cache.fetchedAt
    ? new Date(cache.fetchedAt).toLocaleString("en-GB", { dateStyle: "full", timeStyle: "short" })
    : "recently";

  const sections = FUELS.map((f) => fuelSection(cache, f, movers?.[f.code])).join("<hr />");

  const title = "UK Fuel Prices Live | National Petrol & Diesel Price Tracker";
  const description = `Live UK-wide petrol and diesel price averages, extremes, top 10 cheapest and most expensive stations, and regional and brand breakdowns, updated continuously from ${cache.stations.length.toLocaleString()} stations.`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <title>${title}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${BASE_URL}/uk-fuel-prices-live" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${BASE_URL}/uk-fuel-prices-live" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="legal-page location-page">
    <a href="/" class="back-link">&larr; Back to Fuel Price Checker</a>
    <header class="topbar">
      <h1>&#9981; UK Fuel Prices Live</h1>
      <p class="last-updated">${updated} &middot; ${cache.stations.length.toLocaleString()} stations tracked nationwide</p>
    </header>

    ${sections}

    <hr />
    <h2>Why do UK fuel prices vary so much?</h2>
    <p>Prices at the pump depend on far more than the wholesale cost of fuel. Motorway service stations carry higher operating costs and limited competition, pushing prices up. Rural and remote forecourts face higher delivery costs to reach them. Supermarket forecourts (Asda, Tesco, Sainsbury's, Morrisons) typically undercut oil-company-branded stations thanks to buying power and fuel-as-a-loss-leader strategies. And prices often cluster locally as nearby stations react to each other's changes, which is why the cheapest fuel in a town is sometimes a few miles from the most expensive.</p>

    <p class="footer-links"><a href="/petrol-prices">Prices by city</a> &middot; <a href="/privacy.html">Privacy Policy</a></p>
  </div>
</body>
</html>`;
}

module.exports = { renderNationalDashboard };
