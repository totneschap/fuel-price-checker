// Server-side copy of the brand -> logo domain list used for map pins in public/app.js
// (kept separate rather than shared, since app.js is a plain browser script, not a
// module). Uses Google's keyless favicon service - see app.js for why.
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
  { match: /maxol/i, domain: "maxol.ie" }
];

function brandLogoUrl(brand) {
  if (!brand) return null;
  const found = BRAND_LOGO_DOMAINS.find((b) => b.match.test(brand));
  return found ? `https://www.google.com/s2/favicons?domain=${found.domain}&sz=64` : null;
}

module.exports = { brandLogoUrl };
