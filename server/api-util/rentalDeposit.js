// server/api-util/rentalDeposit.js
//
// Helpers for the rental deposit hold. A rental deposit is a manual-capture
// PaymentIntent created on the PLATFORM account (not on the seller's connected
// account). At return time we either cancel the PI (releasing the hold) or
// capture some/all of it (damage claim) and transfer the captured amount to
// the seller. Capture is done manually from the Stripe dashboard.
//
// Stripe only. Paystack rentals keep the deposit as a line item.
//
// NOTE: card authorizations expire ~7 days after they are placed. If a rental
// runs longer than that, the hold silently expires — Stripe sends
// payment_intent.canceled. Re-authorization is not implemented yet.

const RENTAL_UNIT_TYPES = ['day', 'night', 'hour'];

const getStripe = () => {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error(
      'Rental deposit hold requires STRIPE_SECRET_KEY (platform secret key). ' +
        'Set it in .env.development and restart the server.'
    );
  }
  return require('stripe')(process.env.STRIPE_SECRET_KEY);
};

/**
 * The caution fee in integer subunits, or null if this listing is not a rental
 * with a valid deposit. Tolerates the fee being stored as a numeric string.
 */
const depositAmountSubunits = listing => {
  const publicData = listing?.attributes?.publicData || {};
  const { unitType, cautionFee } = publicData;
  if (!RENTAL_UNIT_TYPES.includes(unitType)) return null;
  const amount = Math.round(Number(cautionFee));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

const isRentalWithDeposit = listing => depositAmountSubunits(listing) != null;

/**
 * Create the deposit hold PI on the platform account. Not yet confirmed — the
 * frontend confirms it with the same payment method used on the main PI right
 * after the main confirm succeeds. The client_secret is intentionally NOT
 * returned for storage: the customer fetches it from /api/rental-deposit,
 * which authenticates them against the transaction.
 *
 * transactionId may be null at initiate time (the transaction doesn't exist
 * yet); in that case call attachTransactionToDeposit() once it does. The
 * /api/rental-deposit endpoint refuses to act on a PI whose metadata is not
 * bound to the transaction that references it.
 */
const createDepositHold = async ({ listing, currency, listingId, customerEmail, transactionId }) => {
  const stripe = getStripe();
  const cautionFee = depositAmountSubunits(listing);
  if (!cautionFee) {
    throw new Error('Listing does not have a valid caution fee for a deposit hold.');
  }

  const pi = await stripe.paymentIntents.create({
    amount: cautionFee,
    currency: currency.toLowerCase(),
    capture_method: 'manual',
    // Deposit is a straightforward card charge — no destination, no transfer_data.
    // Funds (if ever captured) land in the platform account.
    payment_method_types: ['card'],
    description: `Rental deposit hold — listing ${listingId}`,
    metadata: {
      purpose: 'rental_deposit',
      listing_id: String(listingId || ''),
      caution_fee_subunits: String(cautionFee),
      ...(transactionId ? { transaction_id: String(transactionId) } : {}),
    },
    ...(customerEmail ? { receipt_email: customerEmail } : {}),
  });

  return {
    depositPaymentIntentId: pi.id,
    depositAmountSubunits: cautionFee,
    depositCurrency: currency,
  };
};

/**
 * Bind the deposit PI to its transaction. /api/rental-deposit requires this
 * binding before it will hand out the client_secret or release the hold, so a
 * transaction whose protectedData points at someone else's PI gets nothing.
 */
const attachTransactionToDeposit = async (paymentIntentId, transactionId) => {
  const stripe = getStripe();
  const update = () =>
    stripe.paymentIntents.update(paymentIntentId, {
      metadata: { transaction_id: String(transactionId) },
    });
  try {
    return await update();
  } catch (e) {
    // One retry — if this fails permanently the deposit can't be confirmed and
    // the provider's accept gate will block the booking (fail-safe direction).
    console.error('[deposit] metadata attach failed, retrying:', e.message);
    return update();
  }
};

const retrieveDeposit = paymentIntentId => getStripe().paymentIntents.retrieve(paymentIntentId);

// Also works for the transaction's main PI — Sharetribe creates destination
// charges on the platform account, so the platform key can read it.
const retrievePaymentIntent = retrieveDeposit;

/**
 * Attach the platform Stripe Customer to the deposit PI. Needed when the
 * customer pays with a saved card: the payment method belongs to a Customer,
 * and Stripe refuses to confirm a PI with a customer-owned payment method
 * unless the PI carries that same customer.
 */
const attachCustomerToDeposit = (paymentIntentId, stripeCustomerId) =>
  getStripe().paymentIntents.update(paymentIntentId, { customer: stripeCustomerId });

const cancelDeposit = paymentIntentId =>
  getStripe().paymentIntents.cancel(paymentIntentId, { cancellation_reason: 'requested_by_customer' });

module.exports = {
  isRentalWithDeposit,
  depositAmountSubunits,
  createDepositHold,
  attachTransactionToDeposit,
  attachCustomerToDeposit,
  retrieveDeposit,
  retrievePaymentIntent,
  cancelDeposit,
};
