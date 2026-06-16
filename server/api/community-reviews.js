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

// The Integration API has no /reviews/query endpoint, so reviews are collected
// through transactions.query with the reviews relationship included.
const fetchTransactionReviews = async integrationSdk => {
  const reviews = [];
  const userMap = {};
  let page = 1;
  let totalPages = 1;
  const maxPages = 20;

  while (page <= totalPages && page <= maxPages) {
    const res = await integrationSdk.transactions.query({
      include: ['reviews', 'reviews.author', 'reviews.subject'],
      perPage: 100,
      page,
    });
    (res.data.included || []).forEach(entity => {
      if (entity.type === 'review') {
        reviews.push(entity);
      } else if (entity.type === 'user') {
        const id = entity.id?.uuid || entity.id;
        if (id) userMap[id] = entity;
      }
    });
    totalPages = res.data.meta?.totalPages || 1;
    page += 1;
  }

  // The same review can appear under several queries — dedupe by id.
  const seen = new Set();
  const uniqueReviews = reviews.filter(r => {
    const id = r.id?.uuid || r.id;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return flattenReviews(
    uniqueReviews.filter(r => r.attributes?.state === 'public'),
    Object.values(userMap)
  ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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
    transactionReviews = await fetchTransactionReviews(integrationSdk);
  } catch (err) {
    console.error('[community-reviews] transaction reviews fetch failed:', err.message);
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