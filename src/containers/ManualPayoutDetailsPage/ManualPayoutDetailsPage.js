import React, { useState } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import { useIntl } from '../../util/reactIntl';
import { IconArrowHead, SecondaryButton } from '../../components';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { types as sdkTypes, util as sdkUtil } from '../../util/sdkLoader';
import {
  Page,
  LayoutSingleColumn,
  H3,
  PrimaryButton,
} from '../../components';
import { useHistory } from 'react-router-dom';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';
import { createResourceLocatorString } from '../../util/routes';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import ManualPayoutDetailsForm from './ManualPayoutDetailsForm';

import css from './ManualPayoutDetailsPage.module.css';

const { UUID } = sdkTypes;

export const ManualPayoutDetailsPageComponent = props => {
  const history = useHistory();
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saveInProgress, setSaveInProgress] = useState(false);
  const routeConfiguration = useRouteConfiguration();
  const handleBack = () => {
    const payoutPagePath = createResourceLocatorString(
      'StripePayoutPage',
      routeConfiguration,
      {},
      { reset: 'true' } // Query params
    );
    history.push(payoutPagePath);
  };
  const intl = useIntl();
  const { currentUser, scrollingDisabled, onUpdateBankDetails } = props;

  const existingBankDetails = currentUser?.attributes?.profile?.protectedData?.bankDetails || null;

const handleSubmit = values => {
  setSaveInProgress(true);
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
      <LayoutSingleColumn topbar={<TopbarContainer />} footer={<FooterContainer />}>
        <div className={css.root}>
          <div className={css.content}>
            <div className={css.backButtonContainer}>
              <SecondaryButton onClick={handleBack}>
                <IconArrowHead direction="left" size="small" />
                {existingBankDetails ? 'Change Seller Type' : 'Back to Payout Options'}
              </SecondaryButton>
            </div>
            <H3 as="h1" className={css.title}>
              {pageTitle}
            </H3>

            {saveSuccess && (
              <div className={css.success}>
                <div className={css.successIcon}>✅</div>
                <div className={css.successTitle}>Bank Details Saved Successfully!</div>
                <p className={css.successMessage}>
                  Your payout information has been securely stored. You can now receive payments.
                </p>
                <div className={css.successActions}>
                  <PrimaryButton
                    onClick={() => {
                      window.location.href = '/';
                    }}
                  >
                    Go back to Rewa
                  </PrimaryButton>
                </div>
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
                    {existingBankDetails.accountNumber?.replace(
                      /(\d{3})(\d{4})(\d{3})/,
                      '$1•••••$3'
                    )}
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
        publicData: {
          ...currentUser?.attributes?.profile?.publicData,
          sellerType: 'manual', // ✅ Set sellerType on form submit
        },
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