import React from 'react';
import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { types as sdkTypes } from '../../util/sdkLoader';

import css from './OrderBreakdown.module.css';

const { Money } = sdkTypes;

/**
 * Refundable security deposit row.
 *
 * Two sources, rendered the same way:
 * - Paystack rentals: the deposit is a real `line-item/caution-fee` line item
 *   (already summed into the totals by other components) — here we only add
 *   the explanatory caption for the customer.
 * - Stripe rentals: the deposit is a separate manual-capture hold, not a line
 *   item, read from the transaction's protectedData (or passed in as the
 *   `rentalDeposit` prop at checkout, before the transaction exists). It is
 *   NOT part of payin/payout totals, so it renders as its own row after the
 *   total.
 *
 * @component
 * @param {Object} props
 * @param {propTypes.transaction} props.transaction
 * @param {Object?} props.rentalDeposit - { amountSubunits, currency }, overrides protectedData
 * @param {boolean} props.isProvider
 * @param {intlShape} props.intl
 */
const LineItemRentalDepositMaybe = props => {
  const { transaction, rentalDeposit, isProvider, intl } = props;

  const lineItems = transaction?.attributes?.lineItems || [];
  const cautionFeeLineItem = lineItems.find(
    li => li.code === 'line-item/caution-fee' && !li.reversal
  );

  // Paystack: the row itself is rendered by LineItemUnknownItemsMaybe and the
  // provider range hint by LineItemTotalPrice — only the customer needs the
  // refund explanation here.
  if (cautionFeeLineItem) {
    return !isProvider ? (
      <div className={css.feeInfo}>
        <FormattedMessage id="OrderBreakdown.cautionFeeRefundInfo" />
      </div>
    ) : null;
  }

  const deposit = rentalDeposit || transaction?.attributes?.protectedData?.rentalDeposit;
  const amountSubunits = Math.round(Number(deposit?.amountSubunits));
  if (!deposit?.currency || !Number.isFinite(amountSubunits) || amountSubunits <= 0) {
    return null;
  }

  const formattedDeposit = formatMoney(intl, new Money(amountSubunits, deposit.currency));

  return (
    <>
      <div className={css.lineItem}>
        <span className={css.itemLabel}>
          <FormattedMessage id="OrderBreakdown.rentalDeposit" />
        </span>
        <span className={css.itemValue}>{formattedDeposit}</span>
      </div>
      <div className={css.feeInfo}>
        <FormattedMessage
          id={
            isProvider
              ? 'OrderBreakdown.rentalDepositProviderInfo'
              : 'OrderBreakdown.rentalDepositCustomerInfo'
          }
        />
      </div>
    </>
  );
};

export default LineItemRentalDepositMaybe;
