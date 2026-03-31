const { deserialize } = require('../api-util/sdk');

module.exports = async (req, res) => {
  try {
    const { processAlias, transition, params } = req.body;

    console.log('=== PAYSTACK INITIATE ===');
    console.log('Process:', processAlias);
    console.log('Transition:', transition);
    console.log('Params:', params);

    const { 
      listingId, 
      paystackReference, 
      amount, 
      bookingStart, 
      bookingEnd, 
      unitType,
      listingType,
      transactionProcessAlias,
      deliveryAddress,
      deliveryFeeInSubunits,
    } = params;

    const requestBody = {
      isSpeculative: false,
      // Pass deliveryFeeInSubunits in orderData so lineItems.js adds the delivery fee line item
      orderData: {
        ...(deliveryFeeInSubunits ? { deliveryFeeInSubunits } : {}),
        ...(deliveryAddress ? { deliveryAddress } : {}),
        paymentGateway: 'paystack',
      },
      bodyParams: {
        processAlias,
        transition,
        params: {
          listingId,
          cardToken: 'paystack_payment',
          bookingStart,
          bookingEnd,
          protectedData: {
            paystack: true,
            paystackReference,
            paystackAmount: amount,
            unitType,
            listingType,
            transactionProcessAlias,
            deliveryAddress,
            ...(deliveryFeeInSubunits ? { deliveryFeeInSubunits } : {}),
          },
        },
      },
      queryParams: {
        include: ['booking', 'provider'],
        expand: true,
      },
    };

    console.log('Forwarding to initiate-privileged...');

    // ✅ Create a mock response object to capture the result
    const mockRes = {
      statusCode: 200,
      headers: {},
      body: null,
      status(code) {
        this.statusCode = code;
        return this;
      },
      set(key, value) {
        this.headers[key] = value;
        return this;
      },
      send(data) {
        this.body = data;
        return this;
      },
      end() {
        // When initiate-privileged finishes, send proper JSON response
        try {
          const deserialized = deserialize(this.body);
          console.log('✅ Transaction created:', deserialized.data?.data?.id?.uuid);
          
          res.status(this.statusCode).json({
            success: true,
            data: deserialized.data.data,
          });
        } catch (err) {
          console.error('❌ Failed to deserialize response:', err);
          res.status(500).json({
            success: false,
            message: 'Failed to process response',
          });
        }
      },
    };

    // Forward to initiate-privileged with mock response
    req.body = requestBody;
    const initiatePrivilegedHandler = require('./initiate-privileged');
    initiatePrivilegedHandler(req, mockRes);

  } catch (error) {
    console.error('❌ Paystack error:', error);
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};