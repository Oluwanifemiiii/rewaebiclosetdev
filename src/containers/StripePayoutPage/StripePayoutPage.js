import React, { useState } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';
import ManualPayoutDetailsPage from '../ManualPayoutDetailsPage/ManualPayoutDetailsPage';
import { useConfiguration } from '../../context/configurationContext';
import { useRouteConfiguration } from '../../context/routeConfigurationContext';
import { createResourceLocatorString } from '../../util/routes';
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { ensureCurrentUser } from '../../util/data';
import { propTypes } from '../../util/types';
import { showCreateListingLinkForUser, showPaymentDetailsForUser } from '../../util/userHelpers';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import {
  stripeAccountClearError,
  getStripeConnectAccountLink,
} from '../../ducks/stripeConnectAccount.duck';
import { useLocation } from 'react-router-dom';
import {
  H3,
  NamedRedirect,
  Page,
  StripeConnectAccountStatusBox,
  StripeConnectAccountForm,
  UserNav,
  LayoutSideNavigation,
  PrimaryButton,
  SecondaryButton,
  IconArrowHead,
} from '../../components';

import TopbarContainer from '../../containers/TopbarContainer/TopbarContainer';
import FooterContainer from '../../containers/FooterContainer/FooterContainer';

import { savePayoutDetails, setPayoutMethod } from './StripePayoutPage.duck';

import css from './StripePayoutPage.module.css';

const STRIPE_ONBOARDING_RETURN_URL_SUCCESS = 'success';
const STRIPE_ONBOARDING_RETURN_URL_FAILURE = 'failure';

// Create return URL for the Stripe onboarding form
const createReturnURL = (returnURLType, rootURL, routes) => {
  const path = createResourceLocatorString(
    'StripePayoutOnboardingPage',
    routes,
    { returnURLType },
    {}
  );
  const root = rootURL.replace(/\/$/, '');
  return `${root}${path}`;
};

// Get attribute: stripeAccountData
const getStripeAccountData = stripeAccount => stripeAccount.attributes.stripeAccountData || null;

// Get last 4 digits of bank account returned in Stripe account
const getBankAccountLast4Digits = stripeAccountData =>
  stripeAccountData && stripeAccountData.external_accounts.data.length > 0
    ? stripeAccountData.external_accounts.data[0].last4
    : null;

// Check if there's requirements on selected type: 'past_due', 'currently_due' etc.
const hasRequirements = (stripeAccountData, requirementType) =>
  stripeAccountData != null &&
  stripeAccountData.requirements &&
  Array.isArray(stripeAccountData.requirements[requirementType]) &&
  stripeAccountData.requirements[requirementType].length > 0;

// Redirect user to Stripe's hosted Connect account onboarding form
const handleGetStripeConnectAccountLinkFn = (getLinkFn, commonParams) => type => () => {
  getLinkFn({ type, ...commonParams })
    .then(url => {
      window.location.href = url;
    })
    .catch(err => console.error(err));
};

/**
 * StripePayoutPage component with two-button payout method selector
 */
