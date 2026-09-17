// Retailers publishing fuel prices under the UK CMA road-fuel open data scheme.
// All feeds share the same JSON shape:
//   { last_updated: "dd/mm/yyyy hh:mm:ss", stations: [{ site_id, brand, address, postcode, location: { latitude, longitude }, prices: { E10, E5, B7, SDV } }] }
//
// The scheme's original guidance page was withdrawn on 1 May 2026 in favour of the
// government's "Fuel Finder" API (which needs OAuth2 registration), but several
// retailers still publish these legacy feeds live. Add/remove entries here as feeds
// come and go - each one is fetched independently, so one failing doesn't break the rest.
module.exports = [
  { name: "Asda", url: "https://storelocator.asda.com/fuel_prices_data.json" },
  { name: "Morrisons", url: "https://www.morrisons.com/fuel-prices/fuel.json" },
  { name: "Esso", url: "https://fuelprices.esso.co.uk/latestdata.json" },
  { name: "Applegreen", url: "https://applegreenstores.com/fuel-prices/data.json" },
  { name: "JET", url: "https://jetlocal.co.uk/fuel_prices_data.json" },
  { name: "Tesco", url: "https://www.tesco.com/fuel_prices/fuel_prices_data.json" }
];
