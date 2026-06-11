// src/containers/ReviewsPage/ReviewsPage.duck.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { storableError } from '../../util/errors';

// ─── Fetch all community reviews ─────────────────────────────────────────────

const fetchCommunityReviewsPayloadCreator = async (_arg, thunkAPI) => {
  const { rejectWithValue } = thunkAPI;
  try {
    const res = await fetch('/api/community-reviews', { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    return rejectWithValue(storableError(e));
  }
};

export const fetchCommunityReviewsThunk = createAsyncThunk(
  'ReviewsPage/fetchCommunityReviews',
  fetchCommunityReviewsPayloadCreator
);

export const fetchCommunityReviews = () => dispatch =>
  dispatch(fetchCommunityReviewsThunk());

// ─── Submit a general review ──────────────────────────────────────────────────

const submitGeneralReviewPayloadCreator = ({ text, rating }, { rejectWithValue, extra: sdk }) => {
  return sdk.currentUser
    .updateProfile({
      publicData: {
        generalReview: {
          text,
          rating,
          createdAt: new Date().toISOString(),
        },
        hasGeneralReview: true,
      },
    })
    .then(() => ({ text, rating }))
    .catch(e => rejectWithValue(storableError(e)));
};

export const submitGeneralReviewThunk = createAsyncThunk(
  'ReviewsPage/submitGeneralReview',
  submitGeneralReviewPayloadCreator
);

export const submitGeneralReview = (text, rating) => dispatch =>
  dispatch(submitGeneralReviewThunk({ text, rating })).unwrap();

// ─── Slice ────────────────────────────────────────────────────────────────────

const reviewsSlice = createSlice({
  name: 'ReviewsPage',
  initialState: {
    transactionReviews: [],
    generalReviews: [],
    fetchInProgress: false,
    fetchError: null,
    submitInProgress: false,
    submitSuccess: false,
    submitError: null,
  },
  reducers: {
    resetSubmitState: state => {
      state.submitSuccess = false;
      state.submitError = null;
    },
  },
  extraReducers: builder => {
    // fetch
    builder.addCase(fetchCommunityReviewsThunk.pending, state => {
      state.fetchInProgress = true;
      state.fetchError = null;
    });
    builder.addCase(fetchCommunityReviewsThunk.fulfilled, (state, action) => {
      state.fetchInProgress = false;
      state.transactionReviews = action.payload.transactionReviews || [];
      state.generalReviews = action.payload.generalReviews || [];
    });
    builder.addCase(fetchCommunityReviewsThunk.rejected, (state, action) => {
      state.fetchInProgress = false;
      state.fetchError = action.payload;
    });

    // submit
    builder.addCase(submitGeneralReviewThunk.pending, state => {
      state.submitInProgress = true;
      state.submitSuccess = false;
      state.submitError = null;
    });
    builder.addCase(submitGeneralReviewThunk.fulfilled, state => {
      state.submitInProgress = false;
      state.submitSuccess = true;
    });
    builder.addCase(submitGeneralReviewThunk.rejected, (state, action) => {
      state.submitInProgress = false;
      state.submitError = action.payload;
    });
  },
});

export const { resetSubmitState } = reviewsSlice.actions;
export default reviewsSlice.reducer;

// ─── Load data (called on server-side render and client navigation) ───────────

export const loadData = () => dispatch => dispatch(fetchCommunityReviews());