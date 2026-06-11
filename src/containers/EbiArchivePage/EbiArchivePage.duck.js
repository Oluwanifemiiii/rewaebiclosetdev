// src/containers/EbiArchivePage/EbiArchivePage.duck.js
import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { storableError } from '../../util/errors';

// ─── Fetch closed listings ────────────────────────────────────────────────────

const fetchClosedListingsPayloadCreator = async ({ page = 1 } = {}, { rejectWithValue }) => {
  try {
    const res = await fetch(`/api/closed-listings?page=${page}`, { credentials: 'include' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    return rejectWithValue(storableError(e));
  }
};

export const fetchClosedListingsThunk = createAsyncThunk(
  'EbiArchivePage/fetchClosedListings',
  fetchClosedListingsPayloadCreator
);

export const fetchClosedListings = (page = 1) => dispatch =>
  dispatch(fetchClosedListingsThunk({ page }));

// ─── Slice ────────────────────────────────────────────────────────────────────

const ebiArchiveSlice = createSlice({
  name: 'EbiArchivePage',
  initialState: {
    listings: [],
    pagination: null,
    fetchInProgress: false,
    fetchError: null,
  },
  reducers: {},
  extraReducers: builder => {
    builder.addCase(fetchClosedListingsThunk.pending, state => {
      state.fetchInProgress = true;
      state.fetchError = null;
    });
    builder.addCase(fetchClosedListingsThunk.fulfilled, (state, action) => {
      state.fetchInProgress = false;
      state.listings = action.payload.listings || [];
      state.pagination = action.payload.meta || null;
    });
    builder.addCase(fetchClosedListingsThunk.rejected, (state, action) => {
      state.fetchInProgress = false;
      state.fetchError = action.payload;
    });
  },
});

export default ebiArchiveSlice.reducer;

// ─── loadData ─────────────────────────────────────────────────────────────────

export const loadData = () => dispatch => dispatch(fetchClosedListings(1));