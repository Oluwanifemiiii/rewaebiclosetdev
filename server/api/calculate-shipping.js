// server/api/calculate-shipping.js
//
// Calculates delivery fee using Google Distance Matrix API.
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
    // Prefer lat/lng for the seller — no geocoding step needed, more accurate
    let origin;
    if (originGeolocation?.lat && originGeolocation?.lng) {
      origin = `${originGeolocation.lat},${originGeolocation.lng}`;
      console.log('✅ Using seller geolocation:', origin);
    } else {
      origin = originAddress || originDressLocation;
      console.log('⚠️  Using seller text address:', origin);
    }

    // ── Build destination string ──────────────────────────────────────────
    // Prefer lat/lng if buyer used autocomplete
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

    if (!element || element.status !== 'OK') {
      return res.status(400).json({
        success: false,
        message: `Could not find a driving route between the two locations (${element?.status || 'UNKNOWN'})`,
      });
    }

    const distanceMeters = element.distance.value;
    const distanceKm = distanceMeters / 1000;
    console.log('📍 Distance:', distanceKm.toFixed(2), 'km');
    console.log('📍 Duration:', element.duration.text);

    // ── Calculate fee ─────────────────────────────────────────────────────
    // ratePerKm is in currency subunits (kobo for NGN)
    let shippingFee = Math.round(distanceKm * ratePerKm);
    console.log('💰 Raw fee:', shippingFee, 'subunits (before minimum)');

    if (minimumFee && shippingFee < minimumFee) {
      console.log('💰 Applying minimum fee:', minimumFee, '(was:', shippingFee + ')');
      shippingFee = minimumFee;
    }

    console.log('✅ Final fee:', shippingFee, 'subunits = ₦' + shippingFee / 100);
    console.log('===================================================');

    return res.json({
      success: true,
      shippingFee,
      distance: distanceKm,
      duration: element.duration.text,
      originAddress: apiData.origin_addresses[0],
      destinationAddress: apiData.destination_addresses[0],
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