export const StripePayoutPageComponent = props => {
  const config = useConfiguration();
  const routes = useRouteConfiguration();
  const location = useLocation(); 
  const intl = useIntl();
  const {
    currentUser,
    scrollingDisabled,
    getAccountLinkInProgress,
    getAccountLinkError,
    createStripeAccountError,
    updateStripeAccountError,
    fetchStripeAccountError,
    stripeAccountFetched,
    stripeAccount,
    onPayoutDetailsChange,
    onPayoutDetailsSubmit,
    onSetPayoutMethod,
    onGetStripeConnectAccountLink,
    payoutDetailsSaveInProgress,
    payoutDetailsSaved,
    params,
    authScopes,
  } = props;
    const searchParams = new URLSearchParams(location.search);
  const shouldReset = searchParams.get('reset') === 'true';
  
  const [selectedMethod, setSelectedMethod] = useState(shouldReset ? null : null);
  const sellerType = currentUser?.attributes?.profile?.publicData?.sellerType;
  const hasPayoutDetails = currentUser?.attributes?.profile?.protectedData?.bankDetails;
  const stripeConnected = !!stripeAccount?.id;

  // ✅ User has already chosen a method
  const hasChosenMethod = shouldReset ? false : (sellerType === 'manual' || stripeConnected);


  const handleSelectManual = () => {
    setSelectedMethod('manual');
    // Set sellerType in user's publicData
    onSetPayoutMethod('manual');
  };

  const handleSelectStripe = () => {
    setSelectedMethod('stripe');
  };

  const { returnURLType } = params || {};
  const ensuredCurrentUser = ensureCurrentUser(currentUser);
  const currentUserLoaded = !!ensuredCurrentUser.id;

  const title = intl.formatMessage({ id: 'StripePayoutPage.title' });

  const formDisabled = getAccountLinkInProgress;

  const rootURL = config.marketplaceRootURL;
  const successURL = createReturnURL(STRIPE_ONBOARDING_RETURN_URL_SUCCESS, rootURL, routes);
  const failureURL = createReturnURL(STRIPE_ONBOARDING_RETURN_URL_FAILURE, rootURL, routes);
 
  

  const accountId = stripeConnected ? stripeAccount.id : null;
  const stripeAccountData = stripeConnected ? getStripeAccountData(stripeAccount) : null;
  const requirementsMissing =
    stripeAccount &&
    (hasRequirements(stripeAccountData, 'past_due') ||
      hasRequirements(stripeAccountData, 'currently_due'));

  const savedCountry = stripeAccountData ? stripeAccountData.country : null;
  const savedAccountType = stripeAccountData ? stripeAccountData.business_type : null;

  const handleGetStripeConnectAccountLink = handleGetStripeConnectAccountLinkFn(
    onGetStripeConnectAccountLink,
    {
      accountId,
      successURL,
      failureURL,
    }
  );

  const returnedNormallyFromStripe = returnURLType === STRIPE_ONBOARDING_RETURN_URL_SUCCESS;
  const returnedAbnormallyFromStripe = returnURLType === STRIPE_ONBOARDING_RETURN_URL_FAILURE;
  const showVerificationNeeded = stripeConnected && requirementsMissing;

  // Check if user has limited rights and set button titles accordingly
  const limitedRights = authScopes?.indexOf('user:limited') >= 0;
  const stripeButtonTitle = limitedRights
    ? intl.formatMessage({ id: 'StripePayoutPage.submitButtonText' })
    : null;

  // Redirect from success URL to basic path for StripePayoutPage
  if (returnedNormallyFromStripe && stripeConnected && !requirementsMissing) {
    return <NamedRedirect name="StripePayoutPage" />;
  }

  // Failure url should redirect back to Stripe since it's most likely due to page reload
  if (returnedAbnormallyFromStripe && !getAccountLinkError) {
    handleGetStripeConnectAccountLink('custom_account_verification')();
  }

  const showManageListingsLink = showCreateListingLinkForUser(config, currentUser);
  const { showPayoutDetails, showPaymentMethods } = showPaymentDetailsForUser(config, currentUser);
  const accountSettingsNavProps = {
    currentPage: 'StripePayoutPage',
    showPaymentMethods,
    showPayoutDetails,
  };

  // ✅ Show manual payout page if user selected manual OR has manual set
    if (selectedMethod === 'manual' || (sellerType === 'manual' && !selectedMethod && !shouldReset)) {
    return <ManualPayoutDetailsPage {...props} />;
  }

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSideNavigation
        topbar={
          <>
            <TopbarContainer
              desktopClassName={css.desktopTopbar}
              mobileClassName={css.mobileTopbar}
            />
            <UserNav
              currentPage="StripePayoutPage"
              showManageListingsLink={showManageListingsLink}
            />
          </>
        }
        sideNav={null}
        useAccountSettingsNav
        accountSettingsNavProps={accountSettingsNavProps}
        footer={<FooterContainer />}
        intl={intl}
      >
        <div className={css.content}>
          <H3 as="h1" className={css.heading}>
            <FormattedMessage id="StripePayoutPage.heading" />
          </H3>

          {!currentUserLoaded ? (
            <FormattedMessage id="StripePayoutPage.loadingData" />
          ) : !hasChosenMethod && !selectedMethod ? (
            // ✅ Show two-button selector FIRST TIME ONLY
            <div className={css.payoutMethodSelector}>
              <p className={css.selectorDescription}>
                <FormattedMessage id="StripePayoutPage.choosePayoutMethod" />
              </p>

              <div className={css.buttonContainer}>
                <button className={css.methodButton} onClick={handleSelectManual}>
                  <div className={css.methodIcon}>🌍</div>
                  <div className={css.methodTitle}>
                    <FormattedMessage id="StripePayoutPage.manualMethodTitle" />
                  </div>
                  <div className={css.methodDescription}>
                    <FormattedMessage id="StripePayoutPage.manualMethodDescription" />
                  </div>
                </button>

                <button className={css.methodButton} onClick={handleSelectStripe}>
                  <div className={css.methodIcon}>💳</div>
                  <div className={css.methodTitle}>
                    <FormattedMessage id="StripePayoutPage.stripeMethodTitle" />
                  </div>
                  <div className={css.methodDescription}>
                    <FormattedMessage id="StripePayoutPage.stripeMethodDescription" />
                  </div>
                </button>
              </div>
            </div>
          ) : returnedAbnormallyFromStripe && !getAccountLinkError ? (
            <FormattedMessage id="StripePayoutPage.redirectingToStripe" />
          ) : (
            // ✅ Show Stripe form (user selected Stripe OR already has Stripe)
            <StripeConnectAccountForm
              rootClassName={css.stripeConnectAccountForm}
              disabled={formDisabled}
              inProgress={payoutDetailsSaveInProgress}
              ready={payoutDetailsSaved}
              currentUser={ensuredCurrentUser}
              stripeBankAccountLastDigits={getBankAccountLast4Digits(stripeAccountData)}
              savedCountry={savedCountry}
              savedAccountType={savedAccountType}
              submitButtonText={intl.formatMessage({
                id: 'StripePayoutPage.submitButtonText',
              })}
              stripeAccountError={
                createStripeAccountError || updateStripeAccountError || fetchStripeAccountError
              }
              stripeAccountLinkError={getAccountLinkError}
              stripeAccountFetched={stripeAccountFetched}
              onChange={onPayoutDetailsChange}
              onSubmit={onPayoutDetailsSubmit}
              onGetStripeConnectAccountLink={handleGetStripeConnectAccountLink}
              stripeConnected={stripeConnected}
              authScopes={authScopes}
            >
              {selectedMethod === 'stripe' && !stripeConnected && (
                <div className={css.backButtonContainer}>
                  <SecondaryButton
                    onClick={() => {
                      setSelectedMethod(null);
                    }}
                  >
                    <IconArrowHead direction="left" size="small" />
                    Back to Payout Options
                  </SecondaryButton>
                </div>
              )}
              {stripeConnected && !returnedAbnormallyFromStripe && showVerificationNeeded ? (
                <StripeConnectAccountStatusBox
                  type="verificationNeeded"
                  inProgress={getAccountLinkInProgress}
                  onGetStripeConnectAccountLink={handleGetStripeConnectAccountLink(
                    'custom_account_verification'
                  )}
                  disabled={limitedRights}
                  title={stripeButtonTitle}
                />
              ) : stripeConnected && savedCountry && !returnedAbnormallyFromStripe ? (
                <StripeConnectAccountStatusBox
                  type="verificationSuccess"
                  inProgress={getAccountLinkInProgress}
                  disabled={payoutDetailsSaveInProgress || limitedRights}
                  onGetStripeConnectAccountLink={handleGetStripeConnectAccountLink(
                    'custom_account_update'
                  )}
                  title={stripeButtonTitle}
                />
              ) : null}
            </StripeConnectAccountForm>
          )}
        </div>
      </LayoutSideNavigation>
    </Page>
  );
};

