import React from 'react';
import classNames from 'classnames';

import { FormattedMessage } from '../../../util/reactIntl';
import { Heading } from '../../../components';

import AddressLinkMaybe from './AddressLinkMaybe';

import css from './TransactionPanel.module.css';

// Functional component as a helper to build ActivityFeed section
const BookingLocationMaybe = props => {
  const { className, rootClassName, listing, showBookingLocation } = props;
  const classes = classNames(rootClassName || css.bookingLocationContainer, className);

  // ✅ DEBUG: Log everything
  console.log('=== BOOKING LOCATION DEBUG ===');
  console.log('showBookingLocation:', showBookingLocation);
  console.log('listing publicData:', listing?.attributes?.publicData);
  console.log('dressLocation:', listing?.attributes?.publicData?.dressLocation);
  console.log('==============================');

  if (showBookingLocation) {
    const publicData = listing?.attributes?.publicData || {};
    const location = publicData.location || {};
    const dressLocation = publicData.dresslocation;
    
    // ✅ If there's a dressLocation string, show it directly
    if (dressLocation) {
      return (
        <div className={classes}>
          <Heading as="h3" rootClassName={css.sectionHeading}>
            <FormattedMessage id="TransactionPanel.bookingLocationHeading" />
          </Heading>
          <div className={css.bookingLocationContent}>
            <p className={css.bookingLocationAddress}>{dressLocation}</p>
          </div>
        </div>
      );
    }
    
    // ✅ Otherwise, fall back to the standard location object
    return (
      <div className={classes}>
        <Heading as="h3" rootClassName={css.sectionHeading}>
          <FormattedMessage id="TransactionPanel.bookingLocationHeading" />
        </Heading>
        <div className={css.bookingLocationContent}>
          <AddressLinkMaybe
            linkRootClassName={css.bookingLocationAddress}
            location={location}
            geolocation={listing?.attributes?.geolocation}
            showAddress={true}
          />
        </div>
      </div>
    );
  }
  return null;
};

export default BookingLocationMaybe;