const form = document.getElementById("search-form");
const postcodeInput = document.getElementById("postcode");
const locateBtn = document.getElementById("locate-btn");
const fuelSelect = document.getElementById("fuel");
const fuelField = document.getElementById("fuel-field");
const connectorField = document.getElementById("connector-field");
const connectorSelect = document.getElementById("connector");
const radiusSelect = document.getElementById("radius");
const sortSelect = document.getElementById("sort");
const sortPowerOption = document.getElementById("sort-power");
const resultsEl = document.getElementById("results");
const errorEl = document.getElementById("error");
const feedStatusEl = document.getElementById("feed-status");
const evPriceNoteEl = document.getElementById("ev-price-note");
const modeEmojiEl = document.getElementById("mode-emoji");
const searchBtn = document.getElementById("search-btn");
const tabPetrol = document.getElementById("tab-petrol");
const tabEv = document.getElementById("tab-ev");

let mode = "petrol"; // or "ev"

// Brand/network name -> a domain with a recognisable favicon, used to show a small
// logo on map pins. Uses Google's favicon service (stable and keyless) rather than a
// dedicated logo API - Clearbit's free logo API is dead, and most "free" replacements
// turned out not to actually serve images. Matching is case-insensitive and loose
// since brand names vary in casing/spacing across feeds (e.g. "ASDA" vs "Asda").
const BRAND_LOGO_DOMAINS = [
  { match: /asda/i, domain: "www.asda.com" },
  { match: /tesco/i, domain: "www.tesco.com" },
  { match: /morrisons/i, domain: "www.morrisons.com" },
  { match: /sainsbury/i, domain: "www.sainsburys.co.uk" },
  { match: /\bbp\b/i, domain: "www.bp.com" },
  { match: /shell/i, domain: "www.shell.co.uk" },
  { match: /esso/i, domain: "www.esso.co.uk" },
  { match: /texaco/i, domain: "www.texaco.co.uk" },
  { match: /jet/i, domain: "www.jetlocal.co.uk" },
  { match: /gulf/i, domain: "gulfoil.com" },
  { match: /applegreen/i, domain: "www.applegreenstores.com" },
  { match: /circle\s*k/i, domain: "www.circlek.com" },
  { match: /\bspar\b/i, domain: "www.spar.co.uk" },
  { match: /\bmoto\b/i, domain: "www.moto-way.com" },
  { match: /welcome\s*break/i, domain: "www.welcomebreak.co.uk" },
  { match: /murco/i, domain: "murco.co.uk" },
  { match: /maxol/i, domain: "maxol.ie" },
  // EV networks
  { match: /instavolt/i, domain: "www.instavolt.co.uk" },
  { match: /tesla/i, domain: "www.tesla.com" },
  { match: /ionity/i, domain: "ionity.eu" },
  { match: /gridserve/i, domain: "www.gridserve.com" },
  { match: /osprey/i, domain: "www.ospreycharging.co.uk" },
  { match: /pod\s*point/i, domain: "pod-point.com" },
  { match: /motor\s*fuel\s*group|\bmfg\b/i, domain: "motorfuelgroup.com" }
];

function brandLogoUrl(brand) {
  if (!brand) return null;
  const found = BRAND_LOGO_DOMAINS.find((b) => b.match.test(brand));
  return found ? `https://www.google.com/s2/favicons?domain=${found.domain}&sz=64` : null;
}

const FUEL_LABELS = {
  E10: "Unleaded (E10)",
  E5: "Super Unleaded (E5)",
  B7: "Diesel (B7)",
  SDV: "Super Diesel (SDV)",
  B10: "B10 Diesel",
  HVO: "HVO"
};

// UK fuel duty is a fixed rate set by government budgets, not something retailers
// choose - this schedule is public record. Update it when a new rate takes effect;
// see https://www.gov.uk/government/publications/amended-fuel-duty-rates-for-2026-to-2027
const FUEL_DUTY_SCHEDULE = [
  { from: "2026-03-01", pencePerLitre: 52.95 },
  { from: "2026-09-01", pencePerLitre: 53.95 },
  { from: "2026-12-01", pencePerLitre: 55.95 },
  { from: "2027-03-01", pencePerLitre: 57.95 }
];

function currentFuelDuty() {
  const now = new Date();
  let rate = FUEL_DUTY_SCHEDULE[0].pencePerLitre;
  for (const entry of FUEL_DUTY_SCHEDULE) {
    if (now >= new Date(entry.from)) rate = entry.pencePerLitre;
  }
  return rate;
}

