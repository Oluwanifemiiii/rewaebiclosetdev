const integrationSdk = require('sharetribe-flex-integration-sdk');

const INTEGRATION_CLIENT_ID = process.env.SHARETRIBE_INTEGRATION_CLIENT_ID;
const INTEGRATION_CLIENT_SECRET = process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET;
const BASE_URL = process.env.REACT_APP_SHARETRIBE_SDK_BASE_URL;

module.exports = async (req, res) => {
  try {
    const { transactionId, deliveryAddress, deliveryFeeInSubunits } = req.body;

    console.log('=== SAVE DELIVERY DATA (Integration SDK) ===');
    console.log('transactionId      :', transactionId);
    console.log('deliveryFeeInSubunits:', deliveryFeeInSubunits);
    console.log('deliveryAddress    :', deliveryAddress);

    if (!transactionId) {
      return res.status(400).json({ success: false, message: 'transactionId is required' });
    }
    if (!INTEGRATION_CLIENT_ID || !INTEGRATION_CLIENT_SECRET) {
      return res.json({ success: false, message: 'Integration API credentials not set' });
    }

    const sdk = integrationSdk.createInstance({
      clientId: INTEGRATION_CLIENT_ID,
      clientSecret: INTEGRATION_CLIENT_SECRET,
      ...(BASE_URL ? { baseUrl: BASE_URL } : {}),
    });

    await sdk.transactions.updateMetadata({
      id: transactionId,
      metadata: {
        deliveryAddress: deliveryAddress || null,
        deliveryFeeInSubunits: deliveryFeeInSubunits || null,
      },
    });

    console.log('✅ Delivery data saved — visible to both buyer and seller');
    return res.json({ success: true });

  } catch (error) {
    console.error('❌ [save-delivery-data] Error:', error.message);
    if (error.data) console.error('   API error:', JSON.stringify(error.data));
    return res.json({ success: false, message: error.message });
  }
};