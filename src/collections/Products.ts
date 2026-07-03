import type { CollectionConfig } from 'payload'

export const Products: CollectionConfig = {
  slug: 'products',
  admin: {
    useAsTitle: 'productName',
    defaultColumns: ['productName', 'brandName', 'defaultCategory', 'averageRating', 'totalReviews'],
  },
  access: {
    read: () => true,
  },
  fields: [
    { name: 'productId', type: 'number', required: true, unique: true, index: true },
    { name: 'productName', type: 'text', required: true },
    { name: 'brandName', type: 'text', index: true },
    { name: 'url', type: 'text' },
    { name: 'activeDate', type: 'date' },

    // Categorization
    { name: 'defaultCategory', type: 'text', index: true },
    { name: 'categories', type: 'text', hasMany: true },

    // Pricing (kept as raw text — source mixes ranges and single prices in IDR)
    { name: 'priceRange', type: 'text' },
    { name: 'priceByCombinations', type: 'text' },
    { name: 'beautyPointEarned', type: 'number' },

    // Ratings & reviews
    { name: 'averageRating', type: 'number' },
    { name: 'totalReviews', type: 'number' },
    { name: 'ratingTypesStr', type: 'text' },
    { name: 'averageRatingByTypes', type: 'text' },

    // Engagement counters
    { name: 'totalRecommendedCount', type: 'number' },
    { name: 'totalRepurchaseMaybeCount', type: 'number' },
    { name: 'totalRepurchaseNoCount', type: 'number' },
    { name: 'totalRepurchaseYesCount', type: 'number' },
    { name: 'totalInWishlist', type: 'number' },
  ],
}
