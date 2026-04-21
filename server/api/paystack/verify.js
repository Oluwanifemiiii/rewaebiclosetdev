const axios = require('axios');
const { getSdk } = require('../../api-util/sdk');
const sharetribeSdk = require('sharetribe-flex-sdk');
const { UUID } = sharetribeSdk.types;

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