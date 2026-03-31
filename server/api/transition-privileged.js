const sharetribeSdk = require('sharetribe-flex-sdk');
const { transactionLineItems } = require('../api-util/lineItems');
const {
  addOfferToMetadata,
  getAmountFromPreviousOffer,
  isIntentionToMakeCounterOffer,
  isIntentionToMakeOffer,
  isIntentionToRevokeCounterOffer,
  isIntentionToUpdateOffer,
  throwErrorIfNegotiationOfferHasInvalidHistory,
} = require('../api-util/negotiation');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');

const { Money } = sharetribeSdk.types;

const transactionPromise = (sdk, id) => 
  sdk.transactions.show({ 
    id, 
    include: ['listing', 'listing.author']  // ✅ Add listing.author
  });
const getListingRelationShip = transactionShowAPIData => {
  const { data, included } = transactionShowAPIData;
  const { relationships } = data;
  const { listing: listingRef } = relationships;
  return included.find(i => i.id.uuid === listingRef.data.id.uuid);
};

const getFullOrderData = (orderData, bodyParams, currency, offers) => {
  const { offerInSubunits } = orderData || {};
  const transitionName = bodyParams.transition;
  const orderDataAndParams = { ...orderData, ...bodyParams.params, currency };

  const isNewOffer =
    isIntentionToMakeOffer(offerInSubunits, transitionName) ||
    isIntentionToMakeCounterOffer(offerInSubunits, transitionName) ||
    isIntentionToUpdateOffer(offerInSubunits, transitionName);

  return isNewOffer
    ? {
        ...orderDataAndParams,
        offer: new Money(offerInSubunits, currency),
      }
    : isIntentionToRevokeCounterOffer(transitionName)
    ? {
        ...orderDataAndParams,
        offer: new Money(getAmountFromPreviousOffer(offers), currency),
      }
    : orderDataAndParams;
};

const getUpdatedMetadata = (orderData, transition, existingMetadata) => {
  const { actor, offerInSubunits } = orderData || {};
  const hasActor = ['provider', 'customer'].includes(actor);
  const by = hasActor ? actor : null;

  const isNewOffer =
    isIntentionToMakeOffer(offerInSubunits, transition) ||
    isIntentionToMakeCounterOffer(offerInSubunits, transition) ||
    isIntentionToUpdateOffer(offerInSubunits, transition);

  return isNewOffer
    ? addOfferToMetadata(existingMetadata, {
        offerInSubunits,
        by,
        transition,
      })
    : isIntentionToRevokeCounterOffer(transition)
    ? addOfferToMetadata(existingMetadata, {
        offerInSubunits: getAmountFromPreviousOffer(existingMetadata.offers),
        by,
        transition,
      })
    : addOfferToMetadata(existingMetadata, null);
};

