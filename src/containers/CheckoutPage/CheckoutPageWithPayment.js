import React, { useState } from 'react';

// Import contexts and util modules
import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { pathByRouteName } from '../../util/routes';
import { isValidCurrencyForTransactionProcess } from '../../util/fieldHelpers.js';
import { propTypes } from '../../util/types';
import { ensureTransaction } from '../../util/data';
import { createSlug } from '../../util/urlHelpers';
import { isTransactionInitiateListingNotFoundError } from '../../util/errors';
import {
  getProcess,
  isBookingProcessAlias,
  resolveLatestProcessName,
  BOOKING_PROCESS_NAME,
  NEGOTIATION_PROCESS_NAME,
  PURCHASE_PROCESS_NAME,
} from '../../transactions/transaction';
import { setInitialValues } from '../../containers/TransactionPage/TransactionPage.duck';
// Import shared components
import { H3, H4, NamedLink, OrderBreakdown, Page, TopbarSimplified } from '../../components';

import {
  bookingDatesMaybe,
  getBillingDetails,
  getFormattedTotalPrice,
  getShippingDetailsMaybe,
  getTransactionTypeData,
  hasDefaultPaymentMethod,
  hasPaymentExpired,
  hasTransactionPassedPendingPayment,
  processCheckoutWithPayment,
  setOrderPageInitialValues,
} from './CheckoutPageTransactionHelpers.js';
import { getErrorMessages } from './ErrorMessages';

import StripePaymentForm from './StripePaymentForm/StripePaymentForm';
import DetailsSideCard from './DetailsSideCard';
import MobileListingImage from './MobileListingImage';
import MobileOrderBreakdown from './MobileOrderBreakdown';
import { IconSpinner } from '../../components';
import css from './CheckoutPage.module.css';

// Stripe PaymentIntent statuses, where user actions are already completed
// https://stripe.com/docs/payments/payment-intents/status
const STRIPE_PI_USER_ACTIONS_DONE_STATUSES = ['processing', 'requires_capture', 'succeeded'];

// Payment charge options
const ONETIME_PAYMENT = 'ONETIME_PAYMENT';
const PAY_AND_SAVE_FOR_LATER_USE = 'PAY_AND_SAVE_FOR_LATER_USE';
const USE_SAVED_CARD = 'USE_SAVED_CARD';

const paymentFlow = (selectedPaymentMethod, saveAfterOnetimePayment) => {
  // Payment mode could be 'replaceCard', but without explicit saveAfterOnetimePayment flag,
  // we'll handle it as one-time payment
  return selectedPaymentMethod === 'defaultCard'
    ? USE_SAVED_CARD
    : saveAfterOnetimePayment
    ? PAY_AND_SAVE_FOR_LATER_USE
    : ONETIME_PAYMENT;
};

const capitalizeString = s => `${s.charAt(0).toUpperCase()}${s.substr(1)}`;

/**
 * Prefix the properties of the chosen price variant as first level properties for the protected data of the transaction
 *
 * @example
 * const priceVariant = {
 *   name: 'something',
 * }
 *
 * will be returned as:
 * const priceVariant = {
 *   priceVariantName: 'something',
 * }
 *
 * @param {Object} priceVariant - The price variant object
 * @returns {Object} The price variant object with the properties prefixed with priceVariant*
 */
const prefixPriceVariantProperties = priceVariant => {
  if (!priceVariant) {
    return {};
  }

  const entries = Object.entries(priceVariant).map(([key, value]) => {
    return [`priceVariant${capitalizeString(key)}`, value];
  });
  return Object.fromEntries(entries);
};

/**
 * Construct orderParams object using pageData from session storage, shipping details, and optional payment params.
 * Note: This is used for both speculate transition and real transition
 *       - Speculate transition is called, when the the component is mounted. It's used to test if the data can go through the API validation
 *       - Real transition is made, when the user submits the StripePaymentForm.
 *
 * @param {Object} pageData data that's saved to session storage.
 * @param {Object} shippingDetails shipping address if applicable.
 * @param {Object} optionalPaymentParams (E.g. paymentMethod or setupPaymentMethodForSaving)
 * @param {Object} config app-wide configs. This contains hosted configs too.
 * @returns orderParams.
 */
const getOrderParams = (pageData, shippingDetails, optionalPaymentParams, config) => {
  const quantity = pageData.orderData?.quantity;
  const quantityMaybe = quantity ? { quantity } : {};
  const seats = pageData.orderData?.seats;
  const seatsMaybe = seats ? { seats } : {};
  const deliveryMethod = pageData.orderData?.deliveryMethod;
  const deliveryMethodMaybe = deliveryMethod ? { deliveryMethod } : {};
  const { listingType, unitType, priceVariants } = pageData?.listing?.attributes?.publicData || {};

  // price variant data for fixed duration bookings
  const priceVariantName = pageData.orderData?.priceVariantName;
  const priceVariantNameMaybe = priceVariantName ? { priceVariantName } : {};
  const priceVariant = priceVariants?.find(pv => pv.name === priceVariantName);
  const priceVariantMaybe = priceVariant ? prefixPriceVariantProperties(priceVariant) : {};

  const protectedDataMaybe = {
    protectedData: {
      ...getTransactionTypeData(listingType, unitType, config),
      ...deliveryMethodMaybe,
      ...shippingDetails,
      ...priceVariantMaybe,
    },
  };

  // Note: Avoid misinterpreting the following logic as allowing arbitrary mixing of `quantity` and `seats`.
  // You can only pass either quantity OR seats and units to the orderParams object
  // Quantity represents the total booked units for the line item (e.g. days, hours).
  // When quantity is not passed, we pass seats and units.
  // If `bookingDatesMaybe` is provided, it determines `units`, and `seats` defaults to 1
  // (implying quantity = units)

  // These are the order parameters for the first payment-related transition
  // which is either initiate-transition or initiate-transition-after-enquiry
  const orderParams = {
    listingId: pageData?.listing?.id,
    ...deliveryMethodMaybe,
    ...quantityMaybe,
    ...seatsMaybe,
    ...bookingDatesMaybe(pageData.orderData?.bookingDates),
    ...priceVariantNameMaybe,
    ...protectedDataMaybe,
    ...optionalPaymentParams,
  };
  return orderParams;
};

