#!/usr/bin/env node
/**
 * Backfill listing geolocation from the legacy free-text location field.
 *
 * Older listings only have publicData.dressLocation (typed text, e.g. "Lekki, Lagos").
 * The search Location filter matches listings by their geolocation, so those listings
 * never show up. This script geocodes the text with Google and saves:
 *   - geolocation               (lat/lng, used by the filter)
 *   - publicData.location        { address, city, state, country } (same shape the listing form saves)
 * dressLocation itself is left untouched.
 *
 * Listings that already have a geolocation but no publicData.location.state get their
 * city / state / country filled in by reverse-geocoding the saved coordinates (the search
 * Location filter groups listings by state).
 *
 * Usage:
 *   node scripts/backfill-geolocation.js            # dry run: shows what would change
 *   node scripts/backfill-geolocation.js --apply    # actually updates the listings
 *   node scripts/backfill-geolocation.js --force    # re-geocode every listing from its text, even complete ones
 *
 * Needs in .env: SHARETRIBE_INTEGRATION_CLIENT_ID, SHARETRIBE_INTEGRATION_CLIENT_SECRET,
 * and a Google key with the Geocoding API enabled (GOOGLE_GEOCODING_API_KEY, falling back to
 * REACT_APP_GOOGLE_MAPS_API_KEY).
 */
require('dotenv').config();
const sharetribeIntegrationSdk = require('sharetribe-flex-integration-sdk');

const { LatLng } = sharetribeIntegrationSdk.types;

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
// Bias ambiguous names (e.g. "Lagos" also exists in Portugal) towards Nigeria.
const REGION_BIAS = 'ng';
const PER_PAGE = 100;

const GOOGLE_KEY = process.env.GOOGLE_GEOCODING_API_KEY || process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const sdk = sharetribeIntegrationSdk.createInstance({
  clientId: process.env.SHARETRIBE_INTEGRATION_CLIENT_ID,
  clientSecret: process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET,
});

const legacyLocationText = publicData =>
  (publicData?.dressLocation || publicData?.dresslocation || publicData?.location?.address || '')
    .toString()
    .trim();

// Same rules as placeRegion in src/util/googleMaps.js
const pickRegion = components => {
  const pick = type => components.find(c => c.types.includes(type))?.long_name || null;
  return {
    city: pick('locality') || pick('postal_town') || pick('administrative_area_level_2'),
    state: pick('administrative_area_level_1'),
    country: pick('country'),
  };
};

// Forward geocode ({ text }) or reverse geocode ({ lat, lng })
const geocode = async ({ text, lat, lng }) => {
  const query =
    text != null
      ? `address=${encodeURIComponent(text)}&region=${REGION_BIAS}`
      : `latlng=${lat},${lng}`;
  const url = `https://maps.googleapis.com/maps/api/geocode/json?${query}&key=${GOOGLE_KEY}`;
  const res = await fetch(url);
  const json = await res.json();
  if (json.status === 'ZERO_RESULTS') {
    return null;
  }
  if (json.status !== 'OK') {
    throw new Error(`Google geocoding failed: ${json.status} ${json.error_message || ''}`);
  }
  const best = json.results[0];
  const country = best.address_components.find(c => c.types.includes('country'))?.short_name;
  return {
    address: best.formatted_address,
    lat: best.geometry.location.lat,
    lng: best.geometry.location.lng,
    countryCode: country,
    ...pickRegion(best.address_components),
    // A bare country ("Nigeria") has no meaningful state - don't guess one from its centre point.
    ...(best.types.includes('country') ? { city: null, state: null } : {}),
    // Hints that the match might be wrong and worth a manual look
    partialMatch: !!best.partial_match,
    multipleResults: json.results.length > 1,
  };
};

const fetchAllListings = async () => {
  const all = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await sdk.listings.query({ page, perPage: PER_PAGE });
    all.push(...res.data.data);
    totalPages = res.data.meta.totalPages || 1;
    page += 1;
  } while (page <= totalPages);
  return all;
};

