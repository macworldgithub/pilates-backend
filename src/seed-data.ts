const image = (label: string) => `https://placehold.co/800x600?text=${encodeURIComponent(label + ' Demo')}`;
export const seedData: Record<string, any[]> = {
  Studio: [
    { _id: 'studio-melbourne', name: 'Orbit Fitzroy', description: 'Sample partner studio offering mindful mat and reformer classes.', imageUrl: image('Fitzroy'), city: 'Melbourne', country: 'AU', address: 'Sample address, Fitzroy VIC', latitude: -37.798, longitude: 144.978, formats: ['mat', 'reformer'], partnerType: 'partner', websiteUrl: 'https://example.com/fitzroy', bookingUrl: 'https://example.com/fitzroy/book', published: true },
    { _id: 'studio-sydney', name: 'Orbit Surry Hills', description: 'Sample stockist and mat Pilates studio.', imageUrl: image('Surry Hills'), city: 'Sydney', country: 'AU', address: 'Sample address, Surry Hills NSW', latitude: -33.885, longitude: 151.212, formats: ['mat'], partnerType: 'stockist', websiteUrl: 'https://example.com/surry-hills', bookingUrl: 'https://example.com/surry-hills/book', published: true },
    { _id: 'studio-london', name: 'Orbit Shoreditch', description: 'Sample UK reformer studio.', imageUrl: image('Shoreditch'), city: 'London', country: 'GB', address: 'Sample address, Shoreditch', latitude: 51.524, longitude: -0.079, formats: ['reformer'], partnerType: 'listed', websiteUrl: 'https://example.com/shoreditch', bookingUrl: 'https://example.com/shoreditch/book', published: true },
  ],
  Instructor: [
    { _id: 'instructor-ella', name: 'Ella Demo', bio: 'Sample studio-led mat and reformer instructor.', imageUrl: image('Ella'), independent: false, approvalStatus: 'approved', published: true },
    { _id: 'instructor-james', name: 'James Demo', bio: 'Sample studio-led mat instructor.', imageUrl: image('James'), independent: false, approvalStatus: 'approved', published: true },
    { _id: 'instructor-alex', name: 'Alex Demo', bio: 'Independent instructor awaiting MoveActive approval.', imageUrl: image('Alex'), independent: true, approvalStatus: 'pending', published: false },
  ],
  Product: [
    { _id: 'product-socks', title: 'Demo Grip Socks', description: 'Sample grip socks; availability is simulated.', imageUrl: image('Grip Socks'), collection: 'grip-socks', tags: ['pilates', 'essentials'], currency: 'AUD', variants: [{ id: 'socks-s', title: 'Small / Sage', price: 2200, available: true }, { id: 'socks-m', title: 'Medium / Sage', price: 2200, available: true }, { id: 'socks-l', title: 'Large / Sage', price: 2200, available: false }], bundleProductIds: [], published: true },
    { _id: 'product-ball', title: 'Demo Pilates Ball', description: 'Sample equipment for an at-home practice.', imageUrl: image('Pilates Ball'), collection: 'equipment', tags: ['mat', 'equipment'], currency: 'AUD', variants: [{ id: 'ball-sage', title: 'Sage', price: 2900, available: true }], bundleProductIds: [], published: true },
    { _id: 'product-bundle', title: 'Demo Starter Bundle', description: 'Grip socks and a Pilates ball together.', imageUrl: image('Starter Bundle'), collection: 'bundles', tags: ['bundle', 'essentials'], currency: 'AUD', variants: [{ id: 'bundle-sage', title: 'Sage / Small Socks', price: 4500, available: true }], bundleProductIds: ['product-socks', 'product-ball'], published: true },
  ],
  Workout: [
    { _id: 'workout-mat', title: 'Fresh Morning Mat Flow', description: 'Gentle full-body morning practice.', format: 'mat', level: 'beginner', durationMinutes: 20, interests: ['mobility', 'strength'], studioId: 'studio-melbourne', instructorIds: ['instructor-ella'], productIds: ['product-socks', 'product-ball', 'product-bundle'], imageUrl: image('Mat Flow'), videoUrl: 'https://example.com/demo/mat-flow.mp4', published: true, publishedAt: new Date('2026-11-20T08:00:00Z') },
    { _id: 'workout-reformer', title: 'Reformer Strength Reset', description: 'Curated reformer strength session.', format: 'reformer', level: 'intermediate', durationMinutes: 30, interests: ['strength', 'balance'], studioId: 'studio-melbourne', instructorIds: ['instructor-ella'], productIds: ['product-socks'], imageUrl: image('Reformer'), videoUrl: 'https://example.com/demo/reformer.mp4', published: true, publishedAt: new Date('2026-11-21T08:00:00Z') },
    { _id: 'workout-balance', title: 'Mindful Mat Balance', description: 'Balance and mobility flow.', format: 'mat', level: 'beginner', durationMinutes: 15, interests: ['balance', 'mobility'], studioId: 'studio-sydney', instructorIds: ['instructor-james'], productIds: ['product-bundle'], imageUrl: image('Balance'), videoUrl: 'https://example.com/demo/balance.mp4', published: true, publishedAt: new Date('2026-11-22T08:00:00Z') },
  ],
  Referral: [
    { _id: 'referral-fitzroy', code: 'FITZROY-DEMO', ownerType: 'studio', ownerId: 'studio-melbourne', active: true },
    { _id: 'referral-ella', code: 'ELLA-DEMO', ownerType: 'instructor', ownerId: 'instructor-ella', active: true },
  ],
  Offer: [{ _id: 'offer-fitzroy', studioId: 'studio-melbourne', title: 'Demo partner welcome offer', description: 'Sample partner offer; contact the studio through its website.', radiusKm: 25, active: true, expiresAt: new Date('2030-01-01T00:00:00Z') }],
};