const fetchSpeculatedTransactionIfNeeded = (orderParams, pageData, fetchSpeculatedTransaction) => {
  const tx = pageData ? pageData.transaction : null;
  const pageDataListing = pageData.listing;
  const processName =
    tx?.attributes?.processName ||
    pageDataListing?.attributes?.publicData?.transactionProcessAlias?.split('/')[0];
  const process = processName ? getProcess(processName) : null;

  // If transaction has passed payment-pending state, speculated tx is not needed.
  const shouldFetchSpeculatedTransaction =
    !!pageData?.listing?.id &&
    !!pageData.orderData &&
    !!process &&
    !hasTransactionPassedPendingPayment(tx, process);

  if (shouldFetchSpeculatedTransaction) {
    const processAlias = pageData.listing.attributes.publicData?.transactionProcessAlias;
    const transactionId = tx ? tx.id : null;
    const isInquiryInPaymentProcess =
      tx?.attributes?.lastTransition === process.transitions.INQUIRE;
    const resolvedProcessName = resolveLatestProcessName(processName);
    const isOfferPendingInNegotiationProcess =
      resolvedProcessName === NEGOTIATION_PROCESS_NAME &&
      tx.attributes.state === `state/${process.states.OFFER_PENDING}`;

    const requestTransition = isInquiryInPaymentProcess
      ? process.transitions.REQUEST_PAYMENT_AFTER_INQUIRY
      : isOfferPendingInNegotiationProcess
      ? process.transitions.REQUEST_PAYMENT_TO_ACCEPT_OFFER
      : process.transitions.REQUEST_PAYMENT;
    const isPrivileged = process.isPrivileged(requestTransition);

    fetchSpeculatedTransaction(
      orderParams,
      processAlias,
      transactionId,
      requestTransition,
      isPrivileged
    );
  }
};

/**
 * Load initial data for the page
 *
 * Since the data for the checkout is not passed in the URL (there
 * might be lots of options in the future), we must pass in the data
 * some other way. Currently the ListingPage sets the initial data
 * for the CheckoutPage's Redux store.
 *
 * For some cases (e.g. a refresh in the CheckoutPage), the Redux
 * store is empty. To handle that case, we store the received data
 * to window.sessionStorage and read it from there if no props from
 * the store exist.
 *
 * This function also sets of fetching the speculative transaction
 * based on this initial data.
 */
export const loadInitialDataForStripePayments = ({
  pageData,
  fetchSpeculatedTransaction,
  fetchStripeCustomer,
  config,
}) => {
  // Fetch currentUser with stripeCustomer entity
  fetchStripeCustomer();

  // ✅ Check if seller is manual
  const author = pageData?.listing?.author;
  const sellerType = author?.attributes?.profile?.publicData?.sellerType;
  const isManualSeller = sellerType === 'manual';


  if (!isManualSeller) {
    // ✅ Regular Stripe flow - fetch speculated transaction
    const shippingDetails = {};
    const optionalPaymentParams = {};
    const orderParams = getOrderParams(pageData, shippingDetails, optionalPaymentParams, config);
    fetchSpeculatedTransactionIfNeeded(orderParams, pageData, fetchSpeculatedTransaction);
  } else {
    // ✅ Manual seller - create a client-side speculated transaction for display purposes
    console.log('✅ Manual seller - creating client-side speculated transaction');
    
    const listing = pageData?.listing;
    const bookingDates = pageData?.orderData?.bookingDates;
    
    if (!bookingDates || !listing) {
      console.log('No booking dates or listing - skipping speculation');
      return;
    }

    // Calculate the number of units (days/nights/hours)
    const unitType = listing.attributes.publicData?.unitType;
    const price = listing.attributes.price;
    
    if (!price || !unitType) {
      console.log('No price or unitType - skipping');
      return;
    }

    const start = new Date(bookingDates.bookingStart);
    const end = new Date(bookingDates.bookingEnd);
    
    let quantity = 1;
    if (unitType === 'day') {
      quantity = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
    } else if (unitType === 'night') {
      quantity = Math.floor((end - start) / (1000 * 60 * 60 * 24));
    } else if (unitType === 'hour') {
      quantity = Math.ceil((end - start) / (1000 * 60 * 60));
    }

    console.log('Booking calculation:', {
      unitType,
      start,
      end,
      quantity,
      pricePerUnit: price.amount,
    });

    // ✅ Create a fake speculated transaction for display
    // This won't be sent to Stripe - it's just for showing the breakdown
    const lineTotal = price.amount * quantity;
    
    const fakeSpeculatedTransaction = {
      id: { uuid: 'client-side-speculate' },
      type: 'transaction',
      attributes: {
        lineItems: [
          {
            code: `line-item/${unitType}`,
            unitPrice: { amount: price.amount, currency: 'NGN' },
            quantity: quantity,
            lineTotal: { amount: lineTotal, currency: 'NGN' },
            includeFor: ['customer', 'provider'],
            reversal: false,
          },
        ],
        payinTotal: { amount: lineTotal, currency: 'NGN' },
        payoutTotal: { amount: lineTotal, currency: 'NGN' },
      },
    };

    
    if (pageData) {
      pageData.speculatedTransaction = fakeSpeculatedTransaction;
    }
  }

};
const onStripeInitialized = (stripe, process, props) => {
  const { paymentIntent, onRetrievePaymentIntent, pageData } = props;
  const tx = pageData?.transaction || null;

  // We need to get up to date PI, if payment is pending but it's not expired.
  const shouldFetchPaymentIntent =
    stripe &&
    !paymentIntent &&
    tx?.id &&
    process?.getState(tx) === process?.states.PENDING_PAYMENT &&
    !hasPaymentExpired(tx, process);

  if (shouldFetchPaymentIntent) {
    const { stripePaymentIntentClientSecret } =
      tx.attributes.protectedData?.stripePaymentIntents?.default || {};

    // Fetch up to date PaymentIntent from Stripe
    onRetrievePaymentIntent({ stripe, stripePaymentIntentClientSecret });
  }
};

