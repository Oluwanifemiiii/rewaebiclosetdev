// src/containers/ReviewsPage/ReviewsPage.js
import React, { useState, useEffect } from 'react';
import { compose } from 'redux';
import { connect } from 'react-redux';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import { isScrollingDisabled } from '../../ducks/ui.duck';

import { Page, LayoutSingleColumn, H2, H3 } from '../../components';
import TopbarContainer from '../TopbarContainer/TopbarContainer';
import FooterContainer from '../FooterContainer/FooterContainer';

import {
  fetchCommunityReviews,
  submitGeneralReview,
  resetSubmitState,
} from './ReviewsPage.duck';
import css from './ReviewsPage.module.css';

// ─── Sub-components ───────────────────────────────────────────────────────────

const StarRating = ({ rating, max = 5 }) => (
  <span className={css.stars} aria-label={`${rating} out of ${max} stars`}>
    {Array.from({ length: max }, (_, i) => (
      <span key={i} className={i < rating ? css.starFilled : css.starEmpty}>
        ★
      </span>
    ))}
  </span>
);

const ReviewCard = ({ displayName, rating, content, createdAt, roleLabel }) => {
  const initials = (displayName || '?')
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  const formattedDate = createdAt
    ? new Date(createdAt).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';

  return (
    <div className={css.reviewCard}>
      <div className={css.reviewCardHeader}>
        <div className={css.avatar}>{initials}</div>
        <div className={css.reviewerMeta}>
          <span className={css.reviewerName}>{displayName}</span>
          {roleLabel ? <span className={css.roleLabel}>{roleLabel}</span> : null}
          <span className={css.reviewDate}>{formattedDate}</span>
        </div>
        <StarRating rating={rating} />
      </div>
      {content ? <p className={css.reviewContent}>{content}</p> : null}
    </div>
  );
};

// ─── Tab button ───────────────────────────────────────────────────────────────

const Tab = ({ id, active, onClick, children }) => (
  <button
    className={active ? `${css.tab} ${css.tabActive}` : css.tab}
    onClick={() => onClick(id)}
    type="button"
  >
    {children}
  </button>
);

// ─── General review form ──────────────────────────────────────────────────────

const GeneralReviewForm = ({ onSubmit, inProgress, success, error }) => {
  const [text, setText] = useState('');
  const [rating, setRating] = useState(0);
  const [hovered, setHovered] = useState(0);
  const intl = useIntl();

  useEffect(() => {
    if (success) {
      setText('');
      setRating(0);
    }
  }, [success]);

  const handleSubmit = e => {
    e.preventDefault();
    if (!rating || !text.trim()) return;
    onSubmit(text.trim(), rating);
  };

  return (
    <div className={css.reviewForm}>
      <H3 as="h2" className={css.reviewFormHeading}>
        <FormattedMessage id="ReviewsPage.leaveReviewHeading" />
      </H3>

      {success ? (
        <p className={css.successMsg}>
          <FormattedMessage id="ReviewsPage.reviewSubmitSuccess" />
        </p>
      ) : (
        <form onSubmit={handleSubmit}>
          {/* Star picker */}
          <div className={css.ratingRow}>
            <span className={css.ratingLabel}>
              <FormattedMessage id="ReviewsPage.reviewRatingLabel" />
            </span>
            <div className={css.starPicker}>
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  type="button"
                  className={n <= (hovered || rating) ? css.starActive : css.starInactive}
                  onMouseEnter={() => setHovered(n)}
                  onMouseLeave={() => setHovered(0)}
                  onClick={() => setRating(n)}
                  aria-label={`Rate ${n} stars`}
                >
                  ★
                </button>
              ))}
            </div>
          </div>

          {/* Text area */}
          <label className={css.textLabel} htmlFor="generalReviewText">
            <FormattedMessage id="ReviewsPage.reviewTextLabel" />
          </label>
          <textarea
            id="generalReviewText"
            className={css.textarea}
            rows={4}
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder={intl.formatMessage({ id: 'ReviewsPage.reviewTextPlaceholder' })}
          />

          {error ? (
            <p className={css.errorMsg}>
              <FormattedMessage id="ReviewsPage.reviewSubmitError" />
            </p>
          ) : null}

          <button
            type="submit"
            className={css.submitBtn}
            disabled={inProgress || !rating || !text.trim()}
          >
            {inProgress ? '…' : <FormattedMessage id="ReviewsPage.reviewSubmitButton" />}
          </button>
        </form>
      )}
    </div>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────

const TABS = { buyers: 'buyers', sellers: 'sellers', general: 'general' };

