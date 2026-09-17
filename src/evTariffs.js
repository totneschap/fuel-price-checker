// There's no open, structured, live price feed for UK EV charging (unlike petrol's
// Fuel Finder) - operators must display p/kWh at the charger/app, but aren't required
// to publish it as open data. This is a small, manually-maintained reference table of
// standard pay-as-you-go rapid/ultra-rapid rates, sourced from Zapmap's charging price
// index and network pricing pages as of September 2026. Treat it as indicative, not
// exact - actual price depends on site, charger speed and time of day, and networks
// change prices often. Re-check https://www.zapmap.com/ev-stats/rapid-charging-prices
// periodically and update the numbers below.
const TARIFFS = [
  { match: /instavolt/i, network: "InstaVolt", payAsYouGoPencePerKWh: 92 },
  { match: /tesla/i, network: "Tesla Supercharger", payAsYouGoPencePerKWh: 63, note: "as low as ~22-30p/kWh for Tesla owners/members" },
  { match: /ionity/i, network: "Ionity", payAsYouGoPencePerKWh: 85 },
  { match: /\bbp\s*pulse\b/i, network: "BP Pulse", payAsYouGoPencePerKWh: 79 },
  { match: /shell\s*recharge/i, network: "Shell Recharge", payAsYouGoPencePerKWh: 75 },
  { match: /pod\s*point/i, network: "Pod Point", payAsYouGoPencePerKWh: 80, note: "some Tesco/Lidl AC bays are free" },
  { match: /gridserve/i, network: "GRIDSERVE", payAsYouGoPencePerKWh: 76 },
  { match: /osprey/i, network: "Osprey", payAsYouGoPencePerKWh: 87, note: "82p/kWh via the Osprey app" },
  { match: /motor\s*fuel\s*group|\bmfg\b/i, network: "MFG EV Power", payAsYouGoPencePerKWh: 59 },
  { match: /fastned/i, network: "Fastned", payAsYouGoPencePerKWh: 79 },
  { match: /believ/i, network: "Believ", payAsYouGoPencePerKWh: 66 },
  { match: /sainsbury/i, network: "Sainsbury's Smart Charge", payAsYouGoPencePerKWh: 72 },
  { match: /charge\s*your\s*car|\bcyc\b/i, network: "Charge Your Car", payAsYouGoPencePerKWh: 81 },
  { match: /evbox/i, network: "EVBox", payAsYouGoPencePerKWh: 74 }
];

function lookupTariff(operatorName) {
  if (!operatorName) return null;
  const found = TARIFFS.find((t) => t.match.test(operatorName));
  return found
    ? { network: found.network, payAsYouGoPencePerKWh: found.payAsYouGoPencePerKWh, note: found.note || null }
    : null;
}

module.exports = { lookupTariff };
