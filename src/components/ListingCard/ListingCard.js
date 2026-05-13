import React from 'react';
import { useSelector, useDispatch } from 'react-redux';
import classNames from 'classnames';

import { useConfiguration } from '../../context/configurationContext';

import { FormattedMessage, useIntl } from '../../util/reactIntl';
import {
  displayPrice,
  isPriceVariationsEnabled,
  requireListingImage,
} from '../../util/configHelpers';
import { lazyLoadWithDimensions } from '../../util/uiHelpers';
import { formatMoney } from '../../util/currency';
import { ensureListing, ensureUser } from '../../util/data';
import { richText } from '../../util/richText';
import { createSlug } from '../../util/urlHelpers';
import { isBookingProcessAlias } from '../../transactions/transaction';

import { toggleWishlistItem, isListingWishlisted } from '../../ducks/wishlist.duck';

import {
  AspectRatioWrapper,
  NamedLink,
  ResponsiveImage,
  ListingCardThumbnail,
} from '../../components';

import css from './ListingCard.module.css';

const MIN_LENGTH_FOR_LONG_WORDS = 10;

const priceData = (price, currency, intl) => {
  if (price && (price.currency === currency || price.currency)) {
    try {
      const formattedPrice = formatMoney(intl, price);
      return { formattedPrice, priceTitle: formattedPrice };
    } catch (e) {
      return {
        formattedPrice: intl.formatMessage(
          { id: 'ListingCard.unsupportedPrice' },
          { currency: price.currency }
        ),
        priceTitle: intl.formatMessage(
          { id: 'ListingCard.unsupportedPriceTitle' },
          { currency: price.currency }
        ),
      };
    }
  } else if (price) {
    return {
      formattedPrice: intl.formatMessage(
        { id: 'ListingCard.unsupportedPrice' },
        { currency: price.currency }
      ),
      priceTitle: intl.formatMessage(
        { id: 'ListingCard.unsupportedPriceTitle' },
        { currency: price.currency }
      ),
    };
  }
  return {};
};

const LazyImage = lazyLoadWithDimensions(ResponsiveImage, { loadAfterInitialRendering: 3000 });

const PriceMaybe = props => {
  const { price, publicData, config, intl, listingTypeConfig } = props;
  const showPrice = displayPrice(listingTypeConfig);
  if (!showPrice && price) {
    return null;
  }

  const isPriceVariationsInUse = isPriceVariationsEnabled(publicData, listingTypeConfig);
  const hasMultiplePriceVariants = isPriceVariationsInUse && publicData?.priceVariants?.length > 1;

  const isBookable = isBookingProcessAlias(publicData?.transactionProcessAlias);
  const { formattedPrice, priceTitle } = priceData(price, config.currency, intl);

  const priceValue = <span className={css.priceValue}>{formattedPrice}</span>;
  const pricePerUnit = isBookable ? (
    <span className={css.perUnit}>
      <FormattedMessage id="ListingCard.perUnit" values={{ unitType: publicData?.unitType }} />
    </span>
  ) : (
    ''
  );

  return (
    <div className={css.price} title={priceTitle}>
      {hasMultiplePriceVariants ? (
        <FormattedMessage
          id="ListingCard.priceStartingFrom"
          values={{ priceValue, pricePerUnit }}
        />
      ) : (
        <FormattedMessage id="ListingCard.price" values={{ priceValue, pricePerUnit }} />
      )}
    </div>
  );
};

/**
 * WishlistButton
 * Heart icon overlay for toggling a listing in the user's wishlist.
 * Uses Redux directly via hooks so it works without prop-drilling.
 * @component
 */
const WishlistButton = ({ listingId }) => {
  const dispatch = useDispatch();
  const isAuthenticated = useSelector(state => state.auth.isAuthenticated);
  const isWishlisted = useSelector(state => isListingWishlisted(state, listingId));
  const toggleInProgress = useSelector(state => state.wishlist.toggleInProgress);

  if (!isAuthenticated) {
    return null;
  }

  const handleWishlistClick = e => {
    e.preventDefault();
    e.stopPropagation();

    if (!toggleInProgress) {
      dispatch(toggleWishlistItem(listingId));
    }
  };

  return (
    <button
      className={classNames(css.wishlistButton, {
        [css.wishlistButtonActive]: isWishlisted,
      })}
      onClick={handleWishlistClick}
      type="button"
      aria-label={isWishlisted ? 'Remove from wishlist' : 'Add to wishlist'}
    >
      <svg
        className={css.heartIcon}
        viewBox="0 0 24 24"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"
          fill={isWishlisted ? '#ef4444' : 'none'}
          stroke={isWishlisted ? '#ef4444' : '#ffffff'}
          strokeWidth="2"
        />
      </svg>
    </button>
  );
};

