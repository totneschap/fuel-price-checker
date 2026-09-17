// Free, keyless UK postcode -> lat/lon lookup via postcodes.io.
async function geocodePostcode(postcode) {
  const cleaned = postcode.trim().replace(/\s+/g, "");
  if (!cleaned) throw new Error("Postcode is required");

  const res = await fetch(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(cleaned)}`
  );
  const body = await res.json();

  if (body.status === 200 && body.result) {
    return { lat: body.result.latitude, lon: body.result.longitude };
  }

  // Fall back to the outward code (e.g. "SW1A" from "SW1A 1AA") in case the
  // full postcode isn't recognised, so partial input still gives a rough area.
  const outward = cleaned.match(/^[A-Z]{1,2}\d[A-Z\d]?/i)?.[0];
  if (outward) {
    const fallback = await fetch(
      `https://api.postcodes.io/outcodes/${encodeURIComponent(outward)}`
    );
    const fallbackBody = await fallback.json();
    if (fallbackBody.status === 200 && fallbackBody.result) {
      return {
        lat: fallbackBody.result.latitude,
        lon: fallbackBody.result.longitude
      };
    }
  }

  throw new Error(`Could not find location for postcode "${postcode}"`);
}

module.exports = { geocodePostcode };
