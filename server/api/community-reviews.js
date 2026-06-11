// server/api/community-reviews.js
//
// GET /api/community-reviews
//
// Returns a simplified, denormalized payload of:
//   - transactionReviews: all public buyer/seller reviews via Integration API
//   - generalReviews:     general platform reviews stored in user publicData
//
// Each query runs independently — a failure in one does NOT 500 the whole request.

const { getIntegrationSdk } = require('../api-util/integrationSdk');

// ─── Helpers ──────────────────────────────────────────────────────────────────

const buildIncludedMap = (included = []) => {
  const map = {};
  included.forEach(item => {
    const id = item.id?.uuid || item.id;
    if (id) map[id] = item;
  });
  return map;
};

const resolve = (map, ref) => {
  const id = ref?.data?.id?.uuid || ref?.data?.id;
  return id ? map[id] : null;
};

const flattenReviews = (data = [], included = []) => {
  const map = buildIncludedMap(included);
  return data.map(review => {
    const { type, rating, content, createdAt } = review.attributes || {};
    const authorEntity = resolve(map, review.relationships?.author);
    const subjectEntity = resolve(map, review.relationships?.subject);
    return {
      id: review.id?.uuid || review.id,
      type,
      rating,
      content,
      createdAt,
      authorDisplayName: authorEntity?.attributes?.profile?.displayName || 'Anonymous',
      subjectDisplayName: subjectEntity?.attributes?.profile?.displayName || 'Unknown',
    };
  });
};

const flattenGeneralReviews = (data = []) =>
  data
    .map(user => {
      const profile = user.attributes?.profile;
      const review = profile?.publicData?.generalReview;
      if (!review) return null;
      return {
        id: user.id?.uuid || user.id,
        displayName: profile.displayName || 'Anonymous',
        text: review.text || '',
        rating: review.rating || 0,
        createdAt: review.createdAt || '',
      };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

// ─── Handler ──────────────────────────────────────────────────────────────────

module.exports = async (req, res) => {
  const integrationSdk = getIntegrationSdk();

  // ── 1. Transaction reviews ────────────────────────────────────────────────
  let transactionReviews = [];
  try {
    const reviewsRes = await integrationSdk.reviews.query({
      state: 'public',
      include: ['author', 'subject'],
      perPage: 100,
    });
    transactionReviews = flattenReviews(
      reviewsRes.data.data,
      reviewsRes.data.included || []
    );
  } catch (err) {
    console.error('[community-reviews] reviews.query failed:', err.message);
    // Non-fatal — return empty array for this section
  }

  // ── 2. General reviews from user publicData ───────────────────────────────
  // NOTE: Sharetribe Integration API supports pub_ filtering on users.
  // If your marketplace version doesn't, the catch below returns [] gracefully.
  let generalReviews = [];
  try {
    const usersRes = await integrationSdk.users.query({
      pub_hasGeneralReview: true,
      perPage: 100,
    });
    generalReviews = flattenGeneralReviews(usersRes.data.data);
  } catch (err) {
    console.error('[community-reviews] users.query failed:', err.message);
    // Non-fatal — general reviews section just shows empty on first load
  }

  return res.json({ transactionReviews, generalReviews });
};