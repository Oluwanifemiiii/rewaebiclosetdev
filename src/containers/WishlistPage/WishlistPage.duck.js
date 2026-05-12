import { fetchWishlistListings } from '../../ducks/wishlist.duck';
import { fetchCurrentUser } from '../../ducks/user.duck';

export const loadData = (params, search, config) => (dispatch, getState, sdk) => {
  return dispatch(fetchCurrentUser()).then(() => {
    return dispatch(fetchWishlistListings(config));
  });
};