/**
 * A component that renders the checkout page with payment.
 *
 * @component
 * @param {Object} props
 * @param {boolean} props.scrollingDisabled - Whether the page should scroll
 * @param {string} props.speculateTransactionError - The error message for the speculate transaction
 * @param {propTypes.transaction} props.speculatedTransaction - The speculated transaction
 * @param {boolean} props.isClockInSync - Whether the clock is in sync
 * @param {string} props.initiateOrderError - The error message for the initiate order
 * @param {string} props.confirmPaymentError - The error message for the confirm payment
 * @param {intlShape} props.intl - The intl object
 * @param {propTypes.currentUser} props.currentUser - The current user
 * @param {string} props.confirmCardPaymentError - The error message for the confirm card payment
 * @param {propTypes.paymentIntent} props.paymentIntent - The Stripe's payment intent
 * @param {boolean} props.stripeCustomerFetched - Whether the stripe customer has been fetched
 * @param {Object} props.pageData - The page data
 * @param {propTypes.listing} props.pageData.listing - The listing entity
 * @param {boolean} props.showListingImage - A boolean indicating whether images are enabled with this listing type
 * @param {propTypes.transaction} props.pageData.transaction - The transaction entity
 * @param {Object} props.pageData.orderData - The order data
 * @param {string} props.processName - The process name
 * @param {string} props.listingTitle - The listing title
 * @param {string} props.title - The title
 * @param {Function} props.onInitiateOrder - The function to initiate the order
 * @param {Function} props.onConfirmCardPayment - The function to confirm the card payment
 * @param {Function} props.onConfirmPayment - The function to confirm the payment after Stripe call is made
 * @param {Function} props.onSendMessage - The function to send a message
 * @param {Function} props.onSavePaymentMethod - The function to save the payment method for later use
 * @param {Function} props.onSubmitCallback - The function to submit the callback
 * @param {propTypes.error} props.initiateOrderError - The error message for the initiate order
 * @param {propTypes.error} props.confirmPaymentError - The error message for the confirm payment
 * @param {propTypes.error} props.confirmCardPaymentError - The error message for the confirm card payment
 * @param {propTypes.paymentIntent} props.paymentIntent - The Stripe's payment intent
 * @param {boolean} props.stripeCustomerFetched - Whether the stripe customer has been fetched
 * @param {Object} props.config - The config
 * @param {Object} props.routeConfiguration - The route configuration
 * @param {Object} props.history - The history object
 * @param {Object} props.history.push - The push state function of the history object
 * @returns {JSX.Element}
 */