const main = async () => {
  if (!GOOGLE_KEY) {
    throw new Error('Missing Google API key (GOOGLE_GEOCODING_API_KEY or REACT_APP_GOOGLE_MAPS_API_KEY).');
  }
  const marketplace = (await sdk.marketplace.show()).data.data.attributes.name;
  console.log(`Marketplace: ${marketplace}`);
  console.log(APPLY ? 'Mode: APPLY (listings will be updated)\n' : 'Mode: DRY RUN (nothing is saved)\n');

  const listings = await fetchAllListings();
  const summary = {
    total: listings.length,
    alreadySet: 0,
    regionOnly: 0,
    noText: 0,
    notFound: 0,
    toCheck: 0,
    updated: 0,
    failed: 0,
  };
  const rows = [];

  for (const listing of listings) {
    const { title, state, geolocation, publicData } = listing.attributes;
    const id = listing.id.uuid;

    // country is always set once a region lookup has run (state can legitimately be empty)
    const hasRegion = !!publicData?.location?.country;
    if (geolocation && hasRegion && !FORCE) {
      summary.alreadySet += 1;
      continue;
    }

    // Has coordinates but no city/state: fill in the region only, keep the coordinates.
    if (geolocation && !FORCE) {
      summary.regionOnly += 1;
      let match;
      try {
        // Prefer the listing's own text (how its coordinates were found); fall back to the coords.
        const sourceText = legacyLocationText(publicData);
        match = sourceText
          ? (await geocode({ text: sourceText })) ||
            (await geocode({ lat: geolocation.lat, lng: geolocation.lng }))
          : await geocode({ lat: geolocation.lat, lng: geolocation.lng });
      } catch (e) {
        summary.failed += 1;
        rows.push({ id, title, state, text: '(coordinates)', result: `ERROR: ${e.message}` });
        continue;
      }
      const address = publicData?.location?.address || match?.address;
      const location = {
        address,
        city: match?.city || null,
        state: match?.state || null,
        country: match?.country || null,
      };
      let result = `region → ${location.city || '?'} / ${location.state || '?'} / ${
        location.country || '?'
      }`;
      if (APPLY) {
        try {
          await sdk.listings.update({ id: listing.id, publicData: { location } });
          summary.updated += 1;
          result = `UPDATED ${result}`;
          await sleep(300);
        } catch (e) {
          summary.failed += 1;
          result = `UPDATE FAILED (${e.status || ''} ${e.message}) ${result}`;
        }
      }
      rows.push({ id, title, state, text: address || '(coordinates)', result });
      continue;
    }

    const text = legacyLocationText(publicData);
    if (!text) {
      summary.noText += 1;
      rows.push({ id, title, state, text: '', result: 'SKIPPED: no location text' });
      continue;
    }

    let match;
    try {
      match = await geocode({ text });
    } catch (e) {
      summary.failed += 1;
      rows.push({ id, title, state, text, result: `ERROR: ${e.message}` });
      continue;
    }
    if (!match) {
      summary.notFound += 1;
      rows.push({ id, title, state, text, result: 'NOT FOUND — fix the text or set it by hand' });
      continue;
    }

    const flags = [
      match.partialMatch ? 'partial match' : null,
      match.countryCode && match.countryCode !== 'NG'
        ? `outside Nigeria (${match.countryCode})`
        : null,
    ].filter(Boolean);
    if (flags.length) summary.toCheck += 1;

    let result = `${match.address}  [${match.lat.toFixed(4)}, ${match.lng.toFixed(4)}]  state: ${
      match.state || '?'
    }`;
    if (flags.length) result += `  ⚠ CHECK: ${flags.join(', ')}`;

    if (APPLY) {
      try {
        await sdk.listings.update({
          id: listing.id,
          geolocation: new LatLng(match.lat, match.lng),
          publicData: {
            location: {
              address: match.address,
              city: match.city,
              state: match.state,
              country: match.country,
            },
          },
        });
        summary.updated += 1;
        result = `UPDATED → ${result}`;
        await sleep(300); // stay well under Integration API rate limits
      } catch (e) {
        summary.failed += 1;
        result = `UPDATE FAILED (${e.status || ''} ${e.message}) → ${result}`;
      }
    }
    rows.push({ id, title, state, text, result });
  }

  rows.forEach(r => {
    console.log(`• ${r.title} (${r.state}, ${r.id})`);
    console.log(`    text:   "${r.text}"`);
    console.log(`    result: ${r.result}`);
  });

  console.log('\nSummary');
  console.log(`  listings checked:            ${summary.total}`);
  console.log(`  already complete:            ${summary.alreadySet}`);
  console.log(`  region filled from coords:   ${summary.regionOnly}`);
  console.log(`  no location text:            ${summary.noText}`);
  console.log(`  not found by Google:         ${summary.notFound}`);
  console.log(`  matched but worth checking:  ${summary.toCheck}`);
  if (APPLY) console.log(`  updated:                     ${summary.updated}`);
  console.log(`  errors:                      ${summary.failed}`);
  if (!APPLY) console.log('\nDry run only. Re-run with --apply to save these.');
};

main().catch(e => {
  console.error(e.data || e);
  process.exit(1);
});