// VAT is 20% of the VAT-inclusive pump price, i.e. 1/6 of the total - not 20% of the
// pre-VAT price. Duty is a fixed pence-per-litre amount; whatever's left is the
// retailer's fuel cost, supply chain and margin.
function priceBreakdown(pricePence) {
  const duty = currentFuelDuty();
  const vat = pricePence / 6;
  const retail = pricePence - duty - vat;
  return { duty, vat, retail };
}

const DAY_KEYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function minutesSinceMidnight(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function isOpenAt(nowMinutes, open, close) {
  const openMin = minutesSinceMidnight(open);
  let closeMin = minutesSinceMidnight(close);
  if (closeMin <= openMin) closeMin += 24 * 60; // closing time past midnight
  return nowMinutes >= openMin && nowMinutes <= closeMin;
}

function openingHoursHtml(openingTimes) {
  if (!openingTimes) return "";
  const now = new Date();
  const today = openingTimes[DAY_KEYS[now.getDay()]];
  if (!today) return "";

  let hoursText, isOpen;
  if (today.is24h) {
    hoursText = "Open 24 hours";
    isOpen = true;
  } else if (today.open && today.close) {
    hoursText = `Today: ${today.open}–${today.close}`;
    isOpen = isOpenAt(now.getHours() * 60 + now.getMinutes(), today.open, today.close);
  } else {
    return "";
  }

  return `<div class="popup-hours"><span class="popup-badge ${isOpen ? "open" : "closed"}">${isOpen ? "Open now" : "Closed"}</span><span>${hoursText}</span></div>`;
}

const AMENITY_LABELS = {
  adblue_pumps: "AdBlue",
  adblue_packaged: "AdBlue",
  lpg_pumps: "LPG",
  car_wash: "Car wash",
  air_pump_or_screenwash: "Air/screenwash",
  water_filling: "Water",
  twenty_four_hour_fuel: "24hr fuel",
  customer_toilets: "WC"
};

function amenitiesHtml(amenities) {
  if (!amenities || amenities.length === 0) return "";
  const seen = new Set();
  const chips = amenities
    .map((a) => AMENITY_LABELS[a])
    .filter((label) => label && !seen.has(label) && seen.add(label))
    .map((label) => `<span class="popup-chip">${label}</span>`)
    .join("");
  return chips ? `<div class="popup-chip-row">${chips}</div>` : "";
}

function directionsUrl(lat, lon) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}`;
}

function stationPopupHtml(station, price, fuelCode) {
  const { duty, vat, retail } = priceBreakdown(price);
  const logoUrl = brandLogoUrl(station.brand);

  return `
    <div class="popup-card">
      <div class="popup-price">${price.toFixed(1)}p</div>
      <div class="popup-price-sub">per litre &middot; ${FUEL_LABELS[fuelCode] || fuelCode}</div>
      <div class="popup-breakdown-bar">
        <div style="width:${(retail / price) * 100}%; background:var(--accent)"></div>
        <div style="width:${(duty / price) * 100}%; background:#6b7280"></div>
        <div style="width:${(vat / price) * 100}%; background:#b7bec7"></div>
      </div>
      <div class="popup-breakdown-legend">
        <span><i style="background:var(--accent)"></i>Fuel, supply &amp; retail ${retail.toFixed(1)}p</span>
        <span><i style="background:#6b7280"></i>Fuel duty ${duty.toFixed(1)}p</span>
        <span><i style="background:#b7bec7"></i>VAT ${vat.toFixed(1)}p</span>
      </div>
      <div class="popup-brand">${logoUrl ? `<img src="${logoUrl}" alt="" onerror="this.remove()" />` : ""}${station.brand}</div>
      <div class="popup-address">${station.address}${station.postcode ? ", " + station.postcode : ""}</div>
      ${openingHoursHtml(station.openingTimes)}
      ${amenitiesHtml(station.amenities)}
      <div class="popup-distance">${station.distance.toFixed(1)} mi away</div>
      <a class="popup-directions" href="${directionsUrl(station.lat, station.lon)}" target="_blank" rel="noopener">Get directions</a>
    </div>
  `;
}

let map = L.map("map").setView([54.5, -3], 5);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);
let markers = [];

// The layout switches between stacked (mobile) and side-by-side (desktop) at 900px,
// which resizes the map's container - Leaflet needs telling so it redraws correctly.
// The setTimeout also covers the container not being at its final size yet at the
// instant the map is constructed (e.g. Leaflet's own CSS still loading).
window.addEventListener("resize", () => map.invalidateSize());
setTimeout(() => map.invalidateSize(), 0);

let lastCoords = null; // { lat, lon } from geolocation, cleared when postcode is typed

postcodeInput.addEventListener("input", () => {
  lastCoords = null;
});

function showError(message) {
  errorEl.textContent = message;
  errorEl.hidden = !message;
}

function timeAgo(isoString) {
  if (!isoString) return "unknown";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(isoString)) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hr ago`;
}

