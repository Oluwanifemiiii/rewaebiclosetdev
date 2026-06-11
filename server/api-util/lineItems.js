// server/api-util/lineItems.js

const {
  calculateQuantityFromDates,
  calculateQuantityFromHours,
  calculateShippingFee,
  getProviderCommissionMaybe,
  getCustomerCommissionMaybe,
} = require('./lineItemHelpers');
const { types } = require('sharetribe-flex-sdk');
const { Money } = types;

// ============================================================================
// TAX CALCULATION
// ============================================================================

// Nigeria VAT rate — used for Paystack payments
const NIGERIA_VAT_RATE = 7.5;

/**
 * Calculate tax using Stripe Tax API.
 *
 * Prerequisites:
 *   1. npm install stripe
 *   2. Enable Stripe Tax in Dashboard: https://dashboard.stripe.com/tax
 *   3. Add tax registrations for your jurisdictions
 *   4. Set your preset product tax code
 *
 * @param {number} amountInSubunits - Taxable amount in smallest currency unit
 * @param {string} currency - ISO currency code
 * @param {Object} customerAddress - Customer billing address
 * @returns {number} tax amount in subunits, or 0
 */
const calculateStripeTax = async (amountInSubunits, currency, customerAddress) => {
  try {
    const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

    if (!customerAddress?.country) {
      console.log('[Tax] No customer country — skipping Stripe Tax');
      return 0;
    }

    // Build address object with only non-empty fields
    const address = {};
    if (customerAddress.country) address.country = customerAddress.country;
    if (customerAddress.state) address.state = customerAddress.state;
    if (customerAddress.postal_code) address.postal_code = customerAddress.postal_code;
    if (customerAddress.city) address.city = customerAddress.city;
    if (customerAddress.line1) address.line1 = customerAddress.line1;

    const calculation = await stripe.tax.calculations.create({
      currency: currency.toLowerCase(),
      line_items: [
        {
          amount: amountInSubunits,
          reference: 'marketplace-order',
          tax_code: 'txcd_99999999', // General tangible goods
        },
      ],
      customer_details: {
        address,
        address_source: 'billing',
      },
    });

    const taxAmount = calculation.tax_amount_exclusive || 0;
    console.log(`[Tax] Stripe Tax: ${taxAmount} ${currency} (calc: ${calculation.id})`);
    return taxAmount;
  } catch (err) {
    console.error('[Tax] Stripe Tax failed:', err.message);
    // Don't block the transaction — proceed without tax
    return 0;
  }
};

/**
 * Calculate Nigerian VAT (7.5%) for Paystack payments.
 *
 * @param {number} amountInSubunits - Taxable amount in kobo
 * @returns {number} VAT amount in kobo
 */
const calculateNigeriaVAT = (amountInSubunits) => {
  const vat = Math.round(amountInSubunits * (NIGERIA_VAT_RATE / 100));
  console.log(`[Tax] Nigeria VAT ${NIGERIA_VAT_RATE}%: ${vat} kobo (on ${amountInSubunits})`);
  return vat;
};

/**
 * Build a tax line item if there's a non-zero tax amount.
 *
 * @param {number} taxAmount - Tax in subunits
 * @param {string} currency - ISO currency code
 * @returns {Array} [] or [taxLineItem]
 */
const getTaxLineItemMaybe = (taxAmount, currency) => {
  if (!taxAmount || taxAmount <= 0) return [];
  return [
    {
      code: 'line-item/tax',
      unitPrice: new Money(taxAmount, currency),
      quantity: 1,
      includeFor: ['customer', 'provider'],
    },
  ];
};

/**
 * Calculate the order subtotal from the base order line item.
 */
const getOrderSubtotal = (order) => {
  const { unitPrice, quantity, units, seats } = order;
  if (quantity) return unitPrice.amount * quantity;
  if (units && seats) return unitPrice.amount * units * seats;
  return unitPrice.amount;
};

// ============================================================================
// DELIVERY FEE (unchanged)
// ============================================================================

const getDeliveryFeeLineItemMaybe = (orderData, currency) => {
  const { deliveryFeeInSubunits } = orderData || {};
  if (!deliveryFeeInSubunits || deliveryFeeInSubunits <= 0) return [];

  return [
    {
      code: 'line-item/delivery-fee',
      unitPrice: new Money(deliveryFeeInSubunits, currency),
      quantity: 1,
      includeFor: ['customer', 'provider'],
    },
  ];
};

// ============================================================================
// QUANTITY HELPERS (unchanged)
// ============================================================================