/**
 * ListingCardImage
 * Component responsible for rendering the image part of the listing card.
 * It either renders the first image from the listing's images array with lazy loading,
 * or a stylized placeholder if images are disabled for the listing type.
 * Also wraps the image in a fixed aspect ratio container for consistent layout.
 * @component
 * @param {Object} props
 * @param {Object} props.currentListing listing entity with image data
 * @param {Function?} props.setActivePropsMaybe mouse enter/leave handlers for map highlighting
 * @param {string} props.title listing title for alt text
 * @param {string} props.renderSizes img/srcset size rules
 * @param {number} props.aspectWidth aspect ratio width
 * @param {number} props.aspectHeight aspect ratio height
 * @param {string} props.variantPrefix image variant prefix (e.g. "listing-card")
 * @param {boolean} props.showListingImage whether to show actual listing image or not
 * @param {Object?} props.style the background color for the listing card with no image
 * @returns {JSX.Element} listing image with fixed aspect ratio or fallback preview
 */
const ListingCardImage = props => {
  const {
    currentListing,
    setActivePropsMaybe,
    title,
    renderSizes,
    aspectWidth,
    aspectHeight,
    variantPrefix,
    showListingImage,
    style,
  } = props;

  const firstImage =
    currentListing.images && currentListing.images.length > 0 ? currentListing.images[0] : null;
  const variants = firstImage
    ? Object.keys(firstImage?.attributes?.variants).filter(k => k.startsWith(variantPrefix))
    : [];

  // Render the listing image only if listing images are enabled in the listing type
  return showListingImage ? (
    <AspectRatioWrapper
      className={css.aspectRatioWrapper}
      width={aspectWidth}
      height={aspectHeight}
      {...setActivePropsMaybe}
    >
      <LazyImage
        rootClassName={css.rootForImage}
        alt={title}
        image={firstImage}
        variants={variants}
        sizes={renderSizes}
      />
    </AspectRatioWrapper>
  ) : (
    <ListingCardThumbnail
      style={style}
      listingTitle={title}
      className={css.aspectRatioWrapper}
      width={aspectWidth}
      height={aspectHeight}
      setActivePropsMaybe={setActivePropsMaybe}
    />
  );
};

/**
 * ListingCard
 *
 * @component
 * @param {Object} props
 * @param {string?} props.className add more style rules in addition to component's own css.root
 * @param {string?} props.rootClassName overwrite components own css.root
 * @param {Object} props.listing API entity: listing or ownListing
 * @param {string?} props.renderSizes for img/srcset
 * @param {Function?} props.setActiveListing
 * @param {boolean?} props.showAuthorInfo
 * @returns {JSX.Element} listing card to be used in search result panel etc.
 */
export const ListingCard = props => {
  const config = useConfiguration();
  const intl = props.intl || useIntl();

  const {
    className,
    rootClassName,
    listing,
    renderSizes,
    setActiveListing,
    showAuthorInfo = true,
  } = props;

  const currentListing = ensureListing(listing);
  const id = currentListing.id.uuid;
  const { title = '', price, publicData, state } = currentListing.attributes;
  const slug = createSlug(title);

  // ✅ Check if listing is closed
  const isClosed = state === 'closed';

  const author = ensureUser(listing.author);
  const authorName = author.attributes.profile.displayName;

  const { listingType, cardStyle } = publicData || {};
  const validListingTypes = config.listing.listingTypes;
  const foundListingTypeConfig = validListingTypes.find(conf => conf.listingType === listingType);
  const showListingImage = requireListingImage(foundListingTypeConfig);

  const {
    aspectWidth = 1,
    aspectHeight = 1,
    variantPrefix = 'listing-card',
  } = config.layout.listingImage;

  const setActivePropsMaybe = setActiveListing
    ? {
        onMouseEnter: () => setActiveListing(currentListing.id),
        onMouseLeave: () => setActiveListing(null),
      }
    : null;

  const classes = classNames(rootClassName || css.root, className, {
    [css.closedListing]: isClosed, // ✅ Add greyed out class
  });

  // ✅ Create click handler that prevents navigation for closed listings
  const handleClick = (e) => {
    if (isClosed) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return (
    <NamedLink 
      className={classes} 
      name="ListingPage" 
      params={{ id, slug }}
      onClick={handleClick} // ✅ Add click handler
    >
      <div className={css.wrapper}>
        {/* ✅ Closed badge */}
        {isClosed && (
          <div className={css.closedBadge}>
            <FormattedMessage id="ListingCard.closed" />
          </div>
        )}

        {/* Wishlist heart button */}
        <WishlistButton listingId={id} />
        
        <ListingCardImage
          renderSizes={renderSizes}
          title={title}
          currentListing={currentListing}
          config={config}
          setActivePropsMaybe={setActivePropsMaybe}
          aspectWidth={aspectWidth}
          aspectHeight={aspectHeight}
          variantPrefix={variantPrefix}
          style={cardStyle}
          showListingImage={showListingImage}
        />
      </div>
      
      <div className={css.info}>
        <PriceMaybe
          price={price}
          publicData={publicData}
          config={config}
          intl={intl}
          listingTypeConfig={foundListingTypeConfig}
        />
        <div className={css.mainInfo}>
          {showListingImage && (
            <div className={css.title}>
              {richText(title, {
                longWordMinLength: MIN_LENGTH_FOR_LONG_WORDS,
                longWordClass: css.longWord,
              })}
            </div>
          )}
          {showAuthorInfo ? (
            <div className={css.authorInfo}>
              <FormattedMessage id="ListingCard.author" values={{ authorName }} />
            </div>
          ) : null}
        </div>
      </div>
    </NamedLink>
  );
};

export default ListingCard;