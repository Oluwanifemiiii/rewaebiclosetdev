import React, { useState, useRef, useEffect } from 'react';
import classNames from 'classnames';

import css from './DeliveryAddressForm.module.css';

/**
 * DeliveryAddressForm
 *
 * Buyer enters their delivery address at checkout using plain inputs
 * (no React Final Form dependency). After 800ms of inactivity the form
 * calls /api/calculate-shipping which geocodes both addresses via
 * Nominatim and gets driving distance from OSRM — both free, no API key.
 */
const DeliveryAddressForm = props => {
  const { listing, onFeeCalculated, currency = 'NGN', disabled = false, className, skipFeeCalculation = false } = props;
  const debounceRef = useRef(null);

  const [address, setAddress] = useState({ street: '', city: '', state: '', country: 'Nigeria', phone: '' });
  const [calculatingFee, setCalculatingFee] = useState(false);
  const [deliveryFee, setDeliveryFee] = useState(null);
  const [distanceKm, setDistanceKm] = useState(null);
  const [feeError, setFeeError] = useState(null);

  const sellerGeolocation = listing?.attributes?.geolocation || null;
  const sellerStandardLocation = listing?.attributes?.publicData?.location?.address || null;
  const dressLocation =
    listing?.attributes?.publicData?.dressLocation ||
    listing?.attributes?.publicData?.dresslocation ||
    null;

  // ── Seller type determines base shipping fee ──
  // Manual sellers (Nigerian/Paystack) use NGN: ₦3,000 base = 300000 kobo
  // Stripe sellers (international) use USD: $100 base = 10000 cents
  const author = listing?.author;
  const sellerType = author?.attributes?.profile?.publicData?.sellerType;
  const isManualSeller = sellerType === 'manual';

  const defaultRatePerKm = isManualSeller ? 30000 : 100;      // 30000 kobo/km (₦300/km) or 100 cents/km ($1/km)
  const defaultMinimumFee = isManualSeller ? 300000 : 400;   // ₦3,000 or $4

  const shippingRatePerKm = listing?.attributes?.publicData?.shippingRatePerKm || defaultRatePerKm;
  const minimumShippingFee = listing?.attributes?.publicData?.minimumShippingFee || defaultMinimumFee;
  const hasSellerLocation = !!(sellerGeolocation || sellerStandardLocation || dressLocation);

  // Display currency based on seller type
  const displayCurrency = isManualSeller ? 'NGN' : (currency || 'USD');

  useEffect(() => {
    console.log('🚚 [DeliveryAddressForm] MOUNTED');
    console.log('  sellerType           :', sellerType, isManualSeller ? '(manual/NGN)' : '(stripe/USD)');
    console.log('  sellerGeolocation    :', sellerGeolocation);
    console.log('  sellerStandardLocation:', sellerStandardLocation);
    console.log('  dressLocation        :', dressLocation);
    console.log('  shippingRatePerKm    :', shippingRatePerKm);
    console.log('  minimumShippingFee   :', minimumShippingFee, '(' + displayCurrency + ')');
    console.log('  hasSellerLocation    :', hasSellerLocation);
  }, []);

  const formatCurrency = amount => {
    if (amount == null) return '';
    return new Intl.NumberFormat('en-NG', {
      style: 'currency',
      currency: displayCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount / 100);
  };

  const calculateFee = async currentAddress => {
    console.log('🚚 [DeliveryAddressForm] calculateFee called, address:', currentAddress);

    if (!hasSellerLocation) {
      console.warn('  ⚠️ ABORT: no seller location');
      return;
    }
    if (!currentAddress.city || currentAddress.city.trim().length < 2) {
      console.warn('  ⚠️ ABORT: city not filled in yet');
      return;
    }

    setCalculatingFee(true);
    setFeeError(null);

    const payload = {
      originGeolocation: sellerGeolocation,
      originAddress: sellerStandardLocation,
      originDressLocation: dressLocation,
      destinationAddress: currentAddress,
      ratePerKm: shippingRatePerKm,
      minimumFee: minimumShippingFee,
    };

    console.log('  📤 POST /api/calculate-shipping:', payload);

    try {
      const response = await fetch('/api/calculate-shipping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      console.log('  📥 Response:', data);

      if (data.success) {
        console.log('  ✅ Fee:', data.shippingFee, '= ₦' + data.shippingFee / 100);
        console.log('  ✅ Distance:', data.distance?.toFixed(2), 'km');
        setDeliveryFee(data.shippingFee);
        setDistanceKm(data.distance);
        setFeeError(null);
        onFeeCalculated && onFeeCalculated({
          deliveryAddress: currentAddress,
          deliveryFeeInSubunits: data.shippingFee,
        });
      } else {
        console.error('  ❌ API error:', data.message);
        setFeeError(data.message || 'Could not calculate delivery fee');
        setDeliveryFee(null);
        setDistanceKm(null);
      }
    } catch (err) {
      console.error('  ❌ Fetch error:', err);
      setFeeError('Network error — could not calculate delivery fee');
      setDeliveryFee(null);
    } finally {
      setCalculatingFee(false);
    }
  };

  const handleFieldChange = (field, value) => {
    const updated = { ...address, [field]: value };
    setAddress(updated);
    console.log('🚚 [DeliveryAddressForm] field changed:', field, '=', value);
    // Always pass the address back (for saving to protectedData)
    onFeeCalculated && onFeeCalculated({ deliveryAddress: updated, deliveryFeeInSubunits: null });
    // Only calculate shipping fee if not skipped (i.e. automatic shipping, not pickup/manual)
    if (!skipFeeCalculation) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => calculateFee(updated), 800);
    }
  };

  return (
    <div className={classNames(css.root, className)}>
      <h3 className={css.heading}>Delivery Address</h3>

      {!hasSellerLocation && (
        <p className={css.warning}>
          Seller location not set — delivery fee will be confirmed separately.
        </p>
      )}

      <div className={css.fieldWrapper}>
        <label className={css.label} htmlFor="deliveryStreet">Street address</label>
        <input
          id="deliveryStreet"
          type="text"
          className={css.input}
          placeholder="e.g. 12 Allen Avenue"
          disabled={disabled}
          value={address.street}
          onChange={e => handleFieldChange('street', e.target.value)}
        />
      </div>

      <div className={css.formRow}>
        <div className={css.fieldWrapper}>
          <label className={css.label} htmlFor="deliveryCity">City *</label>
          <input
            id="deliveryCity"
            type="text"
            className={css.input}
            placeholder="e.g. Lagos"
            disabled={disabled}
            value={address.city}
            onChange={e => handleFieldChange('city', e.target.value)}
          />
        </div>
        <div className={css.fieldWrapper}>
          <label className={css.label} htmlFor="deliveryState">State</label>
          <input
            id="deliveryState"
            type="text"
            className={css.input}
            placeholder="e.g. Lagos State"
            disabled={disabled}
            value={address.state}
            onChange={e => handleFieldChange('state', e.target.value)}
          />
        </div>
      </div>

      <div className={css.fieldWrapper}>
        <label className={css.label} htmlFor="deliveryCountry">Country *</label>
        <input
          id="deliveryCountry"
          type="text"
          className={css.input}
          placeholder="e.g. Nigeria"
          disabled={disabled}
          value={address.country}
          onChange={e => handleFieldChange('country', e.target.value)}
        />
      </div>

      <div className={css.fieldWrapper}>
        <label className={css.label} htmlFor="deliveryPhone">Phone number</label>
        <input
          id="deliveryPhone"
          type="tel"
          className={css.input}
          placeholder="e.g. 08012345678"
          disabled={disabled}
          value={address.phone}
          onChange={e => handleFieldChange('phone', e.target.value)}
        />
      </div>

      {!skipFeeCalculation && (
      <div className={css.feeSection}>
        {calculatingFee && (
          <p className={css.calculating}>Calculating delivery fee...</p>
        )}
        {!calculatingFee && deliveryFee != null && (
          <div className={css.feeResult}>
            <span className={css.feeLabel}>Estimated delivery fee:</span>
            <span className={css.feeAmount}>{formatCurrency(deliveryFee)}</span>
            {distanceKm != null && (
              <span className={css.distance}>&nbsp;({distanceKm.toFixed(1)} km)</span>
            )}
          </div>
        )}
        {!calculatingFee && feeError && (
          <p className={css.feeError}>{feeError}</p>
        )}
      </div>
      )}
      {skipFeeCalculation && (
        <p className={css.warning}>
          Delivery fee will be arranged directly between you and the seller.
        </p>
      )}
    </div>
  );
};

export default DeliveryAddressForm;