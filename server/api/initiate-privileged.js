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
  const transitionName = bodyParams.transition;
  const sdk = getSdk(req, res);
  let lineItems = null;
  let metadataMaybe = {};



  listingPromise(sdk, bodyParams?.params?.listingId)
    .then(showListingResponse => {
      const listing = showListingResponse.data.data;
      const processAlias = bodyParams.processAlias || listing.attributes?.publicData?.transactionProcessAlias;
      const isManual = isManualSeller(showListingResponse);

      console.log('Is manual seller?', isManual);
      console.log('Process alias:', processAlias);

      // ✅ For manual sellers, skip commission fetch and line item calculation
      if (isManual || processAlias?.includes('manual')) {
        console.log('✅ Manual seller detected - skipping Stripe line items');

                // Line 99 area:
        const currency = orderData.currency || listing.attributes.price?.currency || 'USD';
                metadataMaybe = getMetadata(orderData, transitionName);

        // ✅ Calculate simple line items without Stripe fees
        // These will be stored in protectedData, not passed to API
        const price = listing.attributes.price;
        const { offerInSubunits } = orderData || {};
        
        // Use offer amount if this is a negotiation, otherwise use listing price
        const amount = offerInSubunits || price?.amount || 0;
        
        lineItems = [
          {
            code: 'line-item/item',
            unitPrice: new Money(amount, currency),
            quantity: 1,
            includeFor: ['customer', 'provider'],
          },
        ];

        console.log('Manual line items:', lineItems);

        return getTrustedSdk(req);
      } else {
        // ✅ Regular Stripe flow
        console.log('Regular Stripe seller - calculating with commission');

        return Promise.all([
          showListingResponse,
          fetchCommission(sdk)
        ]).then(([_, fetchAssetsResponse]) => {
          const commissionAsset = fetchAssetsResponse.data.data[0];
          // Line 99 area:
          const currency = orderData.currency || listing.attributes.price?.currency || 'USD';
          const { providerCommission, customerCommission } =
            commissionAsset?.type === 'jsonAsset' ? commissionAsset.attributes.data : {};

          lineItems = transactionLineItems(
            listing,
            getFullOrderData(orderData, bodyParams, currency),
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

      // ✅ For manual sellers, store line items in protectedData
      // This bypasses Stripe validation
      const body = isManual
        ? {
            ...bodyParams,
            params: {
              ...params,
              listingId: listingIdNormalized,
              // ❌ DON'T pass lineItems to API (triggers Stripe validation)
              // ✅ Store in protectedData instead
              protectedData: {
                ...params.protectedData,
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

    // Normalize unitPrice
    if (normalized.unitPrice) {
      if (typeof normalized.unitPrice === 'object' && normalized.unitPrice.amount) {
        normalized.unitPrice = {
          amount: Number(normalized.unitPrice.amount),
          currency: normalized.unitPrice.currency,
        };
      }
    }

    // Normalize quantity
    if (normalized.quantity != null) {
      normalized.quantity = Number(normalized.quantity);
    }

    // Normalize percentage
    if (normalized.percentage != null) {
      normalized.percentage = Number(normalized.percentage);
    }

    return normalized;
  });
}