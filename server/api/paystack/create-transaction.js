// server/api/paystack/create-transaction.js
const { getTrustedSdk, handleError } = require('../../api-util/sdk');

module.exports = async (req, res) => {
  try {
    const { listingId, orderData = {}, paystackData } = req.body;

    if (!listingId) {
      return res.status(400).json({
        success: false,
        message: "Missing listingId",
      });
    }

    if (!paystackData || !paystackData.reference) {
      return res.status(400).json({
        success: false,
        message: "Missing Paystack reference",
      });
    }

    const sdk = await getTrustedSdk(req);

    const bodyParams = {
      processAlias: "paystack-purchase/release-1",
      transition: "transition/initiate",
      params: {
        listingId,

        // merge any needed order data (quantity, variant, seats, etc.)
        ...orderData,

        protectedData: {
          paystackReference: paystackData.reference,
          paystackAmount: paystackData.amount,
          paystackCurrency: paystackData.currency,
        },
      },
    };

    const queryParams = {
      include: ["provider"],
      expand: true,
    };

    const response = await sdk.transactions.initiate(bodyParams, queryParams);
    const tx = response.data.data;

    return res.status(200).json({
      success: true,
      transaction: tx,
    });

  } catch (e) {
    handleError(res, e);
  }
};
