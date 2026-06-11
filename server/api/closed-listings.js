// server/api/closed-listings.js
//
// GET /api/closed-listings?page=1
//
// Returns closed listings using the Integration API so that
// unauthenticated visitors can browse the Ebi Archive.

const { getIntegrationSdk } = require('../api-util/integrationSdk');

module.exports = async (req, res) => {
  try {
    const integrationSdk = getIntegrationSdk();

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = 24;

    const response = await integrationSdk.listings.query({
      state: 'closed',
      include: ['author', 'images'],
      'fields.listing': ['title', 'description', 'price', 'publicData', 'state'],
      'fields.user': ['profile.displayName', 'profile.abbreviatedName'],
      'fields.image': [
        'variants.scaled-small',
        'variants.scaled-medium',
        'variants.listing-card',
        'variants.listing-card-2x',
      ],
      page,
      perPage,
    });

    // Build a map of included entities for denormalization
    const included = response.data.included || [];
    const entityMap = {};
    included.forEach(e => {
      const id = e.id?.uuid || e.id;
      if (id) entityMap[id] = e;
    });

    // Flatten each listing into a simple object the component can use directly
    const listings = response.data.data.map(listing => {
      const { title, description, price, publicData, state } = listing.attributes;

      // Resolve author
      const authorRef = listing.relationships?.author?.data;
      const authorId = authorRef?.id?.uuid || authorRef?.id;
      const authorEntity = authorId ? entityMap[authorId] : null;
      const authorDisplayName =
        authorEntity?.attributes?.profile?.displayName || 'Unknown seller';

      // Resolve first image
      const imageRefs = listing.relationships?.images?.data || [];
      const firstImageId = imageRefs[0]?.id?.uuid || imageRefs[0]?.id;
      const firstImage = firstImageId ? entityMap[firstImageId] : null;
      const imageVariants = firstImage?.attributes?.variants || {};

      return {
        id: listing.id?.uuid || listing.id,
        title,
        description,
        price: price
          ? { amount: price.amount, currency: price.currency }
          : null,
        publicData,
        state,
        authorDisplayName,
        imageVariants,
      };
    });

    return res.json({
      listings,
      meta: response.data.meta,
    });
  } catch (err) {
    console.error('[closed-listings] Error:', err.message || err);
    return res.status(500).json({ error: 'Failed to fetch closed listings' });
  }
};