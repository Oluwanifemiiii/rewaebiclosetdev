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

const listingPromise = (sdk, id) => sdk.listings.show({ id });

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
  // NOTE: for now, the actor is always "provider".
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

module.exports = (req, res) => {
  const { isSpeculative, orderData, bodyParams, queryParams } = req.body || {};
  const transitionName = bodyParams.transition;
  const sdk = getSdk(req, res);
  let lineItems = null;
  let metadataMaybe = {};

  Promise.all([listingPromise(sdk, bodyParams?.params?.listingId), fetchCommission(sdk)])
    .then(([showListingResponse, fetchAssetsResponse]) => {
      const listing = showListingResponse.data.data;
      const commissionAsset = fetchAssetsResponse.data.data[0];

      const currency = listing.attributes.price?.currency || orderData.currency;
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
    })
    .then(trustedSdk => {
      const { params } = bodyParams;

      // Ensure listingId is a plain UUID string when present. Some clients
      // pass SDK UUID objects ({ _sdkType: 'UUID', uuid: '...' }) which may
      // not be accepted by Marketplace API validation. Convert to uuid string
      // when possible.
      const listingIdRaw = params?.listingId;
      const listingIdNormalized =
        listingIdRaw && typeof listingIdRaw === 'object' && listingIdRaw.uuid
          ? listingIdRaw.uuid
          : listingIdRaw;

      // Add lineItems to the body params
      const body = {
        ...bodyParams,
        params: {
          ...params,
          listingId: listingIdNormalized,
          lineItems,
          ...metadataMaybe,
        },
      };

      // Debug: in development, log a JSON-friendly version of the body to help
      // diagnose Marketplace API validation errors (e.g. missing keys)
      try {
        if (process.env.NODE_ENV === 'development') {
          const mapUnitPrice = up => {
            if (!up) return up;
            // If it's an object with amount & currency, return those
            if (Object.prototype.hasOwnProperty.call(up, 'amount')) {
              return { amount: up.amount, currency: up.currency };
            }
            // Fallback: return as-is
            return up;
          };

          const debugLineItems = (lineItems || []).map(li => ({
            ...li,
            unitPrice: mapUnitPrice(li.unitPrice),
          }));

          console.log(
            'initiate-privileged: body.params (debug):',
            JSON.stringify(
              {
                ...body.params,
                lineItems: debugLineItems,
              },
              null,
              2
            )
          );
        }
      } catch (e) {
        // Don't allow logging to crash the request
        console.error('initiate-privileged: failed to stringify debug body', e);
      }
      // Normalize lineItems to plain JS objects expected by Marketplace API
      const normalizeUnitPrice = up => {
        if (!up) return up;
        // If SDK Money instance
        if (up && typeof up === 'object' && typeof up.amount === 'number' && up.currency) {
          return { amount: up.amount, currency: up.currency };
        }
        // If Money-like object with toNumber or amount property
        if (up && typeof up === 'object') {
          // Try common numeric accessors
          if (typeof up.toNumber === 'function') {
            try {
              return { amount: up.toNumber(), currency: up.currency };
            } catch (e) {
              // fallthrough
            }
          }
          if (up.amount != null && up.currency) {
            return { amount: Number(up.amount), currency: up.currency };
          }
        }
        return up;
      };

      const normalizeQuantity = q => {
        if (q == null) return q;
        if (typeof q === 'number') return q;
        if (typeof q === 'object' && typeof q.toNumber === 'function') {
          try {
            return q.toNumber();
          } catch (e) {
            return Number(q);
          }
        }
        return Number(q);
      };

      const normalizedLineItems = (body.params.lineItems || []).map(li => {
        return {
          ...li,
          unitPrice: normalizeUnitPrice(li.unitPrice),
          // ensure quantity/percentage are primitive numbers where applicable
          quantity: normalizeQuantity(li.quantity),
          percentage:
            li.percentage != null &&
            typeof li.percentage === 'object' &&
            typeof li.percentage.toNumber === 'function'
              ? li.percentage.toNumber()
              : li.percentage,
        };
      });

      // Replace lineItems in body with normalized version
      body.params = { ...body.params, lineItems: normalizedLineItems };

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
      // In development, log Marketplace API validation errors to help debugging.
      try {
        if (process.env.NODE_ENV === 'development' && e && e.data && Array.isArray(e.data.errors)) {
          console.error('initiate-privileged: Marketplace API errors:', JSON.stringify(e.data.errors, null, 2));
        }
      } catch (logErr) {
        // ignore logging errors
      }

      handleError(res, e);
    });
};