export const CheckoutPageWithPayment = props => {
  const [submitting, setSubmitting] = useState(false);
  const [stripe, setStripe] = useState(null);
  const [paystackProcessing, setPaystackProcessing] = useState(false);
  const {
    scrollingDisabled,
    speculateTransactionError,
    speculatedTransaction: speculatedTransactionMaybe,
    isClockInSync,
    initiateOrderError,
    confirmPaymentError,
    intl,
    currentUser,
    confirmCardPaymentError,
    showListingImage,
    paymentIntent,
    retrievePaymentIntentError,
    stripeCustomerFetched,
    pageData,
    setPageData, // ✅ ADD THIS
    processName,
    listingTitle,
    title,
    config,
  } = props;

  const handleSubmit = values => {
    if (submitting) return;
    setSubmitting(true);

    const process = getProcess(processName);

    const {
      history,
      routeConfiguration,
      speculatedTransaction,
      currentUser,
      paymentIntent,
      onInitiateOrder,
      onConfirmCardPayment,
      onConfirmPayment,
      onSendMessage,
      onSavePaymentMethod,
      onSubmitCallback,
    } = props;

    const { card, message, paymentMethod: selectedPaymentMethod, formValues } = values;

    const saveAfterOnetimePayment =
      Array.isArray(formValues?.saveAfterOnetimePayment) &&
      formValues.saveAfterOnetimePayment.length > 0;

    const selectedPaymentFlow = paymentFlow(selectedPaymentMethod, saveAfterOnetimePayment);

    const hasDefaultSavedMethod = hasDefaultPaymentMethod(stripeCustomerFetched, currentUser);

    const stripePaymentMethodId = hasDefaultSavedMethod
      ? currentUser?.stripeCustomer?.defaultPaymentMethod?.attributes?.stripePaymentMethodId
      : null;

    const shippingDetails = getShippingDetailsMaybe(formValues);

    let optionalPaymentParams = {};

    if (selectedPaymentFlow === 'USE_SAVED_CARD' && hasDefaultSavedMethod) {
      optionalPaymentParams = { paymentMethod: stripePaymentMethodId };
    } else if (selectedPaymentFlow === 'PAY_AND_SAVE_FOR_LATER_USE') {
      optionalPaymentParams = { setupPaymentMethodForSaving: true };
    }

    const orderParams = getOrderParams(pageData, shippingDetails, optionalPaymentParams, config);

    if (pageData?.orderData?.paymentMethod === 'paystack') {
      orderParams.transactionProcessAlias = 'paystack-purchase/release-1';
    }

    const requestPaymentParams = {
      pageData,
      speculatedTransaction,
      stripe,
      card,
      billingDetails: getBillingDetails(formValues, currentUser),
      message,
      paymentIntent,
      stripePaymentMethodId,
      process,
      onInitiateOrder,
      onConfirmCardPayment,
      onConfirmPayment,
      onSendMessage,
      onSavePaymentMethod,
      sessionStorageKey: props.sessionStorageKey,
      stripeCustomer: currentUser?.stripeCustomer,
      isPaymentFlowUseSavedCard: selectedPaymentFlow === 'USE_SAVED_CARD',
      isPaymentFlowPayAndSaveCard: selectedPaymentFlow === 'PAY_AND_SAVE_FOR_LATER_USE',
      setPageData,
    };

    processCheckoutWithPayment(orderParams, requestPaymentParams)
      .then(res => {
        setSubmitting(false);
        const { orderId } = res;

        const orderDetailsPath = pathByRouteName('OrderDetailsPage', routeConfiguration, {
          id: orderId.uuid,
        });

        onSubmitCallback && onSubmitCallback();
        history.push(orderDetailsPath);
      })
      .catch(err => {
        console.error(err);
        setSubmitting(false);
      });
  };

 const USD_TO_NGN_RATE = 1490;

/**
 * Calculate the correct Paystack amount based on seller type
 * 
 * @param {Object} listing - The listing object with author information
 * @param {Object} transaction - Optional transaction object (for negotiations with line items)
 * @returns {number|null} - Amount in kobo (NGN subunits) or null if calculation fails
 */
const getPaystackAmountFromListing = (listing, transaction = null) => {
  if (!listing) return null;  
  const publicData = listing.attributes?.publicData || {};
  const listingType = publicData.listingType;
  
  // ✅ Check if seller is Nigerian (manual seller)
  const author = listing?.author;
  const sellerType = author?.attributes?.profile?.publicData?.sellerType;
  const isManualSeller = sellerType === 'manual';
  
  
  // ✅ 0) For negotiations, check transaction line items first (this is the agreed price)
  if (transaction?.attributes?.lineItems) {
    const lineItems = transaction.attributes.lineItems;
    const lineTotal = lineItems?.[0]?.lineTotal;
    
    console.log('Transaction has line items - using agreed price from negotiation');
    console.log('Line total:', lineTotal);
    
    if (lineTotal && typeof lineTotal.amount === 'number') {
      const amount = lineTotal.amount;
      const currency = lineTotal.currency;
      
      console.log('Line total amount:', amount);
      console.log('Line total currency:', currency);
      
      if (isManualSeller) {
        // Nigerian seller - amount is already in NGN (kobo)
        console.log('✅ Manual seller - line total is in NGN');
        console.log('   Amount:', amount / 100, 'NGN');
        console.log('   In kobo:', amount);
        console.log('========================================');
        return amount;
      } else {
        // International seller - convert from USD to NGN
        if (currency === 'USD') {
          const usdCents = amount;
          const usdWhole = usdCents / 100;
          const ngn = usdWhole * USD_TO_NGN_RATE;
          const kobo = Math.round(ngn * 100);
          console.log('💵 International seller - converting line total');
          console.log('   From:', usdWhole, 'USD');
          console.log('   To:', ngn, 'NGN (', kobo, 'kobo)');
          console.log('========================================');
          return kobo;
        } else if (currency === 'NGN') {
          console.log('✅ Line total already in NGN:', amount, 'kobo');
          console.log('========================================');
          return amount;
        }
      }
    }
  }
  
  // ✅ 1) Check for explicit Paystack price in NGN (highest priority)
  if (publicData.paystackPriceNgn) {
    const maybe = Number(publicData.paystackPriceNgn);
    if (!Number.isNaN(maybe) && isFinite(maybe) && maybe > 0) {
      console.log('✅ Using paystackPriceNgn:', maybe, 'NGN');
      const kobo = Math.round(maybe * 100);
      console.log('Amount in kobo:', kobo);
      console.log('========================================');
      return kobo;
    }
  }

  // ✅ 2) Use the standard price field
  const price = listing.attributes?.price;
  if (price && typeof price.amount === 'number') {
    const priceCents = price.amount;
    const priceWhole = priceCents / 100;
    const priceCurrency = price.currency;
    
    console.log('---');
    console.log('Price object found:');
    console.log('  - Amount (in subunits):', priceCents);
    console.log('  - Amount (whole):', priceWhole);
    console.log('  - Currency:', priceCurrency);
    console.log('---');
    
    if (!Number.isNaN(priceWhole) && isFinite(priceWhole) && priceWhole > 0) {
      if (isManualSeller) {
        // ✅ Nigerian seller - price is ALREADY in NGN, no conversion needed!
        console.log('✅ Nigerian seller detected!');
        console.log('✅ Price is ALREADY in NGN - NO CONVERSION');
        console.log('   Price entered by seller:', priceWhole, 'NGN');
        console.log('   Stored as:', priceCents, 'kobo (subunits)');
        console.log('   Sending to Paystack:', priceCents, 'kobo');
        console.log('========================================');
        return priceCents; // Already in kobo (NGN subunits)
      } else {
        // ✅ International seller - price is in USD, convert to NGN
        console.log('💵 International seller detected!');
        console.log('💵 Price is in USD - CONVERTING to NGN');
        console.log('   Price in USD:', priceWhole, 'USD');
        const ngn = priceWhole * USD_TO_NGN_RATE;
        const kobo = Math.round(ngn * 100);
        console.log('   Converted to NGN:', ngn, 'NGN');
        console.log('   In kobo:', kobo, 'kobo');
        console.log('   Sending to Paystack:', kobo, 'kobo');
        console.log('========================================');
        return kobo;
      }
    }
  }

  // ✅ 3) Fallback: Try publicData.value (for older listings)
  if (publicData.value) {
    const value = Number(publicData.value);
    console.log('---');
    console.log('Fallback: Using publicData.value:', value);
    console.log('---');
    
    if (!Number.isNaN(value) && isFinite(value) && value > 0) {
      if (isManualSeller) {
        // Nigerian seller - value is in NGN
        console.log('✅ Nigerian seller - value is in NGN:', value, 'NGN');
        const kobo = Math.round(value * 100);
        console.log('Amount in kobo:', kobo);
        console.log('========================================');
        return kobo;
      } else {
        // International seller - value is in USD
        console.log('💵 International seller - value is in USD:', value, 'USD');
        const ngnValue = value * USD_TO_NGN_RATE;
        const kobo = Math.round(ngnValue * 100);
        console.log('Converted to NGN:', ngnValue, 'NGN (', kobo, 'kobo)');
        console.log('========================================');
        return kobo;
      }
    }
  }

  return null;
};

  const handlePaystackPayment = async () => {
  if (paystackProcessing) return;

  try {
    if (!currentUser || !currentUser.id) {
      alert('Please log in to complete your purchase.');
      return;
    }

    const existingTransaction = pageData?.transaction;
    let transactionId = existingTransaction?.id?.uuid;
    const isAcceptingOffer = transactionId && existingTransaction.attributes?.lastTransition;
    const isRetryingPayment =
      existingTransaction?.attributes?.lastTransition === 'transition/request-payment-paystack';
    const speculatedTransaction = speculatedTransactionMaybe || pageData?.speculatedTransaction;
    let amountInKobo;
    let paystackRef;

    if (isRetryingPayment) {
      // RETRY SCENARIO
      console.log('Retrying incomplete Paystack payment');
      paystackRef = existingTransaction.attributes.protectedData.paystackReference;
      amountInKobo = existingTransaction.attributes.protectedData.paystackAmount;

      if (!paystackRef || !amountInKobo) {
        alert('Payment information missing. Please start a new order.');
        return;
      }
    } else if (isAcceptingOffer) {
      // ACCEPTING OFFER
      paystackRef = `REWA-${Date.now()}`;

      // ✅ Use the smart detection function instead of manual conversion
      const listing = pageData?.listing;
      amountInKobo = getPaystackAmountFromListing(listing, existingTransaction);

      if (!amountInKobo || amountInKobo <= 0) {
        alert('Could not calculate payment amount');
        return;
      }

      console.log(
        '✅ Amount for accepting offer:',
        amountInKobo,
        'kobo (₦' + amountInKobo / 100 + ')'
      );

      try {
        const response = await fetch('/api/transition-to-paystack-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            transactionId,
            paystackReference: paystackRef,
            amount: amountInKobo,
          }),
        });

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.message || 'Failed to prepare payment');
        }
      } catch (err) {
        console.error('Failed to prepare payment:', err);
        alert('Failed to prepare payment: ' + err.message);
        return;
      }
    } else {
      // NEW PURCHASE/BOOKING
      paystackRef = `REWA-${Date.now()}`;
      const listing = pageData?.listing;
      if (!listing) {
        alert('Listing data missing. Refresh and try again.');
        return;
      }

      // ✅ For bookings, ALWAYS use speculated transaction line items (includes date calculation)
      if (speculatedTransaction?.attributes?.lineItems) {
        const lineItems = speculatedTransaction.attributes.lineItems;
        console.log('All line items:', lineItems);

        const mainLineItem = lineItems.find(
          item => item.code.startsWith('line-item/') && !item.reversal
        );

        console.log('Main line item:', mainLineItem);

        if (mainLineItem?.lineTotal) {
          // ✅ Check if seller is manual to determine if conversion is needed
          const author = listing?.author;
          const sellerType = author?.attributes?.profile?.publicData?.sellerType;
          const isManualSeller = sellerType === 'manual';
          
          const lineTotalAmount = mainLineItem.lineTotal.amount;
          const lineTotalCurrency = mainLineItem.lineTotal.currency;
          
          if (isManualSeller) {
            // ✅ Manual seller - amount is ALREADY in NGN (kobo)
            amountInKobo = lineTotalAmount;
            console.log('✅ Manual seller - using line total as-is (NGN):', amountInKobo, 'kobo (₦' + (amountInKobo/100) + ')');
          } else {
            // ✅ International seller - convert from USD to NGN
            if (lineTotalCurrency === 'USD') {
              const usdCents = lineTotalAmount;
              const usdWhole = usdCents / 100;
              const ngn = usdWhole * 1490;
              amountInKobo = Math.round(ngn * 100);
              console.log('💵 International seller - converting:', usdWhole, 'USD →', ngn, 'NGN (', amountInKobo, 'kobo)');
            } else if (lineTotalCurrency === 'NGN') {
              amountInKobo = lineTotalAmount;
              console.log('✅ Already in NGN:', amountInKobo, 'kobo');
            } else {
              alert('Unsupported currency: ' + lineTotalCurrency);
              return;
            }
          }
          
          console.log('Final amount for Paystack:', amountInKobo, 'kobo (₦' + (amountInKobo/100) + ')');
        } else {
          alert('Could not calculate booking price');
          return;
        }
      } else {
        // ✅ Fallback for non-bookings (purchases)
        console.log('No speculated transaction, using listing price');
        amountInKobo = getPaystackAmountFromListing(listing);
      }

      if (!amountInKobo || amountInKobo <= 0) {
        alert('No valid price found.');
        return;
      }

      // ✅ Determine the correct process based on listing type
      const publicData = listing.attributes?.publicData || {};
      const transactionProcessAlias = publicData.transactionProcessAlias;
      const isBooking = transactionProcessAlias?.includes('booking');

      const processAlias = isBooking
        ? 'default-booking/release-1'
        : 'default-purchase-paystack/release-1';


      // ✅ Get unitType from listing
      const unitType = publicData.unitType;

      // ✅ Get booking dates if this is a booking
      const bookingStart = pageData?.orderData?.bookingDates?.bookingStart;
      const bookingEnd = pageData?.orderData?.bookingDates?.bookingEnd;

      const bookingParams =
        isBooking && bookingStart && bookingEnd
          ? {
              bookingStart: bookingStart.toISOString(),
              bookingEnd: bookingEnd.toISOString(),
              unitType,
              listingType: publicData.listingType,
              transactionProcessAlias,
            }
          : {};

      try {
        const response = await fetch('/api/initiate-transaction', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            processAlias,
            transition: 'transition/request-payment-paystack',
            params: {
              listingId: listing.id.uuid,
              paystackReference: paystackRef,
              amount: amountInKobo,
              ...bookingParams,
            },
          }),
        });

        const result = await response.json();

        console.log('API Response:', result);
        console.log('Response status:', response.status);

        if (!response.ok || !result.success) {
          console.error('Full error response:', result);
          throw new Error(result.message || 'Failed to create transaction');
        }

        transactionId = result.data.id.uuid;
      } catch (err) {
        console.error('Failed to create transaction:', err);
        alert('Failed to create order: ' + err.message);
        return;
      }
    }

    // Open Paystack
    const paystackPublicKey = config.paystack?.publicKey;

    if (!paystackPublicKey || !window.PaystackPop) {
      alert('Payment system not ready. Please refresh the page.');
      return;
    }

    const handlePaystackSuccess = function(response) {
      console.log('Payment successful:', response.reference);
      setPaystackProcessing(true);
      verifyPaystackPayment(response.reference, transactionId);
    };

    const handlePaystackClose = function() {
      console.log('Paystack closed');
      setPaystackProcessing(false);
    };

    const handler = window.PaystackPop.setup({
      key: paystackPublicKey,
      email: currentUser.attributes.email,
      amount: amountInKobo,
      currency: 'NGN',
      ref: paystackRef,
      callback: handlePaystackSuccess,
      onClose: handlePaystackClose,
    });

    console.log(
      'Opening Paystack with amount:',
      amountInKobo,
      'kobo (₦' + amountInKobo / 100 + ')'
    );
    handler.openIframe();
  } catch (err) {
    console.error('Payment error:', err);
    alert('Unexpected error. See console.');
    setPaystackProcessing(false);
  }
};

  const verifyPaystackPayment = async (reference, transactionId) => {
    const { routeConfiguration } = props;

    try {
      console.log('Verifying payment...', reference, transactionId);

      const res = await fetch('/api/paystack/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ reference, transactionId }),
      });

      const data = await res.json();
      console.log('Verification response:', data);

      if (data.success && data.transaction) {
        // ✅ Wait 2 seconds for the backend to fully process
        await new Promise(resolve => setTimeout(resolve, 2000));

        const orderPath = pathByRouteName('OrderDetailsPage', routeConfiguration, {
          id: data.transaction.id.uuid,
        });
        window.location.href = orderPath;
      } else {
        console.error('Verification failed:', data);
        alert(data.message || 'Payment verification failed');
      }
    } catch (error) {
      console.error('Verification error:', error);
      alert('Payment verification failed: ' + error.message);
    }
  };

  const paymentMethod = pageData?.orderData?.paymentMethod || 'stripe';
  const isPaystack = paymentMethod === 'paystack';

  // Since the listing data is already given from the ListingPage
  // and stored to handle refreshes, it might not have the possible
  // deleted or closed information in it. If the transaction
  // initiate or the speculative initiate fail due to the listing
  // being deleted or closed, we should dig the information from the
  // errors and not the listing data.
  const listingNotFound =
    isTransactionInitiateListingNotFoundError(speculateTransactionError) ||
    isTransactionInitiateListingNotFoundError(initiateOrderError);

  const { listing, transaction, orderData } = pageData;
  const existingTransaction = ensureTransaction(transaction);
  const speculatedTransaction = ensureTransaction(speculatedTransactionMaybe, {}, null);

  // If existing transaction has line-items, it has gone through one of the request-payment transitions.
  // Otherwise, we try to rely on speculatedTransaction for order breakdown data.
  const tx =
    existingTransaction?.attributes?.lineItems?.length > 0
      ? existingTransaction
      : speculatedTransaction;
  const timeZone = listing?.attributes?.availabilityPlan?.timezone;
  const transactionProcessAlias = listing?.attributes?.publicData?.transactionProcessAlias;
  const priceVariantName = tx.attributes.protectedData?.priceVariantName;

  const txBookingMaybe = tx?.booking?.id ? { booking: tx.booking, timeZone } : {};

  // Show breakdown only when (speculated?) transaction is loaded
  // (i.e. it has an id and lineItems)
  // ✅ Detect manual seller and use correct currency
