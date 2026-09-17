# Fuel Price Checker

A simple UK petrol/diesel/EV price comparison app, inspired by [this Reddit post](https://www.reddit.com/r/CarTalkUK/comments/1rctfal/built_a_simple_uk_fuel_price_comparison_app_using/). Search by postcode or current location and see nearby stations ranked by price on a map.

## How it works

Several UK fuel retailers publish live pump prices as free, public JSON feeds under the CMA's road fuel price open data scheme (see `src/retailers.js`). The server fetches all of them every 20 minutes, normalizes them into one schema, and caches the result in memory. The frontend geocodes your postcode (via the free [postcodes.io](https://postcodes.io) API, or your browser's own geolocation), then asks the server for stations within a chosen radius, sorted by price or distance.

**Currently included:** Asda, Morrisons, Esso, Applegreen, JET, Tesco (Tesco's feed returns HTTP 403 from some networks/cloud IPs due to bot protection — it may work fine from a normal home connection).

**Note on data source:** these are the original 2023 voluntary-scheme feeds. The UK government's guidance page for that scheme was withdrawn on 1 May 2026 in favour of a new mandatory "Fuel Finder" API (see `gov.uk/guidance/access-fuel-price-data`). The legacy feeds used here are still live as of testing, but retailers could shut them down at any time — if that happens, `src/retailers.js` is the only place you'd need to update.

## Full coverage via Fuel Finder (optional)

The free feeds above don't include Sainsbury's, BP, Shell, or most independents — those retailers only report through the official **Fuel Finder** scheme, which covers every UK forecourt by law (~8,000+ stations). There are two ways to bring that data in:

### Option A: CSV export (simplest, already working)

Fuel Finder offers a CSV download / email subscription with no OAuth registration needed — see https://www.developer.fuel-finder.service.gov.uk/fuel-finder/access-latest-fuelprices. Drop the downloaded file into `data/` (any filename, `.csv` extension) and `src/fuelFinderCsv.js` picks it up automatically on the next refresh, preferring it over the free feeds for any station it also covers. It's re-read from disk every cycle, so replacing it with a fresher export (via the email subscription, published a couple of times a day) just works — no restart needed, and old files left in `data/` are ignored in favour of whichever is most recently modified.

### Option B: Live OAuth API (fresher, more setup)

For near-real-time updates instead of a periodic CSV:

1. Go to https://www.developer.fuel-finder.service.gov.uk/fuel-finder/get-started-ifr/onelogin and create (or sign in with) a **GOV.UK One Login** — you'll need an email address and a phone/authenticator app for the 2FA step.
2. Register an application as an **Information Recipient** to get a `client_id` and `client_secret` (separate test and production credentials).
3. Copy `.env.example` to `.env` and paste your credentials in.
4. Your registration dashboard will also show your account's actual OAuth token URL and API base URL — if they differ from the defaults in `src/fuelFinder.js`, add them to `.env` as `FUEL_FINDER_TOKEN_URL` and `FUEL_FINDER_API_BASE`.
5. Restart the server. If a CSV is also present in `data/`, the CSV takes priority — remove it to use the live API instead.

The exact endpoint paths and pagination weren't fully published in the public docs (only visible once you're registered), so `src/fuelFinder.js` is a best-effort implementation — if a field name doesn't quite match once you're testing against real data, that file is the only place to adjust it.

## EV charging (optional)

There's no equivalent of Fuel Finder for EV charging — UK regulations require operators to *display* p/kWh pricing at the charger or in their app, but don't require publishing it as structured open data. So the EV tab combines two things:

- **Charge point locations** from [Open Charge Map](https://openchargemap.org) — a free, community-maintained database (connector types, power in kW, operator, live-ish operational status). Sign up for a free API key at openchargemap.org (Profile > API Key, no ID verification) and set `OCM_API_KEY` in `.env`.
- **Typical pricing** from `src/evTariffs.js` — a small, manually-maintained table of standard pay-as-you-go rapid-charging rates per network (InstaVolt, Tesla, BP Pulse, Ionity, etc.), sourced from Zapmap's charging price index. This is indicative, not live or exact — actual price varies by site, charger speed and time of day. Worth re-checking https://www.zapmap.com/ev-stats/rapid-charging-prices occasionally and updating the numbers.

Without `OCM_API_KEY` set, the EV tab returns a clear "not configured" error rather than failing silently.

## Running it

```bash
npm install
npm start
```

Then open http://localhost:3000.

## Deploying it live (Render)

This needs a host that keeps a persistent Node process running (it caches prices in memory and refreshes on a timer), not a serverless platform. [Render](https://render.com) works well and has a free tier:

1. Push this repo to GitHub (see below).
2. On Render: **New > Blueprint**, connect the repo, and it'll pick up `render.yaml` automatically (build command `npm install`, start command `node server.js`).
3. Render will prompt for the optional secret env vars (`OCM_API_KEY`, `FUEL_FINDER_CLIENT_ID`, `FUEL_FINDER_CLIENT_SECRET`) declared in `render.yaml` — leave them blank for now if you don't have them yet, and add them later from the service's **Environment** tab (no redeploy needed, Render restarts automatically).
4. Your site will be live at `https://<service-name>.onrender.com`. The free tier sleeps after 15 minutes of inactivity and takes ~30s to wake back up on the next request.

**Note on data freshness once live:** the `data/*.csv` full-coverage trick only works locally, since there's no way to drop a new file into a remote host without redeploying. Live, the site runs on the free retailer feeds (`src/retailers.js`) until you set up the live Fuel Finder API credentials (see above) as an env var on Render.

## API

- `GET /api/stations?postcode=SW1A1AA&fuel=E10&radius=5&sort=price` — nearby fuel stations (also accepts `lat`/`lon` instead of `postcode`; `fuel` is one of `E10`, `E5`, `B7`, `SDV`, plus `B10`/`HVO` when Fuel Finder is enabled; `sort` is `price` or `distance`)
- `GET /api/ev-stations?postcode=SW1A1AA&radius=5&connector=CCS&sort=price` — nearby EV charge points (needs `OCM_API_KEY`; `connector` is optional and matches loosely e.g. `CCS`, `CHAdeMO`, `Type 2`; `sort` is `price`, `distance` or `power`)
- `GET /api/status` — feed freshness and per-retailer station counts
- `POST /api/refresh` — force an immediate re-fetch of all fuel price sources

## Project structure

```
server.js          Express app + API routes
src/retailers.js    List of free feed URLs — add/remove retailers here
src/fetchPrices.js  Fetches, normalizes, merges and caches all sources
src/fuelFinderCsv.js Loads a Fuel Finder CSV export from data/, if present (preferred)
src/fuelFinder.js    Optional live Fuel Finder API integration (needs .env credentials)
data/                Drop a Fuel Finder CSV export here for full UK coverage
src/evChargePoints.js Open Charge Map integration for EV charge point locations
src/evTariffs.js      Manually-maintained per-network EV pricing reference table
src/geocode.js       Postcode -> lat/lon via postcodes.io
src/distance.js      Haversine distance helper
public/              Frontend (plain HTML/CSS/JS + Leaflet map)
```