module.exports = (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body || {};

  const deliveryFeeFromParams = 
    bodyParams?.params?.deliveryFeeInSubunits ||
    bodyParams?.params?.protectedData?.deliveryFeeInSubunits;
  const deliveryAddressFromParams = 
    bodyParams?.params?.deliveryAddress ||
    bodyParams?.params?.protectedData?.deliveryAddress;

  // ── Tax fields ──
  const customerAddressFromParams =
    orderData?.customerAddress ||
    bodyParams?.params?.customerAddress ||
    bodyParams?.params?.protectedData?.customerAddress ||
    null;
  const paymentGatewayFromParams =
    orderData?.paymentGateway ||
    bodyParams?.params?.paymentGateway ||
    'stripe';

  const enrichedOrderData = {
    ...orderData,
    ...(deliveryFeeFromParams ? { deliveryFeeInSubunits: deliveryFeeFromParams } : {}),
    ...(deliveryAddressFromParams ? { deliveryAddress: deliveryAddressFromParams } : {}),
    ...(customerAddressFromParams ? { customerAddress: customerAddressFromParams } : {}),
    paymentGateway: paymentGatewayFromParams,
  };

  console.log('📦 [transition-privileged] deliveryFeeInSubunits from params:', deliveryFeeFromParams);
  console.log('📦 [transition-privileged] deliveryAddress from params:', deliveryAddressFromParams);
  console.log('📦 [transition-privileged] customerAddress for tax:', customerAddressFromParams);
  console.log('📦 [transition-privileged] paymentGateway:', paymentGatewayFromParams);

  const sdk = getSdk(req, res);
  const transitionName = bodyParams.transition;
  let lineItems = null;
  let metadataMaybe = {};

  Promise.all([transactionPromise(sdk, bodyParams?.id), fetchCommission(sdk)])
    .then(async responses => {
  const [showTransactionResponse, fetchAssetsResponse] = responses;
  const transaction = showTransactionResponse.data.data;
  const listing = getListingRelationShip(showTransactionResponse.data);
  const commissionAsset = fetchAssetsResponse.data.data[0];

  const existingMetadata = transaction?.attributes?.metadata;
  const existingOffers = existingMetadata?.offers || [];
  const transitions = transaction.attributes.transitions;

  throwErrorIfNegotiationOfferHasInvalidHistory(transitionName, existingOffers, transitions);

  // ✅ Check if manual seller
  const author = showTransactionResponse.data.included?.find(
    item => item.type === 'user' && item.id.uuid === listing?.relationships?.author?.data?.id?.uuid
  );
  const sellerType = author?.attributes?.profile?.publicData?.sellerType;
  const isManualSeller = sellerType === 'manual';

  const currency =
    enrichedOrderData.currency ||
    transaction.attributes.payinTotal?.currency ||
    listing.attributes.price?.currency ||
    'USD';

  // ✅ For manual sellers, create line items WITH commission
  if (isManualSeller) {
    console.log('✅ Manual seller - creating line items with commission');
    const { offerInSubunits } = enrichedOrderData || {};

    const { providerCommission } =
      commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

    // ── Provider commission (same % as Stripe sellers from Console) ──
    const hasProviderCommission =
      providerCommission?.percentage != null && providerCommission.percentage > 0;

    lineItems = [
      {
        code: 'line-item/item',
        unitPrice: { amount: offerInSubunits, currency: currency },
        quantity: 1,
        includeFor: ['customer', 'provider'],
      },
      // Provider commission (negative — deducted from provider payout)
      ...(hasProviderCommission
        ? [
            {
              code: 'line-item/provider-commission',
              unitPrice: { amount: offerInSubunits, currency: currency },
              percentage: -providerCommission.percentage,
              includeFor: ['provider'],
            },
          ]
        : []),
    ];
  } else {
    console.log('Regular seller - using commission-based line items');
    const { providerCommission, customerCommission } =
      commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

    // transactionLineItems is now async (Stripe Tax API)
    lineItems = await transactionLineItems(
      listing,
      getFullOrderData(enrichedOrderData, bodyParams, currency, existingOffers),
      providerCommission,
      customerCommission
    );
  }

  metadataMaybe = getUpdatedMetadata(enrichedOrderData, transitionName, existingMetadata);

  return getTrustedSdk(req);
})
    .then(trustedSdk => {
      const { listingId, ...restParams } = bodyParams?.params || {};

      const deliveryAddressMaybe = enrichedOrderData?.deliveryAddress
        ? { deliveryAddress: enrichedOrderData.deliveryAddress }
        : {};
      const deliveryFeeMaybe = enrichedOrderData?.deliveryFeeInSubunits
        ? { deliveryFeeInSubunits: enrichedOrderData.deliveryFeeInSubunits }
        : {};

      console.log('📦 [transition-privileged] deliveryFeeInSubunits (final):', enrichedOrderData?.deliveryFeeInSubunits);
      console.log('📦 [transition-privileged] deliveryAddress (final):', enrichedOrderData?.deliveryAddress);
      console.log('📦 [transition-privileged] restParams.protectedData:', JSON.stringify(restParams.protectedData));

      const body = {
        ...bodyParams,
        params: {
          ...restParams,
          lineItems,
          protectedData: {
            ...restParams.protectedData,
            ...deliveryAddressMaybe,
            ...deliveryFeeMaybe,
          },
          ...metadataMaybe,
        },
      };

      if (isSpeculative) {
        return trustedSdk.transactions.transitionSpeculative(body, queryParams);
      }
      return trustedSdk.transactions.transition(body, queryParams);
    })
    .then(apiResponse => {
      const { status, statusText, data } = apiResponse;
      res
        .status(status)
        .set('Content-Type', 'application/transit+json')
        .send(
          serialize({
            status,
            statusText,
            data,
          })
        )
        .end();
    })
    .catch(e => {
      handleError(res, e);
    });
};