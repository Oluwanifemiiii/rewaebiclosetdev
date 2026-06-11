import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import arrayMutators from 'final-form-arrays';
import classNames from 'classnames';

// Import configs and util modules
import appSettings from '../../../../config/settings';
import { FormattedMessage, useIntl } from '../../../../util/reactIntl';
import * as validators from '../../../../util/validators';
import { formatMoney } from '../../../../util/currency';
import { types as sdkTypes } from '../../../../util/sdkLoader';
import { FIXED, isBookingProcess } from '../../../../transactions/transaction';

// Import shared components
import { Button, Form, FieldCurrencyInput } from '../../../../components';

import BookingPriceVariants from './BookingPriceVariants';
import StartTimeInterval from './StartTimeInverval';

// Import modules from this directory
import css from './EditListingPricingForm.module.css';

const { Money } = sdkTypes;

const getPriceValidators = (listingMinimumPriceSubUnits, marketplaceCurrency, intl) => {
  const priceRequiredMsgId = { id: 'EditListingPricingForm.priceRequired' };
  const priceRequiredMsg = intl.formatMessage(priceRequiredMsgId);
  const priceRequired = validators.required(priceRequiredMsg);

  const minPriceRaw = new Money(listingMinimumPriceSubUnits, marketplaceCurrency);
  const minPrice = formatMoney(intl, minPriceRaw);
  const priceTooLowMsgId = { id: 'EditListingPricingForm.priceTooLow' };
  const priceTooLowMsg = intl.formatMessage(priceTooLowMsgId, { minPrice });
  const minPriceRequired = validators.moneySubUnitAmountAtLeast(
    priceTooLowMsg,
    listingMinimumPriceSubUnits
  );

  return listingMinimumPriceSubUnits
    ? validators.composeValidators(priceRequired, minPriceRequired)
    : priceRequired;
};

const ErrorMessages = props => {
  const { fetchErrors } = props;
  const { updateListingError, showListingsError } = fetchErrors || {};

  return (
    <>
      {updateListingError ? (
        <p className={css.error}>
          <FormattedMessage id="EditListingPricingForm.updateFailed" />
        </p>
      ) : null}
      {showListingsError ? (
        <p className={css.error}>
          <FormattedMessage id="EditListingPricingForm.showListingFailed" />
        </p>
      ) : null}
    </>
  );
};

/**
 * The EditListingPricingForm component.
 *
 * @component
 * @param {Object} props
 * @param {string} [props.formId] - The form id
 * @param {string} [props.className] - Custom class that extends the default class for the root element
 * @param {string} [props.rootClassName] - Custom class that overrides the default class for the root element
 * @param {string} props.unitType - The unitType from listing.attributes.publicData
 * @param {Object} [props.listingTypeConfig] - The listing type config that matches with listingType on publicData.
 * @param {Object} [props.listingTypeConfig.priceVariations] - The price variations config.
 * @param {boolean} props.listingTypeConfig.priceVariations.enabled - Whether the price variations are enabled.
 * @param {Object} [props.listingTypeConfig.transactionType] - The transaction type config.
 * @param {string} props.listingTypeConfig.transactionType.process - The transaction process config.
 * @param {string} props.marketplaceCurrency - The marketplace currency
 * @param {number} [props.listingMinimumPriceSubUnits] - The listing minimum price sub units
 * @param {boolean} [props.autoFocus] - Whether the input should be focused
 * @param {boolean} [props.disabled] - Whether the form is disabled
 * @param {boolean} [props.ready] - Whether the form is ready
 * @param {Function} props.onSubmit - The submit function
 * @param {boolean} [props.invalid] - Whether the form is invalid
 * @param {boolean} [props.pristine] - Whether the form is pristine
 * @param {string} props.saveActionMsg - The save action message
 * @param {boolean} [props.updated] - Whether the form is updated
 * @param {boolean} [props.updateInProgress] - Whether the form is updating
 * @param {Object} [props.fetchErrors] - The fetch errors
 * @param {propTypes.currentUser} [props.currentUser] - The current user
 * @returns {JSX.Element}
 */
