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

    const marker = L.marker([station.lat, station.lon])
      .addTo(map)
      .bindPopup(`<b>${station.brand}</b><br>${station.address}<br>${price.toFixed(1)}p / L`);
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

    const marker = L.marker([station.lat, station.lon])
      .addTo(map)
      .bindPopup(`<b>${station.operator}</b><br>${station.name}<br>${connectorSummary}${typeof price === "number" ? `<br>~${price}p/kWh` : ""}`);
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
