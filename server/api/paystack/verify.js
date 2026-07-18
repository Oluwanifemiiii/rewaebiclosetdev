const axios = require('axios');
const { getSdk } = require('../../api-util/sdk');
const sharetribeSdk = require('sharetribe-flex-sdk');
const { UUID } = sharetribeSdk.types;

// Must match USD_TO_NGN_RATE in CheckoutPageWithPayment.js — the client
// converts USD listing totals to NGN kobo with this rate before charging.
const USD_TO_NGN_RATE = 1490;

/**
 * The minimum amount (in kobo) this transaction should have been charged.
 * Derived from server-written data only:
 *  - Manual sellers: protectedData.lineItems (written by initiate-privileged;
 *    subunits are NGN kobo) + the delivery fee recorded at initiate.
 *  - Other sellers: the transaction's payinTotal, converted if in USD.
 * Returns null when no expectation can be derived (fail open with a loud log
 * rather than blocking legitimate legacy transactions).
 */
const expectedAmountInKobo = tx => {
  const pd = tx?.attributes?.protectedData || {};
  const deliveryFeeInSubunits = Math.round(Number(pd.deliveryFeeInSubunits)) || 0;

  const storedLineItems = Array.isArray(pd.lineItems) ? pd.lineItems : [];
  if (storedLineItems.length > 0) {
    const customerTotal = storedLineItems
      .filter(li => li.includeFor?.includes('customer') && !li.reversal)
      .reduce((sum, li) => {
        const unitAmount = Number(li.unitPrice?.amount) || 0;
        const lineTotal =
          li.percentage != null
            ? Math.round(unitAmount * (Number(li.percentage) / 100))
            : unitAmount * (Number(li.quantity) || 1);
        return sum + lineTotal;
      }, 0);
    return customerTotal > 0 ? customerTotal + deliveryFeeInSubunits : null;
  }

  const payinTotal = tx?.attributes?.payinTotal;
  if (payinTotal && Number(payinTotal.amount) > 0) {
    return payinTotal.currency === 'NGN'
      ? payinTotal.amount
      : payinTotal.currency === 'USD'
      ? Math.round((payinTotal.amount / 100) * USD_TO_NGN_RATE * 100)
      : null;
  }
  return null;
};

module.exports = async (req, res) => {
  try {
    const { reference, transactionId } = req.body;

    console.log('=== PAYSTACK VERIFY ===');
    console.log('Reference:', reference);
    console.log('Transaction ID:', transactionId);

    if (!reference || !transactionId) {
      return res.status(400).json({
        success: false,
        message: "Missing reference or transactionId",
      });
    }

    // Verify with Paystack
    const url = `https://api.paystack.co/transaction/verify/${reference}`;
    const response = await axios.get(url, {
      headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` },
    });

    if (!(response.data.status && response.data.data.status === "success")) {
      return res.status(400).json({
        success: false,
        message: "Payment verification failed",
      });
    }

    console.log('✅ Payment verified with Paystack');

    // Get SDK
    const sdk = getSdk(req, res);

    // ── Guard 1: the reference must belong to THIS transaction ──
    // Otherwise one real payment reference could be replayed to confirm
    // any number of other transactions.
    const txShowResponse = await sdk.transactions.show({ id: new UUID(transactionId) });
    const tx = txShowResponse.data.data;
    const storedReference = tx.attributes?.protectedData?.paystackReference;
    if (!storedReference || storedReference !== reference) {
      console.error(
        `❌ Reference mismatch: transaction ${transactionId} expects ${storedReference}, got ${reference}`
      );
      return res.status(400).json({
        success: false,
        message: 'Payment reference does not match this transaction',
      });
    }

    // ── Guard 2: the amount actually paid must cover the transaction total ──
    // The charge amount is computed in the browser, so it cannot be trusted.
    const paidAmountKobo = Number(response.data.data.amount);
    const paidCurrency = response.data.data.currency;
    const expectedKobo = expectedAmountInKobo(tx);
    if (paidCurrency !== 'NGN') {
      console.error(`❌ Unexpected Paystack currency: ${paidCurrency}`);
      return res.status(400).json({
        success: false,
        message: 'Unexpected payment currency',
      });
    }
    if (expectedKobo == null) {
      console.error(
        `⚠️ [paystack] no expected amount derivable for tx ${transactionId} — allowing, but check this transaction manually`
      );
    } else if (!(paidAmountKobo >= expectedKobo)) {
      console.error(
        `❌ Underpayment: paid ${paidAmountKobo} kobo, expected at least ${expectedKobo} kobo for tx ${transactionId}`
      );
      return res.status(400).json({
        success: false,
        message: 'Amount paid does not match the order total',
      });
    } else {
      console.log(`✅ Amount check passed: paid ${paidAmountKobo} kobo >= expected ${expectedKobo} kobo`);
    }

    // Transition to offer-accepted
    const transitionResponse = await sdk.transactions.transition({
      id: new UUID(transactionId),
      transition: "transition/confirm-payment-paystack",
      params: {
        protectedData: {
          paymentConfirmed: true,
          paymentReference: reference,
          paymentMethod: 'paystack',
        },
      }
    });

    console.log('✅ Transaction confirmed');
    
    // ✅ FIX: Access lastTransition correctly
    const lastTransition = transitionResponse?.data?.data?.attributes?.lastTransition;
    console.log('Last transition:', lastTransition);

    // ✅ Wait a moment for the transaction to fully process
    await new Promise(resolve => setTimeout(resolve, 4000));

    // ✅ Fetch the complete updated transaction
    const fullTransaction = await sdk.transactions.show({
      id: new UUID(transactionId),
      include: [
        'customer',
        'customer.profileImage',
        'provider',
        'provider.profileImage',
        'listing',
        'listing.images',
        'listing.author',
        'booking',
        'reviews',
      ],
    });

    console.log('✅ Full transaction fetched');
    console.log('Current state:', fullTransaction.data.data.attributes.lastTransition);

    return res.status(200).json({
      success: true,
      verified: true,
      transaction: fullTransaction.data.data,
    });

  } catch (e) {
    console.error("❌ Verify error:", e.message);
    console.error("Stack:", e.stack);
    return res.status(500).json({
      success: false,
      message: e.message,
      error: e.message,
    });
  }
};