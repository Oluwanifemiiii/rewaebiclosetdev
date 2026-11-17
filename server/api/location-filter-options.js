// server/api/location-filter-options.js
//
// GET /api/location-filter-options
//
// Builds the options for the search page "Location" filter from the listings themselves:
// published listings are grouped by publicData.location.state (saved from Google Places on
// the listing form / by scripts/backfill-geolocation.js), and the most common places are
// returned with a bounding box around their listings' geolocations.
//
// Response: { options: [{ option, label, count, bounds: { ne: [lat, lng], sw: [lat, lng] } }] }

const { getIntegrationSdk } = require('../api-util/integrationSdk');

// How many places to show in the filter (most listings first)
const MAX_OPTIONS = 10;
// Padding around the listings' bounding box (degrees, ~5 km), so a place with a single
// listing still gets an area and new listings nearby are matched.
const BOUNDS_PADDING = 0.05;
// Rebuilding the list queries every published listing, so it's cached for a while.
const CACHE_TTL_MS = 10 * 60 * 1000;
const PER_PAGE = 100;

// Friendlier names for some Google state names
const LABEL_OVERRIDES = {
  'Federal Capital Territory': 'Abuja',
};

let cache = { at: 0, options: null };

const slugify = text =>
  text
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');

const fetchPublishedListings = async sdk => {
  const listings = [];
  let page = 1;
  let totalPages = 1;
  do {
    const res = await sdk.listings.query({
      states: ['published'],
      'fields.listing': ['geolocation', 'publicData'],
      page,
      perPage: PER_PAGE,
    });
    listings.push(...res.data.data);
    totalPages = res.data.meta.totalPages || 1;
    page += 1;
  } while (page <= totalPages);
  return listings;
};

const buildOptions = listings => {
  const groups = {};
  listings.forEach(listing => {
    const { geolocation, publicData } = listing.attributes || {};
    const { state, country } = publicData?.location || {};
    if (!geolocation || !state) {
      return;
    }
    const key = `${state}|${country || ''}`;
    const group =
      groups[key] ||
      (groups[key] = {
        label: LABEL_OVERRIDES[state] || state,
        country,
        count: 0,
        north: -90,
        south: 90,
        east: -180,
        west: 180,
      });
    group.count += 1;
    group.north = Math.max(group.north, geolocation.lat);
    group.south = Math.min(group.south, geolocation.lat);
    group.east = Math.max(group.east, geolocation.lng);
    group.west = Math.min(group.west, geolocation.lng);
  });

  const sorted = Object.values(groups).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label)
  );
  const top = sorted.slice(0, MAX_OPTIONS);

  // Same state name in two countries (e.g. "Washington"): add the country to tell them apart.
  const labelCounts = top.reduce((acc, g) => ({ ...acc, [g.label]: (acc[g.label] || 0) + 1 }), {});

  return top.map(g => {
    const label = labelCounts[g.label] > 1 && g.country ? `${g.label}, ${g.country}` : g.label;
    const round = n => Math.round(n * 1e5) / 1e5;
    return {
      option: slugify(label),
      label,
      count: g.count,
      bounds: {
        ne: [round(Math.min(90, g.north + BOUNDS_PADDING)), round(Math.min(180, g.east + BOUNDS_PADDING))],
        sw: [round(Math.max(-90, g.south - BOUNDS_PADDING)), round(Math.max(-180, g.west - BOUNDS_PADDING))],
      },
    };
  });
};

module.exports = async (req, res) => {
  try {
    const now = Date.now();
    if (!cache.options || now - cache.at > CACHE_TTL_MS) {
      const listings = await fetchPublishedListings(getIntegrationSdk());
      cache = { at: now, options: buildOptions(listings) };
    }
    res.set('Cache-Control', 'public, max-age=300');
    res.status(200).json({ options: cache.options });
  } catch (e) {
    console.error('[location-filter-options] failed:', e.status || '', e.message);
    // Serve stale options rather than nothing if we have them
    if (cache.options) {
      return res.status(200).json({ options: cache.options });
    }
    res.status(500).json({ error: 'Could not load location filter options' });
  }
};