const author = listing?.author;
const sellerType = author?.attributes?.profile?.publicData?.sellerType;
const isManualSeller = sellerType === 'manual';
const displayCurrency = isManualSeller ? 'NGN' : config.currency;

const breakdown =
  tx.id && tx.attributes.lineItems?.length > 0 ? (
    <OrderBreakdown
      className={css.orderBreakdown}
      userRole="customer"
      transaction={tx}
      {...txBookingMaybe}
      currency={displayCurrency}  // ✅ NGN for manual sellers!
      marketplaceName={config.marketplaceName}
    />
  ) : null;

  const totalPrice =
    tx?.attributes?.lineItems?.length > 0 ? getFormattedTotalPrice(tx, intl) : null;

  const process = processName ? getProcess(processName) : null;
  const transitions = process.transitions;
  const isPaymentExpired = hasPaymentExpired(existingTransaction, process, isClockInSync);


  const showPaymentForm = !!(
    currentUser &&
    !listingNotFound &&
    !initiateOrderError &&
    (isManualSeller || !speculateTransactionError) && // ✅ Ignore speculate error for manual sellers
    !retrievePaymentIntentError &&
    !isPaymentExpired
  );

  const firstImage = listing?.images?.length > 0 ? listing.images[0] : null;

  const listingLink = (
    <NamedLink
      name="ListingPage"
      params={{ id: listing?.id?.uuid, slug: createSlug(listingTitle) }}
    >
      <FormattedMessage id="CheckoutPage.errorlistingLinkText" />
    </NamedLink>
  );

  const errorMessages = getErrorMessages(
    listingNotFound,
    initiateOrderError,
    isPaymentExpired,
    retrievePaymentIntentError,
    isManualSeller ? null : speculateTransactionError, // ✅ Now it's defined!
    listingLink
  );

  const isBooking = processName === BOOKING_PROCESS_NAME;
  const isPurchase = processName === PURCHASE_PROCESS_NAME;
  const isNegotiation = processName === NEGOTIATION_PROCESS_NAME;

  const txTransitions = existingTransaction?.attributes?.transitions || [];
  const hasInquireTransition = txTransitions.find(tr => tr.transition === transitions.INQUIRE);
  const showInitialMessageInput = !hasInquireTransition && !isNegotiation;

  // Get first and last name of the current user and use it in the StripePaymentForm to autofill the name field
  const userName = currentUser?.attributes?.profile
    ? `${currentUser.attributes.profile.firstName} ${currentUser.attributes.profile.lastName}`
    : null;

  // If paymentIntent status is not waiting user action,
  // confirmCardPayment has been called previously.
  const hasPaymentIntentUserActionsDone =
    paymentIntent && STRIPE_PI_USER_ACTIONS_DONE_STATUSES.includes(paymentIntent.status);

  // If your marketplace works mostly in one country you can use initial values to select country automatically
  // e.g. {country: 'FI'}

  const initialValuesForStripePayment = { name: userName, recipientName: userName };
  const askShippingDetails =
    orderData?.deliveryMethod === 'shipping' &&
    !hasTransactionPassedPendingPayment(existingTransaction, process);

  const listingLocation = listing?.attributes?.publicData?.location;
  const showPickUpLocation = isPurchase && orderData?.deliveryMethod === 'pickup';
  const showLocation = (isBooking || isNegotiation) && listingLocation?.address;

  const providerDisplayName = isNegotiation
    ? existingTransaction?.provider?.attributes?.profile?.displayName
    : listing?.author?.attributes?.profile?.displayName;

  // Check if the listing currency is compatible with Stripe for the specified transaction process.
  // This function validates the currency against the transaction process requirements and
  // ensures it is supported by Stripe, as indicated by the 'stripe' parameter.
  // If using a transaction process without any stripe actions, leave out the 'stripe' parameter.
  const currency =
  existingTransaction?.attributes?.payinTotal?.currency || listing.attributes.price?.currency;