const getItemQuantityAndLineItems = (orderData, publicData, currency) => {
  const quantity = orderData ? orderData.stockReservationQuantity : null;
  const deliveryMethod = orderData && orderData.deliveryMethod;
  const isShipping = deliveryMethod === 'shipping';
  const { shippingPriceInSubunitsOneItem, shippingPriceInSubunitsAdditionalItems } =
    publicData || {};

  const hasDistanceFee =
    isShipping &&
    orderData.deliveryFeeInSubunits &&
    orderData.deliveryFeeInSubunits > 0;

  const shippingFee =
    isShipping && !hasDistanceFee
      ? calculateShippingFee(
          shippingPriceInSubunitsOneItem,
          shippingPriceInSubunitsAdditionalItems,
          currency,
          quantity
        )
      : null;

  const deliveryLineItems = hasDistanceFee
    ? getDeliveryFeeLineItemMaybe(orderData, currency)
    : shippingFee
    ? [
        {
          code: 'line-item/shipping-fee',
          unitPrice: shippingFee,
          quantity: 1,
          includeFor: ['customer', 'provider'],
        },
      ]
    : [];

  return { quantity, extraLineItems: deliveryLineItems };
};

const getOfferQuantityAndLineItems = orderData => {
  return { quantity: 1, extraLineItems: [] };
};

const getFixedQuantityAndLineItems = orderData => {
  const { seats } = orderData || {};
  const hasSeats = !!seats;
  return hasSeats ? { units: 1, seats, extraLineItems: [] } : { quantity: 1, extraLineItems: [] };
};

const getHourQuantityAndLineItems = orderData => {
  const { bookingStart, bookingEnd, seats } = orderData || {};
  const hasSeats = !!seats;
  const units =
    bookingStart && bookingEnd ? calculateQuantityFromHours(bookingStart, bookingEnd) : null;
  return hasSeats ? { units, seats, extraLineItems: [] } : { quantity: units, extraLineItems: [] };
};

// ============================================================================
// CAUTION FEE (refundable deposit — rental listings only)
// ============================================================================

/**
 * Add a refundable caution fee line item for rental bookings (day / night / hour).
 * The amount is stored in listing.attributes.publicData.cautionFee as integer subunits.
 * It is charged to the customer and paid out to the provider; the provider refunds it
 * manually via Stripe / Paystack dashboard after the item is returned.
 *
 * Placed AFTER tax so deposits are not taxed.
 *
 * @param {Object} publicData
 * @param {string} currency
 * @returns {Array}
 */
const getCautionFeeLineItemMaybe = (publicData, currency) => {
  const { cautionFee, unitType } = publicData || {};
  const isRental = ['day', 'night', 'hour'].includes(unitType);
  if (!isRental || !cautionFee || cautionFee <= 0) return [];

  return [
    {
      code: 'line-item/caution-fee',
      unitPrice: new Money(cautionFee, currency),
      quantity: 1,
      includeFor: ['customer', 'provider'],
    },
  ];
};

const getDateRangeQuantityAndLineItems = (orderData, code) => {
  const { bookingStart, bookingEnd, bookingDisplayStart, bookingDisplayEnd, seats } = orderData;
  const hasSeats = !!seats;
  // Use display dates (original 1-day selection) for pricing if available,
  // so the customer is charged for 1 day, not the full buffered range.
  const pricingStart = bookingDisplayStart || bookingStart;
  const pricingEnd = bookingDisplayEnd || bookingEnd;
  const units =
    pricingStart && pricingEnd ? calculateQuantityFromDates(pricingStart, pricingEnd, code) : null;
  return hasSeats ? { units, seats, extraLineItems: [] } : { quantity: units, extraLineItems: [] };
};

// ============================================================================
// MAIN: transactionLineItems (now async)
// ============================================================================

/**
 * Returns collection of lineItems (max 50)
 *
 * All the line-items dedicated to _customer_ define the "payin total".
 * Similarly, the sum of all the line-items included for _provider_ create "payout total".
 * Platform gets the commission, which is the difference between payin and payout totals.
 *
 * NEW optional fields in orderData:
 *   - orderData.customerAddress   {Object}  Billing address for Stripe Tax
 *   - orderData.paymentGateway    {string}  'stripe' | 'paystack' (default: 'stripe')
 *
 * @param {Object} listing
 * @param {Object} orderData
 * @param {Object} providerCommission
 * @param {Object} customerCommission
 * @returns {Promise<Array>} lineItems
 */