function setMode(newMode) {
  mode = newMode;
  const isEv = mode === "ev";

  tabPetrol.classList.toggle("active", !isEv);
  tabEv.classList.toggle("active", isEv);
  fuelField.hidden = isEv;
  connectorField.hidden = !isEv;
  sortPowerOption.hidden = !isEv;
  evPriceNoteEl.hidden = !isEv;
  modeEmojiEl.textContent = isEv ? "🔌" : "⛽";
  searchBtn.textContent = isEv ? "Find charge points" : "Find fuel prices";
  feedStatusEl.hidden = isEv;

  if (sortSelect.value === "power" && !isEv) sortSelect.value = "price";

  showError("");
  resultsEl.innerHTML = "";
  clearMarkers();
}

tabPetrol.addEventListener("click", () => setMode("petrol"));
tabEv.addEventListener("click", () => setMode("ev"));

async function loadStatus() {
  try {
    const res = await fetch("/api/status");
    const data = await res.json();
    const okCount = data.retailers.filter((r) => r.ok).length;
    feedStatusEl.textContent = data.fetchedAt
      ? `${data.totalStations.toLocaleString()} stations from ${okCount}/${data.retailers.length} retailers · updated ${timeAgo(data.fetchedAt)}`
      : "Price feeds not loaded yet";
  } catch {
    feedStatusEl.textContent = "Could not reach the server";
  }
}

function clearMarkers() {
  markers.forEach((m) => map.removeLayer(m));
  markers = [];
}

function priceIcon(label, priceClass, logoUrl) {
  const logoHtml = logoUrl
    ? `<img class="price-pin-logo" src="${logoUrl}" alt="" onerror="this.remove()" />`
    : "";
  return L.divIcon({
    className: "price-pin-wrapper",
    html: `<div class="price-pin ${priceClass}">${logoHtml}<span>${label}</span></div>`,
    iconSize: [1, 1], // the inner div sizes itself; Leaflet just needs a non-zero box
    iconAnchor: [0, 0],
    popupAnchor: [0, -34]
  });
}

