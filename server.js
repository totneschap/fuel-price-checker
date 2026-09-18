require("dotenv").config();
const express = require("express");
const path = require("path");
const { refreshPrices, getCache } = require("./src/fetchPrices");
const { geocodePostcode } = require("./src/geocode");
const { milesBetween } = require("./src/distance");
const evChargePoints = require("./src/evChargePoints");
const cities = require("./src/cities");
const { renderLocationPage, renderLocationsIndex, renderSitemap } = require("./src/seoPages");

const PORT = process.env.PORT || 3000;
const REFRESH_INTERVAL_MS = 20 * 60 * 1000; // 20 minutes

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/status", (req, res) => {
  const cache = getCache();
  res.json({
    fetchedAt: cache.fetchedAt,
    totalStations: cache.stations.length,
    retailers: cache.retailerStatus
  });
});

app.post("/api/refresh", async (req, res) => {
  try {
    const cache = await refreshPrices();
    res.json({
      fetchedAt: cache.fetchedAt,
      totalStations: cache.stations.length,
      retailers: cache.retailerStatus
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function resolveOrigin(query) {
  let { lat, lon, postcode } = query;
  if (lat && lon) {
    return { lat: parseFloat(lat), lon: parseFloat(lon) };
  }
  if (postcode) {
    return geocodePostcode(postcode);
  }
  throw Object.assign(new Error("Provide either a postcode or lat/lon"), { status: 400 });
}

app.get("/api/stations", async (req, res) => {
  try {
    const { fuel = "E10", radius = "5", sort = "price" } = req.query;
    const { lat, lon } = await resolveOrigin(req.query);

    const radiusMiles = parseFloat(radius) || 5;
    const cache = getCache();

    const results = cache.stations
      .filter((s) => typeof s.prices[fuel] === "number")
      .map((s) => ({ ...s, distance: milesBetween(lat, lon, s.lat, s.lon) }))
      .filter((s) => s.distance <= radiusMiles);

    results.sort((a, b) =>
      sort === "distance"
        ? a.distance - b.distance
        : a.prices[fuel] - b.prices[fuel]
    );

    res.json({
      origin: { lat, lon },
      fuel,
      radius: radiusMiles,
      count: results.length,
      fetchedAt: cache.fetchedAt,
      stations: results
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get("/api/ev-stations", async (req, res) => {
  try {
    if (!evChargePoints.isConfigured()) {
      return res.status(503).json({
        error: "EV charging data isn't configured - set OCM_API_KEY in .env (see README)"
      });
    }

    const { radius = "5", connector, sort = "price" } = req.query;
    const { lat, lon } = await resolveOrigin(req.query);
    const radiusMiles = parseFloat(radius) || 5;

    let results = (await evChargePoints.fetchNearby(lat, lon, radiusMiles))
      .filter((s) => s.isOperational)
      .map((s) => ({ ...s, distance: milesBetween(lat, lon, s.lat, s.lon) }));

    if (connector) {
      const needle = connector.toLowerCase();
      results = results.filter((s) =>
        s.connections.some((c) => c.type.toLowerCase().includes(needle))
      );
    }

    results.sort((a, b) => {
      if (sort === "distance") return a.distance - b.distance;
      if (sort === "power") return b.maxPowerKW - a.maxPowerKW;
      // price: known tariffs first (cheapest first), unpriced ones last
      const priceA = a.tariff?.payAsYouGoPencePerKWh ?? Infinity;
      const priceB = b.tariff?.payAsYouGoPencePerKWh ?? Infinity;
      return priceA - priceB;
    });

    res.json({
      origin: { lat, lon },
      radius: radiusMiles,
      count: results.length,
      stations: results
    });
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message });
  }
});

app.get("/petrol-prices", (req, res) => {
  res.send(renderLocationsIndex(cities));
});

app.get("/petrol-prices/:slug", (req, res) => {
  const city = cities.find((c) => c.slug === req.params.slug);
  if (!city) return res.status(404).send("City not found");
  res.send(renderLocationPage(city, getCache(), cities));
});

app.get("/sitemap.xml", (req, res) => {
  res.type("application/xml").send(renderSitemap(cities));
});

app.listen(PORT, async () => {
  console.log(`Fuel price checker running at http://localhost:${PORT}`);
  try {
    const cache = await refreshPrices();
    console.log(`Loaded ${cache.stations.length} stations from ${cache.retailerStatus.filter(r => r.ok).length}/${cache.retailerStatus.length} retailers`);
  } catch (err) {
    console.error("Initial price fetch failed:", err.message);
  }
  setInterval(() => {
    refreshPrices().catch((err) => console.error("Price refresh failed:", err.message));
  }, REFRESH_INTERVAL_MS);
});
