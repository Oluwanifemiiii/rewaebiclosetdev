const sharetribeSdk = require('sharetribe-flex-sdk');
const { transactionLineItems } = require('../api-util/lineItems');
const { isIntentionToMakeOffer } = require('../api-util/negotiation');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');

const { Money } = sharetribeSdk.types;

const listingPromise = (sdk, id) => sdk.listings.show({ id, include: ['author'] });

const getFullOrderData = (orderData, bodyParams, currency) => {
  const { offerInSubunits } = orderData || {};
  const transitionName = bodyParams.transition;

  return isIntentionToMakeOffer(offerInSubunits, transitionName)
    ? {
        ...orderData,
        ...bodyParams.params,
        currency,
        offer: new Money(offerInSubunits, currency),
      }
    : { ...orderData, ...bodyParams.params };
};

const getMetadata = (orderData, transition) => {
  const { actor, offerInSubunits } = orderData || {};
  const hasActor = ['provider', 'customer'].includes(actor);
  const by = hasActor ? actor : null;

  return isIntentionToMakeOffer(offerInSubunits, transition)
    ? {
        metadata: {
          offers: [
            {
              offerInSubunits,
              by,
              transition,
            },
          ],
        },
      }
    : {};
};

// ✅ Check if the listing author is a manual seller
const isManualSeller = (listingResponse) => {
  const listing = listingResponse?.data?.data;
  const author = listingResponse?.data?.included?.find(
    item => item.type === 'user' && item.id.uuid === listing?.relationships?.author?.data?.id?.uuid
  );
  
  const sellerType = author?.attributes?.profile?.publicData?.sellerType;
  return sellerType === 'manual';
};