function renderResults(data) {
  resultsEl.innerHTML = "";
  clearMarkers();

  if (data.stations.length === 0) {
    resultsEl.innerHTML = `<li class="empty-state">No stations selling this fuel within ${data.radius} miles.</li>`;
    return;
  }

  const prices = data.stations.map((s) => s.prices[data.fuel]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const bounds = [];

  data.stations.forEach((station, i) => {
    const price = station.prices[data.fuel];
    const priceClass = price === min ? "cheap" : price === max && max !== min ? "pricey" : "";

    const li = document.createElement("li");
    li.className = "station-card";
    li.innerHTML = `
      <div class="station-info">
        <div class="station-brand"><span class="station-rank">${i + 1}</span> ${station.brand}</div>
        <div class="station-address">${station.address}${station.postcode ? ", " + station.postcode : ""}</div>
        <div class="station-distance">${station.distance.toFixed(1)} mi away</div>
      </div>
      <div class="station-price ${priceClass}">
        <span class="pence">${price.toFixed(1)}p</span>
      </div>
    `;
    resultsEl.appendChild(li);

    const marker = L.marker([station.lat, station.lon], {
      icon: priceIcon(`${price.toFixed(1)}p`, priceClass, brandLogoUrl(station.brand))
    })
      .addTo(map)
      .bindPopup(stationPopupHtml(station, price, data.fuel), { maxWidth: 260, minWidth: 220 });
    markers.push(marker);
    bounds.push([station.lat, station.lon]);
  });

  bounds.push([data.origin.lat, data.origin.lon]);
  map.invalidateSize();
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
}

function renderEvResults(data) {
  resultsEl.innerHTML = "";
  clearMarkers();

  if (data.stations.length === 0) {
    resultsEl.innerHTML = `<li class="empty-state">No charge points found within ${data.radius} miles.</li>`;
    return;
  }

  const knownPrices = data.stations
    .map((s) => s.tariff?.payAsYouGoPencePerKWh)
    .filter((p) => typeof p === "number");
  const min = Math.min(...knownPrices);
  const bounds = [];

  data.stations.forEach((station, i) => {
    const price = station.tariff?.payAsYouGoPencePerKWh;
    const priceClass = price === min ? "cheap" : "";
    const priceHtml =
      typeof price === "number"
        ? `<span class="pence">${price}p</span><div class="station-distance">per kWh</div>`
        : `<span class="pence" style="font-size:0.85rem">Check app</span>`;

    const connectorSummary = station.connections
      .map((c) => `${c.type}${c.powerKW ? ` ${c.powerKW}kW` : ""}`)
      .join(" · ");

    const li = document.createElement("li");
    li.className = "station-card";
    li.innerHTML = `
      <div class="station-info">
        <div class="station-brand"><span class="station-rank">${i + 1}</span> ${station.operator}</div>
        <div class="station-address">${station.name}${station.postcode ? ", " + station.postcode : ""}</div>
        <div class="connections">${connectorSummary}</div>
        <div class="station-distance">${station.distance.toFixed(1)} mi away</div>
      </div>
      <div class="station-price ${priceClass}">
        ${priceHtml}
      </div>
    `;
    resultsEl.appendChild(li);

    const evLogoUrl = brandLogoUrl(station.operator);
    const evPopup = `
      <div class="popup-card">
        <div class="popup-brand">${evLogoUrl ? `<img src="${evLogoUrl}" alt="" onerror="this.remove()" />` : ""}${station.operator}</div>
        <div class="popup-address">${station.name}${station.postcode ? ", " + station.postcode : ""}</div>
        <div class="popup-chip-row">${station.connections.map((c) => `<span class="popup-chip">${c.type}${c.powerKW ? ` ${c.powerKW}kW` : ""}</span>`).join("")}</div>
        ${typeof price === "number" ? `<div class="popup-price-sub">~${price}p/kWh (${station.tariff.network} PAYG)</div>` : `<div class="popup-price-sub">Check the operator's app for pricing</div>`}
        <div class="popup-distance">${station.distance.toFixed(1)} mi away</div>
        <a class="popup-directions" href="${directionsUrl(station.lat, station.lon)}" target="_blank" rel="noopener">Get directions</a>
      </div>
    `;

    const marker = L.marker([station.lat, station.lon], {
      icon: priceIcon(typeof price === "number" ? `${price}p` : "?", priceClass, evLogoUrl)
    })
      .addTo(map)
      .bindPopup(evPopup, { maxWidth: 240, minWidth: 200 });
    markers.push(marker);
    bounds.push([station.lat, station.lon]);
  });

  bounds.push([data.origin.lat, data.origin.lon]);
  map.invalidateSize();
  map.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
}

async function search() {
  showError("");
  resultsEl.innerHTML = `<li class="loading-state">Searching nearby...</li>`;

  const params = new URLSearchParams({ radius: radiusSelect.value, sort: sortSelect.value });
  if (mode === "petrol") {
    params.set("fuel", fuelSelect.value);
  } else if (connectorSelect.value) {
    params.set("connector", connectorSelect.value);
  }

  if (lastCoords) {
    params.set("lat", lastCoords.lat);
    params.set("lon", lastCoords.lon);
  } else if (postcodeInput.value.trim()) {
    params.set("postcode", postcodeInput.value.trim());
  } else {
    resultsEl.innerHTML = "";
    showError("Enter a postcode or use your current location.");
    return;
  }

  try {
    const endpoint = mode === "petrol" ? "/api/stations" : "/api/ev-stations";
    const res = await fetch(`${endpoint}?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Search failed");
    if (mode === "petrol") renderResults(data);
    else renderEvResults(data);
  } catch (err) {
    resultsEl.innerHTML = "";
    showError(err.message);
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  search();
});

locateBtn.addEventListener("click", () => {
  if (!navigator.geolocation) {
    showError("Geolocation isn't supported by this browser.");
    return;
  }
  showError("");
  locateBtn.textContent = "…";
  navigator.geolocation.getCurrentPosition(
    (position) => {
      lastCoords = { lat: position.coords.latitude, lon: position.coords.longitude };
      postcodeInput.value = "";
      postcodeInput.placeholder = "Using current location";
      locateBtn.textContent = "📍";
      search();
    },
    (err) => {
      locateBtn.textContent = "📍";
      showError(`Could not get your location: ${err.message}`);
    }
  );
});

loadStatus();
setInterval(loadStatus, 60000);
