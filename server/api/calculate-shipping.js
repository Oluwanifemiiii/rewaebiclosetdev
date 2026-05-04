// server/api/calculate-shipping.js
//
// Calculates delivery fee using Google Distance Matrix API.
// Falls back to straight-line (Haversine) distance when no driving route exists
// (e.g. cross-continent orders like Nigeria ↔ USA).
//
// Env var required: GOOGLE_MAPS_API_KEY
//
// Seller origin priority:
//   1. originGeolocation { lat, lng } — from listing.attributes.geolocation (most accurate)
//   2. originAddress string           — from listing.publicData.location.address
//   3. originDressLocation string     — from listing.publicData.dressLocation (this marketplace)
//
// Destination:
//   - lat/lng pair if buyer used autocomplete
//   - plain text address if buyer used manual fields (Google geocodes it)

const axios = require('axios');

const GOOGLE_KEY =
  process.env.GOOGLE_MAPS_API_KEY ||
  process.env.REACT_APP_GOOGLE_MAPS_API_KEY;

// ── Haversine formula ─────────────────────────────────────────────────────
// Returns straight-line distance in km between two lat/lng points.
// Used as fallback when no driving route exists (cross-continent, islands, etc.)
const haversineDistanceKm = (lat1, lng1, lat2, lng2) => {
  const toRad = deg => (deg * Math.PI) / 180;
  const R = 6371; // Earth's radius in km

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

// ── Google Geocoding ──────────────────────────────────────────────────────
// Converts a text address to { lat, lng } using Google Geocoding API.
// Needed for Haversine fallback when we only have text addresses.
const geocodeWithGoogle = async (addressText) => {
  console.log('🌍 [geocode] Google Geocoding:', addressText);

  const response = await axios.get(
    'https://maps.googleapis.com/maps/api/geocode/json',
    {
      params: { address: addressText, key: GOOGLE_KEY },
      timeout: 8000,
    }
  );

  if (response.data.status !== 'OK' || !response.data.results?.length) {
    throw new Error(`Could not geocode address: "${addressText}" (${response.data.status})`);
  }

  const location = response.data.results[0].geometry.location;
  console.log('🌍 [geocode] Result:', response.data.results[0].formatted_address, '→', location.lat, location.lng);
  return { lat: location.lat, lng: location.lng };
};

module.exports = async (req, res) => {
  try {
    const {
      originGeolocation,
      originAddress,
      originDressLocation,
      destinationAddress,
      ratePerKm = 100,
      minimumFee = 50000,
    } = req.body;

    console.log('=== CALCULATE SHIPPING (Google Distance Matrix) ===');
    console.log('originGeolocation  :', originGeolocation);
    console.log('originAddress      :', originAddress);
    console.log('originDressLocation:', originDressLocation);
    console.log('destinationAddress :', destinationAddress);
    console.log('ratePerKm          :', ratePerKm, '| minimumFee:', minimumFee);
    console.log('GOOGLE_KEY present :', !!GOOGLE_KEY);

    if (!GOOGLE_KEY) {
      return res.status(500).json({
        success: false,
        message: 'GOOGLE_MAPS_API_KEY is not set in environment variables',
      });
    }

    if (!destinationAddress) {
      return res.status(400).json({ success: false, message: 'Destination address is required' });
    }

    if (!originGeolocation && !originAddress && !originDressLocation) {
      return res.status(400).json({
        success: false,
        message: 'This listing does not have a location set.',
      });
    }

    // ── Build origin string ───────────────────────────────────────────────
    let origin;
    if (originGeolocation?.lat && originGeolocation?.lng) {
      origin = `${originGeolocation.lat},${originGeolocation.lng}`;
      console.log('✅ Using seller geolocation:', origin);
    } else {
      origin = originAddress || originDressLocation;
      console.log('⚠️  Using seller text address:', origin);
    }

    // ── Build destination string ──────────────────────────────────────────
    let destination;
    if (destinationAddress.lat && destinationAddress.lng) {
      destination = `${destinationAddress.lat},${destinationAddress.lng}`;
      console.log('✅ Using buyer coordinates:', destination);
    } else if (destinationAddress.address) {
      destination = destinationAddress.address;
      console.log('⚠️  Using buyer address string:', destination);
    } else {
      const parts = [
        destinationAddress.street,
        destinationAddress.city,
        destinationAddress.state,
        destinationAddress.country,
      ].filter(Boolean);

      if (parts.length < 2) {
        return res.status(400).json({
          success: false,
          message: 'Please enter at least a city and country',
        });
      }
      destination = parts.join(', ');
      console.log('⚠️  Using buyer manual fields:', destination);
    }

    // ── Call Google Distance Matrix API ───────────────────────────────────
    console.log('📡 Calling Google Distance Matrix API...');
    console.log('   origins     :', origin);
    console.log('   destinations:', destination);

    const googleResponse = await axios.get(
      'https://maps.googleapis.com/maps/api/distancematrix/json',
      {
        params: {
          origins: origin,
          destinations: destination,
          key: GOOGLE_KEY,
          mode: 'driving',
          units: 'metric',
        },
        timeout: 10000,
      }
    );

    const apiData = googleResponse.data;
    console.log('📡 Google response status:', apiData.status);

    if (apiData.status !== 'OK') {
      console.error('❌ Google API error status:', apiData.status, apiData.error_message);
      return res.status(400).json({
        success: false,
        message: `Google API error: ${apiData.status}${apiData.error_message ? ' — ' + apiData.error_message : ''}`,
      });
    }

    const element = apiData.rows?.[0]?.elements?.[0];
    console.log('📡 Element status:', element?.status);

    // ── Driving route found — use exact road distance ─────────────────────
    if (element && element.status === 'OK') {
      const distanceMeters = element.distance.value;
      const distanceKm = distanceMeters / 1000;
      console.log('📍 Driving distance:', distanceKm.toFixed(2), 'km');
      console.log('📍 Duration:', element.duration.text);

      let shippingFee = Math.round(distanceKm * ratePerKm);
      console.log('💰 Raw fee:', shippingFee, 'subunits (before minimum)');

      if (minimumFee && shippingFee < minimumFee) {
        console.log('💰 Applying minimum fee:', minimumFee, '(was:', shippingFee + ')');
        shippingFee = minimumFee;
      }

      console.log('✅ Final fee (driving):', shippingFee, 'subunits = ₦' + shippingFee / 100);
      console.log('===================================================');

      return res.json({
        success: true,
        shippingFee,
        distance: distanceKm,
        distanceType: 'driving',
        duration: element.duration.text,
        originAddress: apiData.origin_addresses[0],
        destinationAddress: apiData.destination_addresses[0],
      });
    }

    // ── No driving route (ZERO_RESULTS) — fall back to air distance ──────
    console.log('⚠️  No driving route found (status:', element?.status + '). Falling back to air distance...');

    // Resolve origin coordinates
    let originLat, originLng;
    if (originGeolocation?.lat && originGeolocation?.lng) {
      originLat = originGeolocation.lat;
      originLng = originGeolocation.lng;
    } else {
      const originText = originAddress || originDressLocation;
      const geocoded = await geocodeWithGoogle(originText);
      originLat = geocoded.lat;
      originLng = geocoded.lng;
    }

    // Resolve destination coordinates
    let destLat, destLng;
    if (destinationAddress.lat && destinationAddress.lng) {
      destLat = destinationAddress.lat;
      destLng = destinationAddress.lng;
    } else {
      const destText = destinationAddress.address ||
        [destinationAddress.street, destinationAddress.city, destinationAddress.state, destinationAddress.country]
          .filter(Boolean)
          .join(', ');
      const geocoded = await geocodeWithGoogle(destText);
      destLat = geocoded.lat;
      destLng = geocoded.lng;
    }

    const airDistanceKm = haversineDistanceKm(originLat, originLng, destLat, destLng);
    console.log('✈️  Air distance:', airDistanceKm.toFixed(2), 'km');

    let shippingFee = Math.round(airDistanceKm * ratePerKm);
    console.log('💰 Raw fee (air):', shippingFee, 'subunits (before minimum)');

    if (minimumFee && shippingFee < minimumFee) {
      console.log('💰 Applying minimum fee:', minimumFee, '(was:', shippingFee + ')');
      shippingFee = minimumFee;
    }

    console.log('✅ Final fee (air distance):', shippingFee, 'subunits = ₦' + shippingFee / 100);
    console.log('===================================================');

    return res.json({
      success: true,
      shippingFee,
      distance: airDistanceKm,
      distanceType: 'air',
      originAddress: apiData.origin_addresses?.[0] || (originAddress || originDressLocation),
      destinationAddress: apiData.destination_addresses?.[0] ||
        (destinationAddress.address ||
          [destinationAddress.street, destinationAddress.city, destinationAddress.state, destinationAddress.country]
            .filter(Boolean)
            .join(', ')),
    });
  } catch (error) {
    console.error('❌ [calculate-shipping] Error:', error.message);
    if (error.response) {
      console.error('   Response status:', error.response.status);
      console.error('   Response data:', error.response.data);
    }
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to calculate shipping fee',
    });
  }
};