import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { types as sdkTypes, createImageVariantConfig } from '../util/sdkLoader';
import { storableError } from '../util/errors';
import { addMarketplaceEntities } from './marketplaceData.duck';
import { setCurrentUser } from './user.duck';
import { denormalisedResponseEntities } from '../util/data';

const { UUID } = sdkTypes;

// ================ Helper Functions ================ //

/**
 * Read the wishlist listing IDs from the current user's privateData.
 * Returns an empty array if there's no wishlist data.
 */
const getWishlistFromUser = currentUser => {
  return currentUser?.attributes?.profile?.privateData?.wishlistListingIds || [];
};

// ================ Async Thunks ================ //

//////////////////////////////
// Toggle Wishlist Item     //
//////////////////////////////

const toggleWishlistItemPayloadCreator = ({ listingId }, thunkAPI) => {
  const { getState, dispatch, rejectWithValue, extra: sdk } = thunkAPI;
  const { currentUser } = getState().user;

  if (!currentUser) {
    return rejectWithValue({ type: 'error', name: 'NotAuthenticated' });
  }

  const currentWishlist = getWishlistFromUser(currentUser);
  const listingIdStr = listingId.uuid || listingId;
  const isAlreadyWishlisted = currentWishlist.includes(listingIdStr);

  const updatedWishlist = isAlreadyWishlisted
    ? currentWishlist.filter(id => id !== listingIdStr)
    : [...currentWishlist, listingIdStr];

  const queryParams = {
    expand: true,
    include: ['profileImage'],
    'fields.image': ['variants.square-small', 'variants.square-small2x'],
  };

  return sdk.currentUser
    .updateProfile(
      {
        privateData: {
          wishlistListingIds: updatedWishlist,
        },
      },
      queryParams
    )
    .then(response => {
      const entities = denormalisedResponseEntities(response);
      if (entities.length !== 1) {
        throw new Error('Expected a resource in the sdk.currentUser.updateProfile response');
      }
      const currentUser = entities[0];

      // Update current user in global state
      dispatch(setCurrentUser(currentUser));

      return {
        wishlistListingIds: updatedWishlist,
        toggledListingId: listingIdStr,
        wasAdded: !isAlreadyWishlisted,
      };
    })
    .catch(e => rejectWithValue(storableError(e)));
};

export const toggleWishlistItemThunk = createAsyncThunk(
  'wishlist/toggleWishlistItem',
  toggleWishlistItemPayloadCreator
);

// Backward compatible wrapper
export const toggleWishlistItem = listingId => dispatch => {
  return dispatch(toggleWishlistItemThunk({ listingId })).unwrap();
};

//////////////////////////////////
// Fetch Wishlist Listings      //
//////////////////////////////////

const fetchWishlistListingsPayloadCreator = (config, thunkAPI) => {
  const { getState, dispatch, rejectWithValue, extra: sdk } = thunkAPI;
  const { currentUser } = getState().user;

  if (!currentUser) {
    return rejectWithValue({ type: 'error', name: 'NotAuthenticated' });
  }

  const wishlistIds = getWishlistFromUser(currentUser);

  if (!wishlistIds || wishlistIds.length === 0) {
    return Promise.resolve({ listingIds: [], totalItems: 0 });
  }

  const {
    aspectWidth = 1,
    aspectHeight = 1,
    variantPrefix = 'listing-card',
  } = config?.layout?.listingImage || {};
  const aspectRatio = aspectHeight / aspectWidth;

  return sdk.listings
    .query({
      ids: wishlistIds,
      include: ['author', 'author.profileImage', 'images'],
      'fields.listing': [
        'title',
        'price',
        'publicData',
        'state',
      ],
      'fields.user': ['profile.displayName', 'profile.abbreviatedName'],
      'fields.image': [
        'variants.scaled-small',
        'variants.scaled-medium',
        `variants.${variantPrefix}`,
        `variants.${variantPrefix}-2x`,
      ],
      ...createImageVariantConfig(`${variantPrefix}`, 400, aspectRatio),
      ...createImageVariantConfig(`${variantPrefix}-2x`, 800, aspectRatio),
      'limit.images': 1,
    })
    .then(response => {
      dispatch(addMarketplaceEntities(response));

      const listingIds = response.data.data.map(l => l.id);
      return {
        listingIds,
        totalItems: listingIds.length,
      };
    })
    .catch(e => rejectWithValue(storableError(e)));
};

export const fetchWishlistListingsThunk = createAsyncThunk(
  'wishlist/fetchWishlistListings',
  fetchWishlistListingsPayloadCreator
);

// Backward compatible wrapper
export const fetchWishlistListings = config => dispatch => {
  return dispatch(fetchWishlistListingsThunk(config)).unwrap();
};

// ================ Slice ================ //

const wishlistSlice = createSlice({
  name: 'wishlist',
  initialState: {
    wishlistListingIds: [],
    fetchInProgress: false,
    fetchError: null,
    toggleInProgress: false,
    toggleError: null,
  },
  reducers: {
    /**
     * Initialize wishlist IDs from current user profile (called when user loads).
     */
    setWishlistIds: (state, action) => {
      state.wishlistListingIds = action.payload || [];
    },
  },
  extraReducers: builder => {
    // Toggle wishlist item
    builder.addCase(toggleWishlistItemThunk.pending, state => {
      state.toggleInProgress = true;
      state.toggleError = null;
    });
    builder.addCase(toggleWishlistItemThunk.fulfilled, (state, action) => {
      state.toggleInProgress = false;
      state.wishlistListingIds = action.payload.wishlistListingIds;
    });
    builder.addCase(toggleWishlistItemThunk.rejected, (state, action) => {
      state.toggleInProgress = false;
      state.toggleError = action.payload;
    });

    // Fetch wishlist listings
    builder.addCase(fetchWishlistListingsThunk.pending, state => {
      state.fetchInProgress = true;
      state.fetchError = null;
    });
    builder.addCase(fetchWishlistListingsThunk.fulfilled, (state, action) => {
      state.fetchInProgress = false;
      state.wishlistListingIds = action.payload.listingIds.map(id => id.uuid);
    });
    builder.addCase(fetchWishlistListingsThunk.rejected, (state, action) => {
      state.fetchInProgress = false;
      state.fetchError = action.payload;
    });
  },
});

export const { setWishlistIds } = wishlistSlice.actions;

// ================ Selectors ================ //

export const isListingWishlisted = (state, listingId) => {
  const idStr = listingId?.uuid || listingId;
  return state.wishlist.wishlistListingIds.includes(idStr);
};

export default wishlistSlice.reducer;
