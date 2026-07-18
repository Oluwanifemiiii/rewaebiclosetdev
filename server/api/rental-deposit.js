// POST /api/rental-deposit
//
// Actions on the rental deposit hold (a manual-capture PI on the platform
// Stripe account). The caller must be a party of the transaction — we prove
// that by fetching the transaction with the caller's own SDK session, which
// only returns transactions the user participates in.
//
// body: { transactionId: string, action: 'status' | 'client-secret' | 'release' }
//
//   status         customer or provider — sanitized hold status. The provider's
//                  accept flow uses this to verify the hold before accepting.
//   client-secret  customer only — the PI client_secret, needed to confirm the
//                  hold at checkout. Never persisted in the transaction.
//   release        provider only — cancels the hold (after a safe return, or
//                  when declining the booking).
//
// Capturing a deposit (damage claim) is deliberately NOT exposed here: it is
// an operator decision made from the Stripe dashboard, so a provider cannot
// unilaterally grab a customer's deposit.

const { getSdk } = require('../api-util/sdk');
const {
  retrieveDeposit,
  retrievePaymentIntent,
  attachCustomerToDeposit,
  cancelDeposit,
} = require('../api-util/rentalDeposit');

const HELD_STATUS = 'requires_capture';
const CONFIRMABLE_STATUSES = ['requires_payment_method', 'requires_confirmation', 'requires_action'];
const RELEASABLE_STATUSES = [...CONFIRMABLE_STATUSES, HELD_STATUS];

module.exports = async (req, res) => {
  try {
    const { transactionId, action } = req.body || {};
    const txId = typeof transactionId === 'object' && transactionId?.uuid ? transactionId.uuid : transactionId;

    if (!txId || !['status', 'client-secret', 'release'].includes(action)) {
      return res.status(400).json({ error: 'invalid-request' });
    }

    const sdk = getSdk(req, res);
    // transactions.show with the caller's own session throws 404 unless the
    // caller is the customer or provider of this transaction.
    const [txRes, meRes] = await Promise.all([
      sdk.transactions.show({ id: txId, include: ['customer', 'provider'] }),
      sdk.currentUser.show(),
    ]);

    const tx = txRes.data.data;
    const meId = meRes.data.data.id.uuid;
    const customerId = tx.relationships?.customer?.data?.id?.uuid;
    const providerId = tx.relationships?.provider?.data?.id?.uuid;
    const role = meId === customerId ? 'customer' : meId === providerId ? 'provider' : null;
    if (!role) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const rentalDeposit = tx.attributes?.protectedData?.rentalDeposit;
    if (!rentalDeposit?.paymentIntentId) {
      return res.status(404).json({ error: 'no-deposit' });
    }

    const pi = await retrieveDeposit(rentalDeposit.paymentIntentId);

    // The PI must be one of our deposit holds AND be bound to this exact
    // transaction. This blocks a party who managed to write a foreign PI id
    // into protectedData from reading its secret or cancelling it.
    const boundTxId = pi.metadata?.transaction_id;
    if (pi.metadata?.purpose !== 'rental_deposit' || boundTxId !== txId) {
      console.error(
        `[deposit] PI/transaction mismatch: pi=${pi.id} bound to ${boundTxId}, requested for ${txId}`
      );
      return res.status(409).json({ error: 'deposit-mismatch' });
    }

    if (action === 'status') {
      return res.status(200).json({
        status: pi.status,
        held: pi.status === HELD_STATUS,
        amount: pi.amount,
        currency: pi.currency,
        canceledAt: pi.canceled_at || null,
      });
    }

    if (action === 'client-secret') {
      if (role !== 'customer') {
        return res.status(403).json({ error: 'customer-only' });
      }
      if (pi.status === HELD_STATUS || pi.status === 'succeeded') {
        // Hold already in place (e.g. checkout retry after a refresh).
        return res.status(200).json({ alreadyHeld: true, status: pi.status });
      }
      if (!CONFIRMABLE_STATUSES.includes(pi.status)) {
        return res.status(409).json({ error: 'not-confirmable', status: pi.status });
      }
      // Saved-card payments: the payment method belongs to the customer's
      // platform Stripe Customer, and Stripe won't confirm the deposit PI with
      // it unless the PI carries that customer. Copy it from the transaction's
      // main payment intent, which Sharetribe has already confirmed.
      if (!pi.customer) {
        try {
          const mainPiId =
            tx.attributes?.protectedData?.stripePaymentIntents?.default?.stripePaymentIntentId;
          const mainPi = mainPiId ? await retrievePaymentIntent(mainPiId) : null;
          const stripeCustomerId =
            typeof mainPi?.customer === 'string' ? mainPi.customer : mainPi?.customer?.id;
          if (stripeCustomerId) {
            await attachCustomerToDeposit(pi.id, stripeCustomerId);
          }
        } catch (err) {
          // Non-fatal: one-time card payments confirm fine without a customer.
          console.error('[deposit] could not copy customer onto deposit PI:', err.message);
        }
      }
      return res.status(200).json({ clientSecret: pi.client_secret, status: pi.status });
    }

    // action === 'release'
    if (role !== 'provider') {
      return res.status(403).json({ error: 'provider-only' });
    }
    if (pi.status === 'canceled') {
      return res.status(200).json({ released: true, status: pi.status });
    }
    if (!RELEASABLE_STATUSES.includes(pi.status)) {
      // succeeded/processing = already captured; releasing makes no sense.
      return res.status(409).json({ error: 'not-releasable', status: pi.status });
    }
    const canceled = await cancelDeposit(pi.id);
    console.log(`[deposit] released hold ${pi.id} for tx ${txId}`);
    return res.status(200).json({ released: true, status: canceled.status });
  } catch (e) {
    const status = e.status || e.statusCode || 500;
    console.error('[deposit] rental-deposit endpoint error:', e.message);
    // A 404 from transactions.show means the caller is not a party of the tx.
    return res.status(status === 404 ? 403 : 500).json({ error: 'deposit-action-failed' });
  }
};