exports.transactionLineItems = async (listing, orderData, providerCommission, customerCommission) => {
  // ── Buy-now shortcut (Paystack direct purchase) ──────────────────────────
  if (orderData && orderData.buyNow === true) {
    const price = listing?.attributes?.publicData?.value;

    if (!price) {
      throw new Error('No buy-now value found in listing.attributes.publicData.value');
    }

    const currency = listing.attributes.price.currency;
    const priceInCents = Math.round(Number(price) * 100);

    const baseItem = {
      code: 'line-item/item',
      unitPrice: new Money(priceInCents, currency),
      quantity: 1,
      includeFor: ['customer', 'provider'],
    };

    return [
      baseItem,
      ...getDeliveryFeeLineItemMaybe(orderData, currency),
      ...(providerCommission
        ? [
            {
              code: providerCommission.code,
              percentage: providerCommission.percentage,
              includeFor: ['provider'],
            },
          ]
        : []),
      ...(customerCommission
        ? [
            {
              code: customerCommission.code,
              percentage: customerCommission.percentage,
              includeFor: ['customer'],
            },
          ]
        : []),
    ];
  }

  // ── Standard flow ────────────────────────────────────────────────────────
  const publicData = listing.attributes.publicData;
  const { unitType, priceVariants, priceVariationsEnabled } = publicData;

  const isBookable = ['day', 'night', 'hour', 'fixed'].includes(unitType);
  const isNegotiationUnitType = ['offer', 'request'].includes(unitType);
  const priceAttribute = listing.attributes.price;
  const currency = priceAttribute?.currency || orderData.currency;

  const { priceVariantName, offer } = orderData || {};
  const priceVariantConfig = priceVariants
    ? priceVariants.find(pv => pv.name === priceVariantName)
    : null;
  const { priceInSubunits } = priceVariantConfig || {};
  const isPriceInSubunitsValid = Number.isInteger(priceInSubunits) && priceInSubunits >= 0;

  const unitPrice =
    isBookable && priceVariationsEnabled && isPriceInSubunitsValid
      ? new Money(priceInSubunits, currency)
      : offer instanceof Money && isNegotiationUnitType
      ? offer
      : priceAttribute;

  const code = `line-item/${unitType}`;

  const quantityAndExtraLineItems =
    unitType === 'item'
      ? getItemQuantityAndLineItems(orderData, publicData, currency)
      : unitType === 'fixed'
      ? getFixedQuantityAndLineItems(orderData)
      : unitType === 'hour'
      ? getHourQuantityAndLineItems(orderData)
      : ['day', 'night'].includes(unitType)
      ? getDateRangeQuantityAndLineItems(orderData, code)
      : isNegotiationUnitType
      ? getOfferQuantityAndLineItems(orderData)
      : {};

  const { quantity, units, seats, extraLineItems } = quantityAndExtraLineItems;

  if (!quantity && !(units && seats)) {
    const missingFields = [];
    if (!quantity) missingFields.push('quantity');
    if (!units) missingFields.push('units');
    if (!seats) missingFields.push('seats');

    const message = `Error: orderData is missing the following information: ${missingFields.join(
      ', '
    )}. Quantity or either units & seats is required.`;

    const error = new Error(message);
    error.status = 400;
    error.statusText = message;
    error.data = {};
    throw error;
  }

  const quantityOrSeats = !!units && !!seats ? { units, seats } : { quantity };
  const order = {
    code,
    unitPrice,
    ...quantityOrSeats,
    includeFor: ['customer', 'provider'],
  };

  // Delivery fees
  const bookingDeliveryFees = isBookable
    ? getDeliveryFeeLineItemMaybe(orderData, currency)
    : [];
  const negotiationDeliveryFees = isNegotiationUnitType
    ? getDeliveryFeeLineItemMaybe(orderData, currency)
    : [];

  // ── Tax calculation ──────────────────────────────────────────────────────
  // Tax is only calculated for Stripe payments via Stripe Tax API.
  // Paystack handles VAT on their end — no need to add it here.
  const customerAddress = orderData?.customerAddress || null;
  const paymentGateway = orderData?.paymentGateway || 'stripe';

  let taxAmount = 0;

  if (paymentGateway !== 'paystack' && customerAddress) {
    // Stripe → use Stripe Tax API (requires customer address)
    const orderSubtotal = getOrderSubtotal(order);
    const deliveryFeeAmount = orderData?.deliveryFeeInSubunits || 0;
    const taxableAmount = orderSubtotal + deliveryFeeAmount;
    taxAmount = await calculateStripeTax(taxableAmount, currency, customerAddress);
  }

  const taxLineItem = getTaxLineItemMaybe(taxAmount, currency);

  const lineItems = [
    order,
    ...extraLineItems,
    ...bookingDeliveryFees,
    ...negotiationDeliveryFees,
    ...taxLineItem,
    ...getCautionFeeLineItemMaybe(publicData, currency),
    ...getProviderCommissionMaybe(providerCommission, order, currency),
    ...getCustomerCommissionMaybe(customerCommission, order, currency),
  ];

  return lineItems;
};