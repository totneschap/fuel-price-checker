// Normalizes the free-text "country" field from Fuel Finder data (which includes
// noise like "UNITED KINGDOM", "UK", or stray town names from misaligned records)
// down to one of the four real UK nations, or null if it doesn't match.
const VALID = new Set(["England", "Scotland", "Wales", "Northern Ireland"]);

function normalizeCountry(value) {
  if (!value) return null;
  const titled = String(value)
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return VALID.has(titled) ? titled : null;
}

module.exports = { normalizeCountry };