const ReviewsPageComponent = ({
  scrollingDisabled,
  transactionReviews,
  generalReviews,
  fetchInProgress,
  fetchError,
  submitInProgress,
  submitSuccess,
  submitError,
  isAuthenticated,
  onSubmitGeneralReview,
  onResetSubmit,
}) => {
  const intl = useIntl();
  const [activeTab, setActiveTab] = useState(TABS.buyers);

  const title = intl.formatMessage({ id: 'ReviewsPage.title' });

  const buyerReviews = transactionReviews.filter(r => r.type === 'ofProvider');
  const sellerReviews = transactionReviews.filter(r => r.type === 'ofCustomer');

  const renderReviewList = (reviews, roleLabel) => {
    if (!reviews.length) {
      return (
        <p className={css.empty}>
          <FormattedMessage id="ReviewsPage.noReviews" />
        </p>
      );
    }
    return (
      <div className={css.reviewGrid}>
        {reviews.map(r => (
          <ReviewCard
            key={r.id}
            displayName={r.authorDisplayName}
            rating={r.rating}
            content={r.content}
            createdAt={r.createdAt}
            roleLabel={roleLabel}
          />
        ))}
      </div>
    );
  };

  const renderGeneralTab = () => (
    <>
      {generalReviews.length ? (
        <div className={css.reviewGrid}>
          {generalReviews.map(r => (
            <ReviewCard
              key={r.id}
              displayName={r.displayName}
              rating={r.rating}
              content={r.text}
              createdAt={r.createdAt}
            />
          ))}
        </div>
      ) : (
        <p className={css.empty}>
          <FormattedMessage id="ReviewsPage.noGeneralReviews" />
        </p>
      )}

      {isAuthenticated ? (
        <GeneralReviewForm
          onSubmit={(text, rating) => {
            onSubmitGeneralReview(text, rating);
          }}
          inProgress={submitInProgress}
          success={submitSuccess}
          error={submitError}
        />
      ) : (
        <p className={css.loginPrompt}>
          <FormattedMessage id="ReviewsPage.loginToReview" />
        </p>
      )}
    </>
  );

  return (
    <Page title={title} scrollingDisabled={scrollingDisabled}>
      <LayoutSingleColumn
        topbar={<TopbarContainer currentPage="ReviewsPage" />}
        footer={<FooterContainer />}
      >
        <div className={css.root}>
          <div className={css.hero}>
            <H2 as="h1" className={css.heading}>
              <FormattedMessage id="ReviewsPage.heading" />
            </H2>
            <p className={css.subheading}>
              <FormattedMessage id="ReviewsPage.subheading" />
            </p>
          </div>

          {fetchInProgress ? (
            <p className={css.loading}>
              <FormattedMessage id="ReviewsPage.loading" />
            </p>
          ) : fetchError ? (
            <p className={css.errorMsg}>
              <FormattedMessage id="ReviewsPage.error" />
            </p>
          ) : (
            <>
              <div className={css.tabs}>
                <Tab id={TABS.buyers} active={activeTab === TABS.buyers} onClick={setActiveTab}>
                  <FormattedMessage
                    id="ReviewsPage.buyerReviewsTab"
                    values={{ count: buyerReviews.length }}
                  />
                </Tab>
                <Tab id={TABS.sellers} active={activeTab === TABS.sellers} onClick={setActiveTab}>
                  <FormattedMessage
                    id="ReviewsPage.sellerReviewsTab"
                    values={{ count: sellerReviews.length }}
                  />
                </Tab>
                <Tab id={TABS.general} active={activeTab === TABS.general} onClick={setActiveTab}>
                  <FormattedMessage
                    id="ReviewsPage.generalReviewsTab"
                    values={{ count: generalReviews.length }}
                  />
                </Tab>
              </div>

              <div className={css.tabContent}>
                {activeTab === TABS.buyers &&
                  renderReviewList(buyerReviews, 'Renter')}
                {activeTab === TABS.sellers &&
                  renderReviewList(sellerReviews, 'Seller')}
                {activeTab === TABS.general && renderGeneralTab()}
              </div>
            </>
          )}
        </div>
      </LayoutSingleColumn>
    </Page>
  );
};

const mapStateToProps = state => ({
  scrollingDisabled: isScrollingDisabled(state),
  isAuthenticated: state.auth.isAuthenticated,
  transactionReviews: state.ReviewsPage?.transactionReviews || [],
  generalReviews: state.ReviewsPage?.generalReviews || [],
  fetchInProgress: state.ReviewsPage?.fetchInProgress || false,
  fetchError: state.ReviewsPage?.fetchError || null,
  submitInProgress: state.ReviewsPage?.submitInProgress || false,
  submitSuccess: state.ReviewsPage?.submitSuccess || false,
  submitError: state.ReviewsPage?.submitError || null,
});

const mapDispatchToProps = dispatch => ({
  onSubmitGeneralReview: (text, rating) => dispatch(submitGeneralReview(text, rating)),
  onResetSubmit: () => dispatch(resetSubmitState()),
});

const ReviewsPage = compose(connect(mapStateToProps, mapDispatchToProps))(ReviewsPageComponent);

export default ReviewsPage;