module.exports = (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body || {};

  // deliveryFeeInSubunits and deliveryAddress may come via bodyParams.params
  // if the duck didn't put them in orderData correctly
  const deliveryFeeFromParams = bodyParams?.params?.deliveryFeeInSubunits;
  const deliveryAddressFromParams = bodyParams?.params?.deliveryAddress;

  // ── Tax fields: extract customer billing address and payment gateway ──
  const customerAddressFromParams =
    orderData?.customerAddress ||
    bodyParams?.params?.customerAddress ||
    null;
  const paymentGatewayFromParams =
    orderData?.paymentGateway ||
    bodyParams?.params?.paymentGateway ||
    'stripe';

  const enrichedOrderData = {
    ...orderData,
    ...(deliveryFeeFromParams ? { deliveryFeeInSubunits: deliveryFeeFromParams } : {}),
    ...(deliveryAddressFromParams ? { deliveryAddress: deliveryAddressFromParams } : {}),
    // Tax fields
    ...(customerAddressFromParams ? { customerAddress: customerAddressFromParams } : {}),
    paymentGateway: paymentGatewayFromParams,
  };

  console.log('📦 [initiate-privileged] deliveryFeeInSubunits from params:', deliveryFeeFromParams);
  console.log('📦 [initiate-privileged] deliveryAddress from params:', deliveryAddressFromParams);
  console.log('📦 [initiate-privileged] customerAddress for tax:', customerAddressFromParams);
  console.log('📦 [initiate-privileged] paymentGateway:', paymentGatewayFromParams);

  const transitionName = bodyParams.transition;
  const sdk = getSdk(req, res);
  let lineItems = null;
  let metadataMaybe = {};



  listingPromise(sdk, bodyParams?.params?.listingId)
    .then(async showListingResponse => {
      const listing = showListingResponse.data.data;
      const processAlias = bodyParams.processAlias || listing.attributes?.publicData?.transactionProcessAlias;
      const isManual = isManualSeller(showListingResponse);

      console.log('Is manual seller?', isManual);
      console.log('Process alias:', processAlias);

      // ✅ For manual sellers, build line items with commission (same as Stripe sellers)
      if (isManual || processAlias?.includes('manual')) {
        console.log('✅ Manual seller detected - building line items with commission');

        return fetchCommission(sdk).then(fetchAssetsResponse => {
          const commissionAsset = fetchAssetsResponse.data.data[0];
          const currency = orderData.currency || listing.attributes.price?.currency || 'USD';
          const { providerCommission } =
            commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

          metadataMaybe = getMetadata(orderData, transitionName);

          const price = listing.attributes.price;
          const { offerInSubunits } = orderData || {};
          const amount = offerInSubunits || price?.amount || 0;

          // ── Provider commission (same % as Stripe sellers from Console) ──
          const hasProviderCommission =
            providerCommission?.percentage != null && providerCommission.percentage > 0;
          const commissionAmount = hasProviderCommission
            ? Math.round(amount * (providerCommission.percentage / 100))
            : 0;

          lineItems = [
            {
              code: 'line-item/item',
              unitPrice: new Money(amount, currency),
              quantity: 1,
              includeFor: ['customer', 'provider'],
            },
            // Provider commission (negative — deducted from provider payout)
            ...(hasProviderCommission
              ? [
                  {
                    code: 'line-item/provider-commission',
                    unitPrice: new Money(amount, currency),
                    percentage: -providerCommission.percentage,
                    includeFor: ['provider'],
                  },
                ]
              : []),
          ];

          console.log('Manual line items (with commission):', lineItems);
          return getTrustedSdk(req, res);
        });
      } else {
        // ✅ Regular Stripe flow
        console.log('Regular Stripe seller - calculating with commission');

        return Promise.all([
          showListingResponse,
          fetchCommission(sdk)
        ]).then(async ([_, fetchAssetsResponse]) => {
          const commissionAsset = fetchAssetsResponse.data.data[0];
          const currency = orderData.currency || listing.attributes.price?.currency || 'USD';
          const { providerCommission, customerCommission } =
            commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

          // transactionLineItems is now async (Stripe Tax API)
          lineItems = await transactionLineItems(
            listing,
            getFullOrderData(enrichedOrderData, bodyParams, currency),
            providerCommission,
            customerCommission
          );
          metadataMaybe = getMetadata(orderData, transitionName);

          return getTrustedSdk(req);
        });
      }
    })
    .then(trustedSdk => {
      const { params } = bodyParams;
      const processAlias = bodyParams.processAlias;
      const isManual = processAlias?.includes('manual');

      // Normalize listingId
      const listingIdRaw = params?.listingId;
      const listingIdNormalized =
        listingIdRaw && typeof listingIdRaw === 'object' && listingIdRaw.uuid
          ? listingIdRaw.uuid
          : listingIdRaw;

      const deliveryAddressMaybe = enrichedOrderData?.deliveryAddress
        ? { deliveryAddress: enrichedOrderData.deliveryAddress }
        : {};

      console.log('📦 deliveryFeeInSubunits in orderData:', orderData?.deliveryFeeInSubunits);
      console.log('📦 deliveryAddress in orderData:', orderData?.deliveryAddress);
      console.log('📦 deliveryAddress in params.protectedData:', params?.protectedData?.deliveryAddress);

      // ✅ For manual sellers, store line items in protectedData
      const body = isManual
        ? {
            ...bodyParams,
            params: {
              ...params,
              listingId: listingIdNormalized,
              protectedData: {
                ...params.protectedData,
                ...deliveryAddressMaybe,
                lineItems: normalizeLineItems(lineItems),
                paymentMethod: 'paystack',
                sellerType: 'manual',
              },
              ...metadataMaybe,
            },
          }
        : {
            ...bodyParams,
            params: {
              ...params,
              listingId: listingIdNormalized,
              lineItems: normalizeLineItems(lineItems),
              protectedData: {
                ...params.protectedData,
                ...deliveryAddressMaybe,
              },
              ...metadataMaybe,
            },
          };

      console.log('Final body.params:', {
        listingId: body.params.listingId,
        hasLineItems: !!body.params.lineItems,
        hasProtectedData: !!body.params.protectedData,
        protectedDataKeys: body.params.protectedData ? Object.keys(body.params.protectedData) : [],
      });

      if (isSpeculative) {
        return trustedSdk.transactions.initiateSpeculative(body, queryParams);
      }
      return trustedSdk.transactions.initiate(body, queryParams);
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
      console.error('❌ Initiate privileged error:', e.data || e.message);
      if (e.data?.errors) {
        console.error('API errors:', JSON.stringify(e.data.errors, null, 2));
      }
      console.log('═══════════════════════════\n');

      handleError(res, e);
    });
};

// ✅ Helper to normalize line items to plain objects
function normalizeLineItems(lineItems) {
  if (!lineItems) return [];

  return lineItems.map(li => {
    const normalized = { ...li };

    if (normalized.unitPrice) {
      if (typeof normalized.unitPrice === 'object' && normalized.unitPrice.amount) {
        normalized.unitPrice = {
          amount: Number(normalized.unitPrice.amount),
          currency: normalized.unitPrice.currency,
        };
      }
    }

    if (normalized.quantity != null) {
      normalized.quantity = Number(normalized.quantity);
    }

    if (normalized.percentage != null) {
      normalized.percentage = Number(normalized.percentage);
    }

    return normalized;
  });
}
