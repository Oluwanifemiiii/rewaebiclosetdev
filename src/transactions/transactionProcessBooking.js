/**
 * Transaction process graph for bookings:
 *   - default-booking
 */

export const transitions = {
  REQUEST_PAYMENT: 'transition/request-payment',
  ACCEPT_PAYSTACK: 'transition/accept-paystack',
  INQUIRE: 'transition/inquire',
  REQUEST_PAYMENT_AFTER_INQUIRY: 'transition/request-payment-after-inquiry',
  REQUEST_PAYMENT_PAYSTACK: 'transition/request-payment-paystack',
  CONFIRM_PAYMENT: 'transition/confirm-payment',
  CONFIRM_PAYMENT_PAYSTACK: 'transition/confirm-payment-paystack',
  DECLINE_PAYSTACK: 'transition/decline-paystack',
  EXPIRE_PAYMENT: 'transition/expire-payment',
  ACCEPT: 'transition/accept',
  DECLINE: 'transition/decline',
  OPERATOR_ACCEPT: 'transition/operator-accept',
  OPERATOR_DECLINE: 'transition/operator-decline',
  EXPIRE: 'transition/expire',
  CANCEL: 'transition/cancel',
  COMPLETE: 'transition/complete',
  OPERATOR_COMPLETE: 'transition/operator-complete',
  REVIEW_1_BY_PROVIDER: 'transition/review-1-by-provider',
  REVIEW_2_BY_PROVIDER: 'transition/review-2-by-provider',
  REVIEW_1_BY_CUSTOMER: 'transition/review-1-by-customer',
  REVIEW_2_BY_CUSTOMER: 'transition/review-2-by-customer',
  EXPIRE_CUSTOMER_REVIEW_PERIOD: 'transition/expire-customer-review-period',
  EXPIRE_PROVIDER_REVIEW_PERIOD: 'transition/expire-provider-review-period',
  EXPIRE_REVIEW_PERIOD: 'transition/expire-review-period',
};

export const states = {
  INITIAL: 'initial',
  INQUIRY: 'inquiry',
  PENDING_PAYMENT: 'pending-payment',
  PENDING_PAYMENT_PAYSTACK: 'pending-payment-paystack',
  PAYMENT_EXPIRED: 'payment-expired',
  PREAUTHORIZED: 'preauthorized',
  DECLINED: 'declined',
  ACCEPTED: 'accepted',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
  DELIVERED: 'delivered',
  REVIEWED: 'reviewed',
  REVIEWED_BY_CUSTOMER: 'reviewed-by-customer',
  REVIEWED_BY_PROVIDER: 'reviewed-by-provider',
};

