import React, { useState } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { useIntl } from '../../util/reactIntl';
import { types as sdkTypes } from '../../util/sdkLoader';

import { isScrollingDisabled } from '../../ducks/ui.duck';

import {
  Page,
  LayoutSingleColumn,
  H3,
} from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import ManualPayoutDetailsForm from './ManualPayoutDetailsForm';

import css from './ManualPayoutDetailsPage.module.css';

const { UUID } = sdkTypes;

export const ManualPayoutDetailsPageComponent = props => {
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveInProgress, setSaveInProgress] = useState(false);
  
  const intl = useIntl();
  const { currentUser, scrollingDisabled, onUpdateBankDetails } = props;

  const existingBankDetails = currentUser?.attributes?.profile?.protectedData?.bankDetails || null;

  const handleSubmit = values => {
    const { bankName, accountNumber, accountName } = values;

    const bankDetails = {
      bankName,
      accountNumber,
      accountName,
      updatedAt: new Date().toISOString(),
    };

    // Call the Redux action
    onUpdateBankDetails(bankDetails)
      .then(() => {
        setSaveInProgress(false);
        setSaveSuccess(true);
        window.scrollTo(0, 0);
      })
      .catch(error => {
        console.error('Failed to save bank details:', error);
        setSaveInProgress(false);
        setSaveError(error);
      });
  };

  const pageTitle = intl.formatMessage({ id: 'ManualPayoutDetailsPage.title' });

  return (
    <Page title={pageTitle} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        topbar={<TopbarContainer />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          <div className={css.content}>
            <H3 as="h1" className={css.title}>
              {pageTitle}
            </H3>

            {saveSuccess && (
              <div className={css.success}>
                <div className={css.successIcon}>✅</div>
                <div className={css.successTitle}>
                  Bank Details Saved Successfully!
                </div>
                <p className={css.successMessage}>
                  Your payout information has been securely stored. You can now receive payments.
                </p>
              </div>
            )}

            {existingBankDetails && !saveSuccess && (
              <div className={css.currentDetails}>
                <div className={css.currentDetailsTitle}>Current Bank Details</div>
                <div className={css.detailRow}>
                  <span className={css.detailLabel}>Bank:</span>
                  <span className={css.detailValue}>{existingBankDetails.bankName}</span>
                </div>
                <div className={css.detailRow}>
                  <span className={css.detailLabel}>Account Number:</span>
                  <span className={css.detailValue}>
                    {existingBankDetails.accountNumber?.replace(/(\d{3})(\d{4})(\d{3})/, '$1•••••$3')}
                  </span>
                </div>
                <div className={css.detailRow}>
                  <span className={css.detailLabel}>Account Name:</span>
                  <span className={css.detailValue}>{existingBankDetails.accountName}</span>
                </div>
              </div>
            )}

            <ManualPayoutDetailsForm
              formId="ManualPayoutDetailsForm"
              onSubmit={handleSubmit}
              inProgress={saveInProgress}
              error={saveError}
              existingBankDetails={existingBankDetails}
              intl={intl}
            />
          </div>
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const { currentUser } = state.user;
  return {
    currentUser,
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const mapDispatchToProps = dispatch => ({
  onUpdateBankDetails: bankDetails => {
    // Dispatch a thunk that returns a promise
    return dispatch((dispatch, getState, sdk) => {
      const { currentUser } = getState().user;
      
      const updateParams = {
        protectedData: {
          ...currentUser?.attributes?.profile?.protectedData,
          bankDetails,
        },
      };

      return sdk.currentUser.updateProfile(updateParams);
    });
  },
});

const ManualPayoutDetailsPage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(ManualPayoutDetailsPageComponent);

export default ManualPayoutDetailsPage;