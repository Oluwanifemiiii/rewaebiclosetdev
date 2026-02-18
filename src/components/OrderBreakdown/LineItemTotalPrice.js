import React from 'react';
import { FormattedMessage, intlShape } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { types as sdkTypes } from '../../util/sdkLoader';
import { propTypes } from '../../util/types';
import { resolveLatestProcessName, getProcess } from '../../transactions/transaction';

import css from './OrderBreakdown.module.css';

const { Money } = sdkTypes;

/**
 * A component that renders the total price as a line item.
 *
 * @component
 * @param {Object} props
 * @param {propTypes.transaction} props.transaction - The transaction to render
 * @param {boolean} props.isProvider - Whether the provider is the one receiving the commission
 * @param {intlShape} props.intl - The intl object
 * @param {string} props.currency - Override currency (e.g. 'NGN' for manual sellers)
 * @returns {JSX.Element}
 */
const LineItemTotalPrice = props => {
  const { transaction, isProvider, intl, currency } = props;
  const processName = resolveLatestProcessName(transaction?.attributes?.processName);
  if (!processName) {
    return null;
  }
  const process = getProcess(processName);
  const isCompleted = process.isCompleted(transaction?.attributes?.lastTransition);
  const isRefunded = process.isRefunded(transaction?.attributes?.lastTransition);

  let providerTotalMessageId = 'OrderBreakdown.providerTotalDefault';
  if (isCompleted) {
    providerTotalMessageId = 'OrderBreakdown.providerTotalReceived';
  } else if (isRefunded) {
    providerTotalMessageId = 'OrderBreakdown.providerTotalRefunded';
  }

  const totalLabel = isProvider ? (
    <FormattedMessage id={providerTotalMessageId} />
  ) : (
    <FormattedMessage id="OrderBreakdown.total" />
  );

  const totalPrice = isProvider
    ? transaction.attributes.payoutTotal
    : transaction.attributes.payinTotal;

  // ✅ If currency override is provided (e.g. NGN for manual sellers),
  // use the amount from line items instead of payinTotal/payoutTotal
  // because those are stored in USD by Sharetribe
  let displayPrice = totalPrice;

  if (currency && totalPrice && totalPrice.currency !== currency) {
    console.log('=== LineItemTotalPrice Currency Override ===');
    console.log('Original currency:', totalPrice.currency);
    console.log('Override currency:', currency);
    console.log('Original amount:', totalPrice.amount);

    // ✅ Get the total from line items which have the correct NGN currency
    const lineItems = transaction?.attributes?.lineItems || [];
    
    if (isProvider) {
      // For provider: sum all provider line items
      const providerItems = lineItems.filter(
        item => item.includeFor?.includes('provider') && !item.reversal
      );
      const totalAmount = providerItems.reduce((sum, item) => {
        return sum + (item.lineTotal?.amount || 0);
      }, 0);
      displayPrice = new Money(totalAmount, currency);
      console.log('Provider total from line items:', totalAmount, currency);
    } else {
      // For customer: sum all customer line items
      const customerItems = lineItems.filter(
        item => item.includeFor?.includes('customer') && !item.reversal
      );
      const totalAmount = customerItems.reduce((sum, item) => {
        return sum + (item.lineTotal?.amount || 0);
      }, 0);
      displayPrice = new Money(totalAmount, currency);
      console.log('Customer total from line items:', totalAmount, currency);
    }

    console.log('Display price:', displayPrice);
    console.log('==========================================');
  }

  const formattedTotalPrice = formatMoney(intl, displayPrice);

  return (
    <>
      <hr className={css.totalDivider} />
      <div className={css.lineItemTotal}>
        <div className={css.totalLabel}>{totalLabel}</div>
        <div className={css.totalPrice}>{formattedTotalPrice}</div>
      </div>
    </>
  );
};

export default LineItemTotalPrice;