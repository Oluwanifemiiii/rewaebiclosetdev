import React from 'react';
import { Form as FinalForm } from 'react-final-form';
import classNames from 'classnames';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import * as validators from '../../util/validators';

import {
  Form,
  PrimaryButton,
  FieldTextInput,
  IconSpinner,
  H4,
} from '../../components';

import css from './ManualPayoutDetailsPage.module.css';

const ManualPayoutDetailsForm = props => {
  const {
    formId,
    onSubmit,
    inProgress,
    error,
    existingBankDetails,
    intl,
  } = props;

  // Custom validators
  const numericString = message => value => {
    return value && !/^\d+$/.test(value) ? message : undefined;
  };

  const exactLength = (message, length) => value => {
    return value && value.length !== length ? message : undefined;
  };

  const accountNumberRequired = validators.required(
    intl.formatMessage({ id: 'ManualPayoutDetailsPage.accountNumberRequired' })
  );
  
  const accountNumberValid = validators.composeValidators(
    accountNumberRequired,
    numericString(
      intl.formatMessage({ id: 'ManualPayoutDetailsPage.accountNumberNumeric' })
    ),
    exactLength(
      intl.formatMessage({ id: 'ManualPayoutDetailsPage.accountNumberLength' }),
      10
    )
  );

  const bankRequired = validators.required(
    intl.formatMessage({ id: 'ManualPayoutDetailsPage.bankRequired' })
  );

  const accountNameRequired = validators.required(
    intl.formatMessage({ id: 'ManualPayoutDetailsPage.accountNameRequired' })
  );

  const initialValues = existingBankDetails || {};

  return (
    <FinalForm
      onSubmit={onSubmit}
      initialValues={initialValues}
      render={formRenderProps => {
        const { handleSubmit, pristine, invalid } = formRenderProps;
        const submitDisabled = pristine || invalid || inProgress;

        return (
          <Form onSubmit={handleSubmit}>
            <div className={css.formContainer}>
              <H4 as="h2" className={css.subTitle}>
                <FormattedMessage id="ManualPayoutDetailsPage.bankDetailsTitle" />
              </H4>
              
              <p className={css.description}>
                <FormattedMessage id="ManualPayoutDetailsPage.bankDetailsDescription" />
              </p>

              {/* ✅ CHANGED: Text input instead of dropdown for international support */}
              <FieldTextInput
                id={`${formId}.bankName`}
                name="bankName"
                type="text"
                label={intl.formatMessage({ id: 'ManualPayoutDetailsPage.bankNameLabel' })}
                placeholder="e.g., Access Bank, Standard Bank, Bank of America..."
                validate={bankRequired}
                className={css.field}
              />

              <FieldTextInput
                id={`${formId}.accountNumber`}
                name="accountNumber"
                type="text"
                label={intl.formatMessage({ id: 'ManualPayoutDetailsPage.accountNumberLabel' })}
                placeholder={intl.formatMessage({ 
                  id: 'ManualPayoutDetailsPage.accountNumberPlaceholder' 
                })}
                validate={accountNumberValid}
                className={css.field}
              />

              <FieldTextInput
                id={`${formId}.accountName`}
                name="accountName"
                type="text"
                label={intl.formatMessage({ id: 'ManualPayoutDetailsPage.accountNameLabel' })}
                placeholder={intl.formatMessage({ 
                  id: 'ManualPayoutDetailsPage.accountNamePlaceholder' 
                })}
                validate={accountNameRequired}
                className={css.field}
              />

              <div className={css.securityNote}>
                <p className={css.securityIcon}>🔒</p>
                <p className={css.securityText}>
                  <FormattedMessage id="ManualPayoutDetailsPage.securityNote" />
                </p>
              </div>

              {error && (
                <div className={css.error}>
                  <FormattedMessage id="ManualPayoutDetailsPage.saveFailed" />
                </div>
              )}

              <div className={css.submitButton}>
                <PrimaryButton type="submit" inProgress={inProgress} disabled={submitDisabled}>
                  {inProgress ? (
                    <IconSpinner />
                  ) : (
                    <FormattedMessage id="ManualPayoutDetailsPage.submitButton" />
                  )}
                </PrimaryButton>
              </div>
            </div>
          </Form>
        );
      }}
    />
  );
};

export default ManualPayoutDetailsForm;