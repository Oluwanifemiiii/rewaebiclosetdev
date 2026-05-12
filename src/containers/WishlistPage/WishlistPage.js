import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { useConfiguration } from '../../context/configurationContext';
import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { types as sdkTypes } from '../../util/sdkLoader';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { getMarketplaceEntities } from '../../ducks/marketplaceData.duck';
import { toggleWishlistItem } from '../../ducks/wishlist.duck';

import {
  H3,
  Page,
  LayoutSingleColumn,
  ListingCard,
} from '../../components';

import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import css from './WishlistPage.module.css';

const { UUID } = sdkTypes;

/**
 * WishlistPage
 *
 * Displays the current user's wishlisted/liked listings in a card grid.
 *
 * @component
 * @param {Object} props
 * @param {Array} props.listings denormalised listing entities
 * @param {boolean} props.fetchInProgress
 * @param {Object?} props.fetchError
 * @param {boolean} props.scrollingDisabled
 * @param {Function} props.onToggleWishlistItem
 * @returns {JSX.Element}
 */
const WishlistPageComponent = props => {
  const {
    listings,
    fetchInProgress,
    fetchError,
    scrollingDisabled,
  } = props;

  const config = useConfiguration();
  const intl = useIntl();

  const title = intl.formatMessage({ id: 'WishlistPage.title' });
  const hasListings = listings && listings.length > 0;
  const hasNoResults = !fetchInProgress && !fetchError && !hasListings;

  const topbar = <TopbarContainer currentPage="WishlistPage" />;

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn topbar={topbar} footer={<FooterContainer />}>
        <H3 as="h1" className={css.title}>
          <FormattedMessage id="WishlistPage.heading" />
        </H3>

        {fetchError ? (
          <p className={css.error}>
            <FormattedMessage id="WishlistPage.fetchError" />
          </p>
        ) : null}

        {fetchInProgress ? (
          <p className={css.loading}>
            <FormattedMessage id="WishlistPage.loading" />
          </p>
        ) : null}

        {hasNoResults ? (
          <p className={css.empty}>
            <FormattedMessage id="WishlistPage.noListings" />
          </p>
        ) : null}

        {hasListings ? (
          <div className={css.listingCards}>
            {listings.map(l => (
              <ListingCard
                className={css.listingCard}
                key={l.id.uuid}
                listing={l}
                showAuthorInfo
              />
            ))}
          </div>
        ) : null}
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => {
  const { wishlistListingIds, fetchInProgress, fetchError } = state.wishlist;

  const listingRefs = wishlistListingIds.map(id => ({
    id: new UUID(id),
    type: 'listing',
  }));
  const listings = getMarketplaceEntities(state, listingRefs);

  return {
    listings,
    fetchInProgress,
    fetchError,
    scrollingDisabled: isScrollingDisabled(state),
  };
};

const mapDispatchToProps = dispatch => ({
  onToggleWishlistItem: listingId => dispatch(toggleWishlistItem(listingId)),
});

const WishlistPage = compose(
  connect(mapStateToProps, mapDispatchToProps)
)(WishlistPageComponent);

export default WishlistPage;