export const graph = {
  id: 'default-booking/release-1',
  initial: states.INITIAL,
  states: {
    [states.INITIAL]: {
      on: {
        [transitions.INQUIRE]: states.INQUIRY,
        [transitions.REQUEST_PAYMENT]: states.PENDING_PAYMENT,
        [transitions.REQUEST_PAYMENT_PAYSTACK]: states.PENDING_PAYMENT_PAYSTACK, // ✅ Add this
      },
    },
    [states.INQUIRY]: {
      on: {
        [transitions.REQUEST_PAYMENT_AFTER_INQUIRY]: states.PENDING_PAYMENT,
      },
    },
    [states.PENDING_PAYMENT]: {
      on: {
        [transitions.EXPIRE_PAYMENT]: states.PAYMENT_EXPIRED,
        [transitions.CONFIRM_PAYMENT]: states.PREAUTHORIZED,
      },
    },
    [states.PENDING_PAYMENT_PAYSTACK]: {
      on: {
        [transitions.CONFIRM_PAYMENT_PAYSTACK]: states.PREAUTHORIZED, // ✅ FIXED!
      },
    },
    [states.PAYMENT_EXPIRED]: {},
    [states.PREAUTHORIZED]: {
      on: {
        [transitions.DECLINE]: states.DECLINED,
        [transitions.DECLINE_PAYSTACK]: states.DECLINED, // ✅ Add this
        [transitions.OPERATOR_DECLINE]: states.DECLINED,
        [transitions.EXPIRE]: states.EXPIRED,
        [transitions.ACCEPT]: states.ACCEPTED,
        [transitions.ACCEPT_PAYSTACK]: states.ACCEPTED,
        [transitions.OPERATOR_ACCEPT]: states.ACCEPTED,
      },
    },
    [states.DECLINED]: {},
    [states.EXPIRED]: {},
    [states.ACCEPTED]: {
      on: {
        [transitions.CANCEL]: states.CANCELED,
        [transitions.COMPLETE]: states.DELIVERED,
        [transitions.OPERATOR_COMPLETE]: states.DELIVERED,
      },
    },
    [states.CANCELED]: {},
    [states.DELIVERED]: {
      on: {
        [transitions.EXPIRE_REVIEW_PERIOD]: states.REVIEWED,
        [transitions.REVIEW_1_BY_CUSTOMER]: states.REVIEWED_BY_CUSTOMER,
        [transitions.REVIEW_1_BY_PROVIDER]: states.REVIEWED_BY_PROVIDER,
      },
    },
    [states.REVIEWED_BY_CUSTOMER]: {
      on: {
        [transitions.REVIEW_2_BY_PROVIDER]: states.REVIEWED,
        [transitions.EXPIRE_PROVIDER_REVIEW_PERIOD]: states.REVIEWED,
      },
    },
    [states.REVIEWED_BY_PROVIDER]: {
      on: {
        [transitions.REVIEW_2_BY_CUSTOMER]: states.REVIEWED,
        [transitions.EXPIRE_CUSTOMER_REVIEW_PERIOD]: states.REVIEWED,
      },
    },
    [states.REVIEWED]: { type: 'final' },
  },
};

export const isRelevantPastTransition = transition => {
  return [
    transitions.ACCEPT,
    transitions.ACCEPT_PAYSTACK, // ✅ Add this
    transitions.OPERATOR_ACCEPT,
    transitions.CANCEL,
    transitions.COMPLETE,
    transitions.OPERATOR_COMPLETE,
    transitions.CONFIRM_PAYMENT,
    transitions.CONFIRM_PAYMENT_PAYSTACK,
    transitions.DECLINE,
    transitions.DECLINE_PAYSTACK, // ✅ Add this
    transitions.OPERATOR_DECLINE,
    transitions.EXPIRE,
    transitions.REVIEW_1_BY_CUSTOMER,
    transitions.REVIEW_1_BY_PROVIDER,
    transitions.REVIEW_2_BY_CUSTOMER,
    transitions.REVIEW_2_BY_PROVIDER,
  ].includes(transition);
};

export const isCustomerReview = transition => {
  return [transitions.REVIEW_1_BY_CUSTOMER, transitions.REVIEW_2_BY_CUSTOMER].includes(transition);
};

export const isProviderReview = transition => {
  return [transitions.REVIEW_1_BY_PROVIDER, transitions.REVIEW_2_BY_PROVIDER].includes(transition);
};

export const isPrivileged = transition => {
  return [transitions.REQUEST_PAYMENT, transitions.REQUEST_PAYMENT_AFTER_INQUIRY].includes(
    transition
  );
};

export const isCompleted = transition => {
  const txCompletedTransitions = [
    transitions.COMPLETE,
    transitions.OPERATOR_COMPLETE,
    transitions.REVIEW_1_BY_CUSTOMER,
    transitions.REVIEW_1_BY_PROVIDER,
    transitions.REVIEW_2_BY_CUSTOMER,
    transitions.REVIEW_2_BY_PROVIDER,
    transitions.EXPIRE_REVIEW_PERIOD,
    transitions.EXPIRE_CUSTOMER_REVIEW_PERIOD,
    transitions.EXPIRE_PROVIDER_REVIEW_PERIOD,
  ];
  return txCompletedTransitions.includes(transition);
};

export const isRefunded = transition => {
  const txRefundedTransitions = [
    transitions.EXPIRE_PAYMENT,
    transitions.EXPIRE,
    transitions.CANCEL,
    transitions.DECLINE,
    transitions.DECLINE_PAYSTACK, // ✅ Add this
  ];
  return txRefundedTransitions.includes(transition);
};

export const statesNeedingProviderAttention = [states.PREAUTHORIZED];