const mapStateToProps = state => {
  const {
    getAccountLinkInProgress,
    getAccountLinkError,
    createStripeAccountError,
    updateStripeAccountError,
    fetchStripeAccountError,
    stripeAccount,
    stripeAccountFetched,
  } = state.stripeConnectAccount;
  const { currentUser } = state.user;
  const { payoutDetailsSaveInProgress, payoutDetailsSaved } = state.StripePayoutPage;
  const { authScopes } = state.auth;
  return {
    currentUser,
    getAccountLinkInProgress,
    getAccountLinkError,
    createStripeAccountError,
    updateStripeAccountError,
    fetchStripeAccountError,
    stripeAccount,
    stripeAccountFetched,
    payoutDetailsSaveInProgress,
    payoutDetailsSaved,
    scrollingDisabled: isScrollingDisabled(state),
    authScopes,
  };
};

const mapDispatchToProps = dispatch => ({
  onPayoutDetailsChange: () => dispatch(stripeAccountClearError()),
  onPayoutDetailsSubmit: (values, isUpdateCall) =>
    dispatch(savePayoutDetails(values, isUpdateCall)),
  onGetStripeConnectAccountLink: params => dispatch(getStripeConnectAccountLink(params)),
  onSetPayoutMethod: (method) => dispatch(setPayoutMethod(method)),
});

const StripePayoutPage = compose(
  connect(
    mapStateToProps,
    mapDispatchToProps
  )
)(StripePayoutPageComponent);

export default StripePayoutPage;