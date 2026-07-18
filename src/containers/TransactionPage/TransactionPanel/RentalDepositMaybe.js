import React, { useEffect, useState } from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';
import { formatMoney } from '../../../util/currency';
import { types as sdkTypes } from '../../../util/sdkLoader';
import { PrimaryButton, SecondaryButtonInline } from '../../../components';

import css from './TransactionPanel.module.css';

const { Money } = sdkTypes;

// Booking states in which the provider may release the deposit hold. Before
// accepting, declining is the way to undo the hold (decline auto-releases it);
// releasing while a request is still pending would block the accept gate.
const RELEASABLE_STATES = [
  'accepted',
  'delivered',
  'reviewed',
  'reviewed-by-customer',
  'reviewed-by-provider',
];

const depositApi = (transactionId, action) =>
  fetch('/api/rental-deposit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ transactionId, action }),
  }).then(response => response.json().then(data => ({ ok: response.ok, data })));

/**
 * Rental deposit status for Stripe rentals, shown to both parties, with a
 * "Release deposit" action for the provider once the booking is underway.
 * The deposit is a manual-capture PaymentIntent on the platform account;
 * releasing cancels it, so the hold disappears from the customer's card.
 */
const RentalDepositMaybe = props => {
  const { className, rentalDeposit, transactionId, isProvider, processState, intl } = props;

  const [depositStatus, setDepositStatus] = useState(null); // Stripe PI status
  const [fetchError, setFetchError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [releaseInProgress, setReleaseInProgress] = useState(false);
  const [releaseError, setReleaseError] = useState(false);

  const paymentIntentId = rentalDeposit?.paymentIntentId;
  const txId = transactionId?.uuid || transactionId;

  useEffect(() => {
    if (!paymentIntentId || !txId) {
      return;
    }
    let mounted = true;
    depositApi(txId, 'status')
      .then(({ ok, data }) => {
        if (!mounted) return;
        if (ok && data.status) {
          setDepositStatus(data.status);
        } else {
          setFetchError(true);
        }
      })
      .catch(() => mounted && setFetchError(true));
    return () => {
      mounted = false;
    };
  }, [paymentIntentId, txId]);

  if (!paymentIntentId) {
    return null;
  }

  const onRelease = () => {
    setReleaseInProgress(true);
    setReleaseError(false);
    depositApi(txId, 'release')
      .then(({ ok, data }) => {
        setReleaseInProgress(false);
        setConfirming(false);
        if (ok && data.released) {
          setDepositStatus('canceled');
        } else {
          setReleaseError(true);
        }
      })
      .catch(() => {
        setReleaseInProgress(false);
        setReleaseError(true);
      });
  };

  const amountMaybe =
    rentalDeposit.amountSubunits && rentalDeposit.currency
      ? formatMoney(intl, new Money(rentalDeposit.amountSubunits, rentalDeposit.currency))
      : null;

  const isHeld = depositStatus === 'requires_capture';
  const statusMessageId = fetchError
    ? 'TransactionPanel.depositStatusUnknown'
    : !depositStatus
    ? 'TransactionPanel.depositStatusLoading'
    : isHeld
    ? 'TransactionPanel.depositStatusHeld'
    : depositStatus === 'canceled'
    ? 'TransactionPanel.depositStatusReleased'
    : depositStatus === 'succeeded'
    ? 'TransactionPanel.depositStatusClaimed'
    : 'TransactionPanel.depositStatusNotSecured';

  const showReleaseAction = isProvider && isHeld && RELEASABLE_STATES.includes(processState);

  return (
    <div className={classNames(css.rentalDepositSection, className)}>
      <h3 className={css.rentalDepositTitle}>
        <FormattedMessage id="TransactionPanel.depositHeading" />
      </h3>
      <p className={css.rentalDepositStatus}>
        <FormattedMessage id={statusMessageId} values={{ amount: amountMaybe }} />
      </p>
      {showReleaseAction ? (
        <div className={css.rentalDepositActions}>
          {confirming ? (
            <>
              <p className={css.rentalDepositHint}>
                <FormattedMessage id="TransactionPanel.depositReleaseHint" />
              </p>
              <PrimaryButton
                className={css.rentalDepositButton}
                inProgress={releaseInProgress}
                disabled={releaseInProgress}
                onClick={onRelease}
              >
                <FormattedMessage id="TransactionPanel.depositReleaseConfirmButton" />
              </PrimaryButton>
              <SecondaryButtonInline
                className={css.rentalDepositCancelButton}
                disabled={releaseInProgress}
                onClick={() => setConfirming(false)}
              >
                <FormattedMessage id="TransactionPanel.depositReleaseCancelButton" />
              </SecondaryButtonInline>
            </>
          ) : (
            <PrimaryButton className={css.rentalDepositButton} onClick={() => setConfirming(true)}>
              <FormattedMessage id="TransactionPanel.depositReleaseButton" />
            </PrimaryButton>
          )}
          {releaseError ? (
            <p className={css.rentalDepositError}>
              <FormattedMessage id="TransactionPanel.depositReleaseError" />
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default RentalDepositMaybe;
