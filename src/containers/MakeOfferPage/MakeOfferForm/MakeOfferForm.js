import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

// Import contexts and util modules
import appSettings from '../../../config/settings.js';
import { types as sdkTypes } from '../../../util/sdkLoader.js';
import { FormattedMessage, intlShape } from '../../../util/reactIntl.js';
import { formatMoney } from '../../../util/currency.js';
import { propTypes } from '../../../util/types.js';
import * as validators from '../../../util/validators.js';

// Import shared components
import {
  FieldCurrencyInput,
  FieldTextInput,
  Form,
  Heading,
  NamedLink,
  PrimaryButton,
} from '../../../components/index.js';

import css from './MakeOfferForm.module.css';

const { Money } = sdkTypes;

const getPriceValidators = (listingMinimumPriceSubUnits, marketplaceCurrency, intl) => {
  const quoteRequiredMsgId = { id: 'MakeOfferPage.quoteRequired' };
  const quoteRequiredMsg = intl.formatMessage(quoteRequiredMsgId);
  const quoteRequired = validators.required(quoteRequiredMsg);

  const minPriceRaw = new Money(listingMinimumPriceSubUnits, marketplaceCurrency);
  const minPrice = formatMoney(intl, minPriceRaw);
  const quoteTooLowMsgId = { id: 'MakeOfferPage.quoteTooLow' };
  const quoteTooLowMsg = intl.formatMessage(quoteTooLowMsgId, { minPrice });
  const minQuoteRequired = validators.moneySubUnitAmountAtLeast(
    quoteTooLowMsg,
    listingMinimumPriceSubUnits
  );

  return listingMinimumPriceSubUnits
    ? validators.composeValidators(quoteRequired, minQuoteRequired)
    : quoteRequired;
};

// ✅ Updated FinePrint to handle manual sellers
const FinePrint = ({ stripeConnected, isManualSeller }) => {
  // ✅ Manual sellers don't need Stripe
  if (stripeConnected || isManualSeller) {
    return (
      <div className={css.finePrint}>
        <FormattedMessage id="MakeOfferPage.finePrint" />
      </div>
    );
  }

  const payoutDetailsWarningLink = (
    <NamedLink name="StripePayoutPage">
      <FormattedMessage id="MakeOfferPage.payoutDetailsWarningLink" />
    </NamedLink>
  );

  return (
    <div className={css.finePrint}>
      <FormattedMessage
        id="MakeOfferPage.payoutDetailsWarning"
        values={{ payoutDetailsWarningLink }}
      />
    </div>
  );
};

/**
 * Make offer step in the default-negotiation process.
 * It's provider's job to make offer for "request" type of listings.
 *
 * @param {Object} props - The component props.
 * @param {boolean} props.scrollingDisabled - Whether scrolling is disabled.
 * @param {string} props.processName - The process name.
 * @param {propTypes.listing} props.listing - The listing.
 * @param {string} props.listingTitle - The listing title.
 * @param {string} props.title - The title.
 * @param {intlShape} props.intl - The intl object.
 * @param {Object} props.config - The config object.
 * @param {propTypes.error} props.initiateInquiryError - The error message.
 * @param {propTypes.currentUser} props.currentUser - The current user.
 */
export const MakeOfferForm = props => {
  const {
    intl,
    config,
    price,
    stripeConnected,
    currentUser,
    errorMessageComponent: ErrorMessage,
    makeOfferError,
    onSubmit,
  } = props;

  // ✅ Check if current user is a manual seller
  const sellerType = currentUser?.attributes?.profile?.publicData?.sellerType;
  const isManualSeller = sellerType === 'manual';

  console.log('=== MAKE OFFER FORM ===');
  console.log('Seller type:', sellerType);
  console.log('Is manual seller?', isManualSeller);
  console.log('Stripe connected?', stripeConnected);
  console.log('Will allow submission?', isManualSeller || stripeConnected);
  console.log('======================');

  const initialValuesMaybe = price ? { offer: price } : {};

  const marketplaceCurrency = config.currency;
  const priceValidators = getPriceValidators(
    config.listingMinimumPriceSubUnits,
    marketplaceCurrency,
    intl
  );

  return (
    <FinalForm
      initialValues={initialValuesMaybe}
      onSubmit={values => {
        // ✅ Determine currency based on seller type
        const currency = isManualSeller ? 'NGN' : marketplaceCurrency;
        
        console.log('=== SUBMITTING OFFER ===');
        console.log('Form values:', values);
        console.log('Offer amount (quote):', values.quote);
        console.log('Currency:', currency);
        console.log('Is manual seller?', isManualSeller);
        console.log('========================');
        
        // Add currency to the submitted values
        onSubmit({ ...values, currency });
      }}
      render={formRenderProps => {
        const {
          rootClassName,
          className,
          submitButtonWrapperClassName,
          formId,
          handleSubmit,
          inProgress,
          invalid,
          authorDisplayName,
        } = formRenderProps;

        const classes = classNames(rootClassName || css.root, className);
        const submitInProgress = inProgress;
        
        // ✅ Allow submission if manual seller OR Stripe connected
        const submitDisabled = invalid || submitInProgress || !(stripeConnected || isManualSeller);

        return (
          <Form className={classes} onSubmit={handleSubmit} enforcePagePreloadFor="SaleDetailsPage">
            <div className={css.section}>
              <Heading as="label" htmlFor={`${formId}quote`} rootClassName={css.sectionHeading}>
                <FormattedMessage id="MakeOfferPage.quoteLabel" values={{ authorDisplayName }} />
              </Heading>

              <FieldCurrencyInput
                id={`${formId}quote`}
                name="quote"
                className={css.input}
                placeholder={intl.formatMessage(
                  {
                    id: 'MakeOfferPage.quotePlaceholder',
                  },
                  // ✅ Show NGN for manual sellers, USD for others
                  { marketplaceCurrency: isManualSeller ? 'NGN' : marketplaceCurrency }
                )}
                currencyConfig={appSettings.getCurrencyFormatting(
                  isManualSeller ? 'NGN' : marketplaceCurrency
                )}
                validate={priceValidators}
              />

              <FieldTextInput
                className={css.fieldDefaultMessage}
                type="textarea"
                name="providerDefaultMessage"
                id={formId ? `${formId}.message` : 'message'}
                labelClassName={css.sectionHeading}
                label={intl.formatMessage({
                  id: 'MakeOfferPage.defaultMessageLabel',
                })}
                placeholder={intl.formatMessage(
                  {
                    id: 'MakeOfferPage.defaultMessagePlaceholder',
                  },
                  { authorDisplayName }
                )}
              />
            </div>

            <div className={submitButtonWrapperClassName}>
              <ErrorMessage error={makeOfferError} />
              <PrimaryButton type="submit" inProgress={submitInProgress} disabled={submitDisabled}>
                <FormattedMessage id="MakeOfferPage.submitButtonText" />
              </PrimaryButton>
              <FinePrint stripeConnected={stripeConnected} isManualSeller={isManualSeller} />
            </div>
          </Form>
        );
      }}
    />
  );
};

export default MakeOfferForm;