export const EditListingPricingForm = props => {
  const { currentUser } = props; // ✅ Extract currentUser BEFORE FinalForm
  
  return (
    <FinalForm
      mutators={{ ...arrayMutators }}
      {...props}
      render={formRenderProps => {
        const {
          formId = 'EditListingPricingForm',
          form: formApi,
          autoFocus,
          className,
          rootClassName,
          disabled,
          ready,
          handleSubmit,
          marketplaceCurrency,
          unitType,
          listingTypeConfig,
          isPriceVariationsInUse,
          listingMinimumPriceSubUnits = 0,
          invalid,
          pristine,
          saveActionMsg,
          updated,
          updateInProgress = false,
          fetchErrors,
          initialValues: formInitialValues,
          values: formValues,
        } = formRenderProps;

      const intl = useIntl();

      // ✅ Check if current user is a manual seller
      const sellerType = currentUser?.attributes?.profile?.publicData?.sellerType;
      const isManualSeller = sellerType === 'manual';
      
      // ✅ Use NGN for manual sellers, USD for others
      const displayCurrency = isManualSeller ? 'NGN' : marketplaceCurrency;

      console.log('=== EditListingPricingForm ===');
      console.log('Seller type:', sellerType);
      console.log('Is manual seller?', isManualSeller);
      console.log('Marketplace currency:', marketplaceCurrency);
      console.log('Display currency:', displayCurrency);
      console.log('==============================');

      const priceValidators = getPriceValidators(
        listingMinimumPriceSubUnits,
        displayCurrency, // ✅ Use displayCurrency for validation
        intl
      );

      const classes = classNames(rootClassName || css.root, className);
      const submitReady = (updated && pristine) || ready;
      const submitInProgress = updateInProgress;
      const submitDisabled = invalid || disabled || submitInProgress;
      const { transactionType } = listingTypeConfig || {};
      const { process } = transactionType || {};
      const isBooking = isBookingProcess(process);

      const isFixedLengthBooking = isBooking && unitType === FIXED;
      const isBookingPriceVariationsInUse = isBooking && isPriceVariationsInUse;
      
      // ✅ Force simple pricing for manual sellers (BookingPriceVariants doesn't support NGN well)
      const isUsingPriceVariants = isManualSeller 
        ? false 
        : (isFixedLengthBooking || isBookingPriceVariationsInUse);

      return (
        <Form onSubmit={handleSubmit} className={classes}>
          <ErrorMessages fetchErrors={fetchErrors} />

          {isUsingPriceVariants ? (
            <BookingPriceVariants
              formId={formId}
              formApi={formApi}
              autoFocus={autoFocus}
              className={css.input}
              marketplaceCurrency={displayCurrency} // ✅ Pass displayCurrency
              unitType={unitType}
              isPriceVariationsInUse={isBookingPriceVariationsInUse}
              initialLengthOfPriceVariants={formInitialValues?.priceVariants?.length || 0}
              listingMinimumPriceSubUnits={listingMinimumPriceSubUnits}
            />
          ) : (
            <FieldCurrencyInput
              id={`${formId}price`}
              name="price"
              className={css.input}
              autoFocus={autoFocus}
              label={intl.formatMessage(
                { id: 'EditListingPricingForm.pricePerProduct' },
                { unitType }
              )}
              placeholder={`Add a price in ${isManualSeller ? 'NGN' : 'USD'}...`}
              currencyConfig={appSettings.getCurrencyFormatting(displayCurrency)} // ✅ Use displayCurrency
              validate={priceValidators}
            />
          )}

          {isFixedLengthBooking ? (
            <StartTimeInterval
              name="startTimeInterval"
              idPrefix={`${formId}_startTimeInterval`}
              formValues={formValues}
              pristine={pristine}
            />
          ) : null}

          {isBooking ? (
            <div className={css.cautionFeeSection}>
              <FieldCurrencyInput
                id={`${formId}cautionFee`}
                name="cautionFee"
                className={css.input}
                label={intl.formatMessage({ id: 'EditListingPricingForm.cautionFeeLabel' })}
                placeholder={intl.formatMessage({ id: 'EditListingPricingForm.cautionFeePlaceholder' })}
                currencyConfig={appSettings.getCurrencyFormatting(displayCurrency)}
                validate={cautionFeeValidators}
              />
              <p className={css.cautionFeeHelper}>
                {intl.formatMessage({ id: 'EditListingPricingForm.cautionFeeHelperText' })}
              </p>
            </div>
          ) : null}

          <Button
            className={css.submitButton}
            type="submit"
            inProgress={submitInProgress}
            disabled={submitDisabled}
            ready={submitReady}
          >
            {saveActionMsg}
          </Button>
        </Form>
      );
    }}
  />
  );
};

export default EditListingPricingForm;