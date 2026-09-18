// Server-rendered SEO landing pages for /petrol-prices/<city-slug>. Each page is
// real HTML generated from live station data at request time (the in-memory cache is
// cheap to filter/sort - no extra caching layer needed), giving search engines
// genuinely unique, current content per city rather than one thin template repeated
// with a name swapped in.
const { milesBetween } = require("./distance");

const BASE_URL = "https://ukfuelchecker.co.uk";
const RADIUS_MILES = 10;
const FUELS = [
  { code: "E10", label: "Petrol (E10)" },
  { code: "B7", label: "Diesel (B7)" }
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

function stationsNear(cache, city, fuelCode) {
  return cache.stations
    .filter((s) => typeof s.prices[fuelCode] === "number")
    .map((s) => ({ ...s, distance: milesBetween(city.lat, city.lon, s.lat, s.lon) }))
    .filter((s) => s.distance <= RADIUS_MILES)
    .sort((a, b) => a.prices[fuelCode] - b.prices[fuelCode]);
}

function stationTable(stations, fuelCode) {
  if (stations.length === 0) {
    return `<p class="empty-note">No stations selling this fuel were found within ${RADIUS_MILES} miles.</p>`;
  }

  const rows = stations
    .slice(0, 10)
    .map(
      (s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td>${escapeHtml(s.brand)}</td>
        <td>${escapeHtml(s.address)}${s.postcode ? ", " + escapeHtml(s.postcode) : ""}</td>
        <td>${s.distance.toFixed(1)} mi</td>
        <td class="price-cell">${s.prices[fuelCode].toFixed(1)}p</td>
      </tr>`
    )
    .join("");

  return `
    <table class="price-table">
      <thead>
        <tr><th>#</th><th>Station</th><th>Address</th><th>Distance</th><th>Price</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

function nearbyCityLinks(city, allCities, count = 6) {
  return allCities
    .filter((c) => c.slug !== city.slug)
    .map((c) => ({ ...c, distance: milesBetween(city.lat, city.lon, c.lat, c.lon) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count)
    .map((c) => `<a href="/petrol-prices/${c.slug}">${escapeHtml(c.name)}</a>`)
    .join(", ");
}

function renderLocationPage(city, cache, allCities) {
  const fuelData = FUELS.map((f) => ({
    ...f,
    stations: stationsNear(cache, city, f.code)
  }));

  const cheapestPetrol = fuelData[0].stations[0];
  const updated = cache.fetchedAt ? new Date(cache.fetchedAt).toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" }) : "recently";

  const title = `Cheapest Petrol &amp; Diesel Prices in ${escapeHtml(city.name)} Today | UK Fuel Price Checker`;
  const description = cheapestPetrol
    ? `Compare live petrol and diesel prices in ${city.name}. Cheapest unleaded today: ${cheapestPetrol.prices.E10.toFixed(1)}p/litre at ${cheapestPetrol.brand}. Updated ${updated}.`
    : `Compare live petrol and diesel prices near ${city.name}, updated throughout the day.`;
  const canonicalUrl = `${BASE_URL}/petrol-prices/${city.slug}`;

  const sections = fuelData
    .map(
      (f) => `
      <h2>${f.label} prices in ${escapeHtml(city.name)}</h2>
      ${stationTable(f.stations, f.code)}`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${title}</title>
  <meta name="description" content="${escapeHtml(description)}" />
  <link rel="canonical" href="${canonicalUrl}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${escapeHtml(description)}" />
  <meta property="og:url" content="${canonicalUrl}" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="legal-page location-page">
    <a href="/" class="back-link">&larr; Back to Fuel Price Checker</a>
    <h1>Petrol &amp; Diesel Prices in ${escapeHtml(city.name)}</h1>
    <p class="last-updated">Prices updated ${updated} &middot; showing stations within ${RADIUS_MILES} miles of ${escapeHtml(city.name)} city centre</p>

    <p>Looking for the cheapest place to fill up in ${escapeHtml(city.name)}? Below are the current lowest petrol and diesel prices from stations near the city centre, pulled live from the UK government's Fuel Finder open data scheme and updated regularly throughout the day.</p>

    ${sections}

    <p><a href="/?lat=${city.lat}&amp;lon=${city.lon}&amp;name=${encodeURIComponent(city.name)}" class="cta-link">Search all fuel types and EV charging near ${escapeHtml(city.name)} &rarr;</a></p>

    <h2>Nearby locations</h2>
    <p>${nearbyCityLinks(city, allCities)}</p>

    <p class="footer-links"><a href="/petrol-prices">All locations</a> &middot; <a href="/privacy.html">Privacy Policy</a></p>
  </div>
</body>
</html>`;
}

function renderLocationsIndex(allCities) {
  const links = [...allCities]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => `<li><a href="/petrol-prices/${c.slug}">${escapeHtml(c.name)}</a></li>`)
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>Petrol &amp; Diesel Prices by UK City | UK Fuel Price Checker</title>
  <meta name="description" content="Compare live petrol and diesel prices in ${allCities.length} UK cities and towns. Pick your location to see the cheapest fuel nearby." />
  <link rel="canonical" href="${BASE_URL}/petrol-prices" />
  <link rel="stylesheet" href="/styles.css" />
</head>
<body>
  <div class="legal-page location-page">
    <a href="/" class="back-link">&larr; Back to Fuel Price Checker</a>
    <h1>Petrol &amp; Diesel Prices by City</h1>
    <p>Choose a location to see today's cheapest petrol and diesel prices nearby.</p>
    <ul class="city-list">${links}</ul>
  </div>
</body>
</html>`;
}

function renderSitemap(allCities) {
  const staticUrls = ["/", "/petrol-prices", "/privacy.html"];
  const cityUrls = allCities.map((c) => `/petrol-prices/${c.slug}`);
  const urls = [...staticUrls, ...cityUrls]
    .map((path) => `  <url><loc>${BASE_URL}${path}</loc></url>`)
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`;
}

module.exports = { renderLocationPage, renderLocationsIndex, renderSitemap };
