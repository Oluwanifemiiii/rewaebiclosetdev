const { getSdk } = require('../api-util/sdk');
const { handleError } = require('../api-util/sdk');

module.exports = async (req, res) => {
  try {
    const { transactionId, paystackReference, amount } = req.body;

    console.log('=== TRANSITION TO PAYSTACK PAYMENT ===');
    console.log('Transaction ID:', transactionId);
    console.log('Reference:', paystackReference);
    console.log('Amount:', amount);

    if (!transactionId || !paystackReference || !amount) {
      return res.status(400).json({
        success: false,
        message: 'Missing required parameters',
      });
    }

    const sdk = getSdk(req, res);

    // ✅ First, get the transaction to check its current state
    const txResponse = await sdk.transactions.show({ id: transactionId });
    const transaction = txResponse.data.data;
    
    console.log('Current transaction state:', transaction.attributes.lastTransition);
    console.log('Transaction process:', transaction.attributes.processName);

    // Transition from offer-pending to pending-payment-paystack
    const response = await sdk.transactions.transition({
      id: transactionId,
      transition: 'transition/request-payment-paystack',
      params: {
        protectedData: {
          paystack: true,
          paystackReference,
          paystackAmount: amount,
        },
      },
    });

    console.log('✅ Transitioned to pending-payment-paystack');

    return res.status(200).json({
      success: true,
      data: response.data.data,
    });
  } catch (error) {
    console.error('❌ Transition error:', error.data || error);
    return handleError(res, error);
  }
};