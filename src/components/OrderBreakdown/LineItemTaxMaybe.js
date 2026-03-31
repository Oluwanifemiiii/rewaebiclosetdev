import React from 'react';
import { intlShape } from '../../util/reactIntl';
import { formatMoney } from '../../util/currency';
import { propTypes } from '../../util/types';

import css from './OrderBreakdown.module.css';

const LINE_ITEM_TAX = 'line-item/tax';

/**
 * Renders the tax (VAT) line item in the order breakdown.
 *
 * @component
 * @param {Object} props
 * @param {Array<propTypes.lineItem>} props.lineItems - The line items to render
 * @param {intlShape} props.intl - The intl object
 * @returns {JSX.Element|null}
 */
const LineItemTaxMaybe = props => {
  const { lineItems, intl } = props;

  const taxLineItem = lineItems.find(
    item => item.code === LINE_ITEM_TAX && !item.reversal
  );

  return taxLineItem ? (
    <div className={css.lineItem}>
      <span className={css.itemLabel}>VAT</span>
      <span className={css.itemValue}>{formatMoney(intl, taxLineItem.lineTotal)}</span>
    </div>
  ) : null;
};

export default LineItemTaxMaybe;