const isStripeCompatibleCurrency = isValidCurrencyForTransactionProcess(
  transactionProcessAlias,
  currency,
  'stripe'
);

// ✅ Skip Stripe currency check for manual sellers - they use Paystack!
if (!isStripeCompatibleCurrency && !isManualSeller) {
  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <TopbarSimplified />
      <div className={css.contentContainer}>
        <section className={css.incompatibleCurrency}>
          <H4 as="h1" className={css.heading}>
            <FormattedMessage id="CheckoutPage.incompatibleCurrency" />
          </H4>
        </section>
      </div>
    </Page>
  );
}

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <TopbarSimplified />
      <div className={css.contentContainer}>
        <MobileListingImage
          listingTitle={listingTitle}
          author={listing?.author}
          firstImage={firstImage}
          layoutListingImageConfig={config.layout.listingImage}
          showListingImage={showListingImage}
        />
        <main className={css.orderFormContainer}>
          <div className={css.headingContainer}>
            <H3 as="h1" className={css.heading}>
              {title}
            </H3>
            <H4 as="h2" className={css.detailsHeadingMobile}>
              <FormattedMessage id="CheckoutPage.listingTitle" values={{ listingTitle }} />
            </H4>
          </div>
          <MobileOrderBreakdown
            speculateTransactionErrorMessage={errorMessages.speculateTransactionErrorMessage}
            breakdown={breakdown}
            priceVariantName={priceVariantName}
          />
          <section className={css.paymentContainer}>
            {errorMessages.initiateOrderErrorMessage}
            {errorMessages.listingNotFoundErrorMessage}
            {errorMessages.speculateErrorMessage}
            {errorMessages.retrievePaymentIntentErrorMessage}
            {errorMessages.paymentExpiredMessage}

            {(() => {
              // ✅ Check if seller is manual
              const author = listing?.author;
              const sellerType = author?.attributes?.profile?.publicData?.sellerType;
              const isManualSeller = sellerType === 'manual';

              return (
                <>
                  {/* Show Stripe ONLY for non-manual sellers */}
                  {!isManualSeller && showPaymentForm && !isPaystack ? (
                    <StripePaymentForm
                      className={css.paymentForm}
                      onSubmit={values =>
                        handleSubmit(values, process, props, stripe, submitting, setSubmitting)
                      }
                      inProgress={submitting}
                      formId="CheckoutPagePaymentForm"
                      providerDisplayName={providerDisplayName}
                      showInitialMessageInput={showInitialMessageInput}
                      initialValues={initialValuesForStripePayment}
                      initiateOrderError={initiateOrderError}
                      confirmCardPaymentError={confirmCardPaymentError}
                      confirmPaymentError={confirmPaymentError}
                      hasHandledCardPayment={hasPaymentIntentUserActionsDone}
                      loadingData={!stripeCustomerFetched}
                      defaultPaymentMethod={
                        hasDefaultPaymentMethod(stripeCustomerFetched, currentUser)
                          ? currentUser.stripeCustomer.defaultPaymentMethod
                          : null
                      }
                      paymentIntent={paymentIntent}
                      onStripeInitialized={stripe => {
                        setStripe(stripe);
                        return onStripeInitialized(stripe, process, props);
                      }}
                      askShippingDetails={askShippingDetails}
                      showPickUpLocation={showPickUpLocation}
                      showLocation={showLocation}
                      listingLocation={listingLocation}
                      totalPrice={totalPrice}
                      locale={config.localization.locale}
                      stripePublishableKey={config.stripe.publishableKey}
                      marketplaceName={config.marketplaceName}
                      isBooking={isBookingProcessAlias(transactionProcessAlias)}
                      isFuzzyLocation={config.maps.fuzzy.enabled}
                    />
                  ) : null}

                  {/* Show Paystack for manual sellers OR when explicitly selected */}
                  {(isManualSeller || isPaystack) && showPaymentForm ? (
                    <button
                      style={{
                        backgroundColor: paystackProcessing ? '#6b7280' : '#059669',
                        color: 'white',
                        padding: '12px 20px',
                        fontSize: '16px',
                        fontWeight: 600,
                        border: 'none',
                        borderRadius: '8px',
                        cursor: paystackProcessing ? 'not-allowed' : 'pointer',
                        width: '100%',
                        marginTop: isManualSeller ? '0' : '16px', // No margin if it's the only option
                        transition: '0.25s',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                      }}
                      onMouseOver={e =>
                        !paystackProcessing && (e.target.style.backgroundColor = '#047857')
                      }
                      onMouseOut={e =>
                        !paystackProcessing && (e.target.style.backgroundColor = '#059669')
                      }
                      onClick={handlePaystackPayment}
                      disabled={paystackProcessing}
                    >
                      {paystackProcessing && <IconSpinner />}
                      {paystackProcessing ? 'Processing payment...' : 'Pay with Paystack'}
                    </button>
                  ) : null}
                </>
              );
            })()}
          </section>
        </main>

        <DetailsSideCard
          listing={listing}
          listingTitle={listingTitle}
          priceVariantName={priceVariantName}
          author={listing?.author}
          firstImage={firstImage}
          layoutListingImageConfig={config.layout.listingImage}
          speculateTransactionErrorMessage={errorMessages.speculateTransactionErrorMessage}
          isInquiryProcess={false}
          processName={processName}
          breakdown={breakdown}
          showListingImage={showListingImage}
          intl={intl}
        />
      </div>
    </Page>
  );
};

export default CheckoutPageWithPayment;
