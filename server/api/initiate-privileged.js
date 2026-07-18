const sharetribeSdk = require('sharetribe-flex-sdk');
const { transactionLineItems, getCautionFeeLineItemMaybe } = require('../api-util/lineItems');
const {
  calculateQuantityFromDates,
  calculateQuantityFromHours,
} = require('../api-util/lineItemHelpers');
const { isIntentionToMakeOffer } = require('../api-util/negotiation');
const {
  isRentalWithDeposit,
  createDepositHold,
  attachTransactionToDeposit,
} = require('../api-util/rentalDeposit');
const {
  getSdk,
  getTrustedSdk,
  handleError,
  serialize,
  fetchCommission,
} = require('../api-util/sdk');

const { Money } = sharetribeSdk.types;

const listingPromise = (sdk, id) => sdk.listings.show({ id, include: ['author'] });

const listingIdRaw = bodyParams => {
  const raw = bodyParams?.params?.listingId;
  if (!raw) return null;
  return typeof raw === 'object' && raw.uuid ? raw.uuid : raw;
};

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
  let depositHold = null;



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

          // ── Main line item ──
          // Rentals (day/night/hour) get a real booking line item with the
          // per-unit price and the booked quantity, NOT a generic
          // line-item/item. This makes multi-day rentals charge price × days,
          // and it is what the transaction emails and order breakdowns key on
          // to render booking dates. Negotiated offers keep line-item/item:
          // the offer amount is the agreed total.
          const manualPublicData = listing.attributes.publicData || {};
          const rentalUnitType = ['day', 'night', 'hour'].includes(manualPublicData.unitType)
            ? manualPublicData.unitType
            : null;
          const {
            bookingStart,
            bookingEnd,
            bookingDisplayStart,
            bookingDisplayEnd,
          } = bodyParams?.params || {};
          // Display dates are the customer's actual rental period; start/end
          // may include a shipping buffer and must not drive pricing.
          const pricingStart = bookingDisplayStart || bookingStart;
          const pricingEnd = bookingDisplayEnd || bookingEnd;
          const isUnitPricedBooking = !offerInSubunits && rentalUnitType && pricingStart && pricingEnd;

          let mainLineItem;
          let orderTotal;
          if (isUnitPricedBooking) {
            const code = `line-item/${rentalUnitType}`;
            const quantity =
              rentalUnitType === 'hour'
                ? calculateQuantityFromHours(new Date(pricingStart), new Date(pricingEnd))
                : calculateQuantityFromDates(new Date(pricingStart), new Date(pricingEnd), code);
            mainLineItem = {
              code,
              unitPrice: new Money(amount, currency),
              quantity,
              includeFor: ['customer', 'provider'],
            };
            orderTotal = Math.round(amount * quantity);
          } else {
            mainLineItem = {
              code: 'line-item/item',
              unitPrice: new Money(amount, currency),
              quantity: 1,
              includeFor: ['customer', 'provider'],
            };
            orderTotal = amount;
          }

          // ── Provider commission (same % as Stripe sellers from Console) ──
          // Calculated on the order total (price × quantity), not the deposit.
          const hasProviderCommission =
            providerCommission?.percentage != null && providerCommission.percentage > 0;

          // Refundable caution fee for rentals — manual sellers are paid via
          // Paystack, which has no auth-only hold, so the deposit is a line
          // item the customer pays upfront. Only added on request-payment
          // transitions so offers/inquiries don't pick it up.
          const cautionFeeLineItems = transitionName?.includes('request-payment')
            ? getCautionFeeLineItemMaybe(listing.attributes.publicData, currency, 'paystack')
            : [];

          lineItems = [
            mainLineItem,
            ...cautionFeeLineItems,
            // Provider commission (negative — deducted from provider payout)
            ...(hasProviderCommission
              ? [
                  {
                    code: 'line-item/provider-commission',
                    unitPrice: new Money(orderTotal, currency),
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

          // Rental deposit: create a manual-capture PI on the platform account.
          // Skipped for Paystack (deposit stays a line item there) and for any
          // non-request-payment transition (e.g. inquiries).
          const isRequestPaymentTransition =
            transitionName === 'transition/request-payment' ||
            transitionName === 'transition/request-payment-after-inquiry';
          if (
            paymentGatewayFromParams !== 'paystack' &&
            isRequestPaymentTransition &&
            !isSpeculative &&
            isRentalWithDeposit(listing)
          ) {
            try {
              depositHold = await createDepositHold({
                listing,
                currency,
                listingId: listingIdRaw(bodyParams),
                customerEmail: bodyParams?.params?.protectedData?.customerEmail,
              });
              console.log('[deposit] hold created:', depositHold.depositPaymentIntentId);
            } catch (err) {
              console.error('[deposit] failed to create hold:', err.message);
              throw err;
            }
          }

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

      // The client_secret is intentionally NOT stored — protectedData is
      // visible to the provider too. The customer fetches the secret from
      // /api/rental-deposit, which authenticates them against the transaction.
      const depositHoldMaybe = depositHold
        ? {
            rentalDeposit: {
              paymentIntentId: depositHold.depositPaymentIntentId,
              amountSubunits: depositHold.depositAmountSubunits,
              currency: depositHold.depositCurrency,
            },
          }
        : {};

      // params.protectedData comes from the browser: never let the caller
      // set or overwrite the deposit reference.
      const { rentalDeposit: _injectedDeposit, ...safeProtectedData } = params.protectedData || {};

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
                ...safeProtectedData,
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
                ...safeProtectedData,
                ...deliveryAddressMaybe,
                ...depositHoldMaybe,
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
      return trustedSdk.transactions.initiate(body, queryParams).then(async apiResponse => {
        // Bind the deposit PI to the transaction that now references it.
        // /api/rental-deposit refuses to serve a PI without this binding.
        if (depositHold) {
          const txId = apiResponse?.data?.data?.id?.uuid;
          if (txId) {
            try {
              await attachTransactionToDeposit(depositHold.depositPaymentIntentId, txId);
            } catch (err) {
              // The transaction exists; don't fail the response. An unbound
              // deposit can't be confirmed, so the accept gate will block the
              // booking — fail-safe, but log loudly.
              console.error(
                `[deposit] FAILED to bind ${depositHold.depositPaymentIntentId} to tx ${txId}:`,
                err.message
              );
            }
          }
        }
        return apiResponse;
      });
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