// src/containers/EbiArchivePage/EbiArchivePage.js
import React from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { isScrollingDisabled } from '../../ducks/ui.duck';
import { formatMoney } from '../../util/currency';

import { Page, LayoutSingleColumn, H2 } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import { fetchClosedListings } from './EbiArchivePage.duck';
import css from './EbiArchivePage.module.css';

// ─── Archive card ─────────────────────────────────────────────────────────────
//
// Uses the flat listing objects returned directly from our /api/closed-listings
// endpoint (pre-denormalized server-side), so we don't need marketplace entities.

const ArchiveCard = ({ listing, intl }) => {
  const { title, price, authorDisplayName, imageVariants, publicData } = listing;

  // Pick the best available variant (prefer listing-card-2x → listing-card → scaled-medium → first)
  const variantKeys = Object.keys(imageVariants || {});
  const preferOrder = ['listing-card-2x', 'listing-card', 'scaled-medium', 'scaled-small'];
  const bestVariant =
    preferOrder.find(k => variantKeys.includes(k)) || variantKeys[0] || null;
  const imageUrl = bestVariant ? imageVariants[bestVariant]?.url : null;

  const formattedPrice =
    price && price.amount != null && price.currency
      ? (() => {
          try {
            // Format as a plain currency string
            const formatter = new Intl.NumberFormat('en-US', {
              style: 'currency',
              currency: price.currency,
              minimumFractionDigits: 0,
            });
            // price.amount is in subunits (kobo / cents) — divide by 100
            return formatter.format(price.amount / 100);
          } catch {
            return `${price.currency} ${price.amount / 100}`;
          }
        })()
      : null;

  return (
    <div className={css.archiveCard}>
      <div className={css.imageWrapper}>
        {imageUrl ? (
          <img src={imageUrl} alt={title} className={css.image} />
        ) : (
          <div className={css.noImage} />
        )}
        <div className={css.closedBadge}>
          <FormattedMessage id="EbiArchivePage.closedBadge" />
        </div>
      </div>
      <div className={css.cardInfo}>
        <span className={css.cardTitle}>{title}</span>
        <span className={css.cardSeller}>{authorDisplayName}</span>
        {formattedPrice ? (
          <span className={css.cardPrice}>{formattedPrice}</span>
        ) : null}
      </div>
    </div>
  );
};

// ─── Page ─────────────────────────────────────────────────────────────────────

const EbiArchivePageComponent = ({
  scrollingDisabled,
  listings,
  pagination,
  fetchInProgress,
  fetchError,
  onFetchMore,
}) => {
  const intl = useIntl();

  const title = intl.formatMessage({ id: 'EbiArchivePage.title' });

  const hasMore =
    pagination &&
    pagination.page < pagination.totalPages;

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        topbar={<TopbarContainer currentPage="EbiArchivePage" />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          {/* Hero */}
          <div className={css.hero}>
            <H2 as="h1" className={css.heading}>
              <FormattedMessage id="EbiArchivePage.heading" />
            </H2>
            <p className={css.subheading}>
              <FormattedMessage id="EbiArchivePage.subheading" />
            </p>
          </div>

          {fetchInProgress && !listings.length ? (
            <p className={css.statusMsg}>
              <FormattedMessage id="EbiArchivePage.loading" />
            </p>
          ) : fetchError ? (
            <p className={css.errorMsg}>
              <FormattedMessage id="EbiArchivePage.error" />
            </p>
          ) : !listings.length ? (
            <p className={css.statusMsg}>
              <FormattedMessage id="EbiArchivePage.noListings" />
            </p>
          ) : (
            <>
              <div className={css.grid}>
                {listings.map(l => (
                  <ArchiveCard key={l.id} listing={l} intl={intl} />
                ))}
              </div>

              {hasMore ? (
                <div className={css.loadMoreWrapper}>
                  <button
                    type="button"
                    className={css.loadMoreBtn}
                    onClick={() => onFetchMore(pagination.page + 1)}
                    disabled={fetchInProgress}
                  >
                    {fetchInProgress ? (
                      <FormattedMessage id="EbiArchivePage.loading" />
                    ) : (
                      <FormattedMessage id="EbiArchivePage.loadMore" />
                    )}
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => ({
  scrollingDisabled: isScrollingDisabled(state),
  listings: state.EbiArchivePage?.listings || [],
  pagination: state.EbiArchivePage?.pagination || null,
  fetchInProgress: state.EbiArchivePage?.fetchInProgress || false,
  fetchError: state.EbiArchivePage?.fetchError || null,
});

const mapDispatchToProps = dispatch => ({
  onFetchMore: page => dispatch(fetchClosedListings(page)),
});

const EbiArchivePage = compose(connect(mapStateToProps, mapDispatchToProps))(
  EbiArchivePageComponent
);

export default EbiArchivePage;