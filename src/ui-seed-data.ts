// Matches the approved sample records and packaged artwork in ../pilates.
// IDs stay stable so cards, product variants, affiliations and referrals resolve consistently.
const files: Record<string, string> = {
  'Core Collective': 'studios/core-collective.jpg', 'The Pilates Room': 'studios/pilates-room.jpg',
  'Form and Flow': 'studios/form-flow.jpg', 'Mia Chen': 'instructors/mia-chen.jpg',
  'Sweetie Candy Pink': 'products/grip-socks-pink.png', 'Donut Ice Blue': 'products/grip-socks-blue.jpg',
  'Check Espresso Mat': 'products/yoga-mat-espresso.png', 'Pilates Starter Bundle': 'products/pilates-starter-bundle.jpg',
  'Reformer Reset': 'lifestyle/reformer-reset.jpg', 'Full Body Mat Flow': 'lifestyle/reformer-reset.jpg',
};
const image = (name: string) => `/media/images/${files[name]}`;
const studio = { city: 'Melbourne', country: 'AU', published: true, partnerType: 'partner', websiteUrl: 'https://example.com/studio', bookingUrl: 'https://example.com/studio/book' };
const product = { currency: 'AUD', published: true, bundleProductIds: [] };
export const uiSeedData: Record<string, any[]> = {
  Studio: [
    { ...studio, _id: 'core-collective', name: 'Core Collective', description: 'A welcoming neighbourhood studio built around strong foundations, expert coaching and joyful movement.', imageUrl: image('Core Collective'), address: '12 Greville Street, Prahran VIC', latitude: -37.8493, longitude: 144.9905, formats: ['reformer', 'mat'] },
    { ...studio, _id: 'pilates-room', name: 'The Pilates Room', description: 'A bright South Yarra space for mindful mat and reformer practice.', imageUrl: image('The Pilates Room'), address: 'Sample studio, South Yarra VIC', latitude: -37.839, longitude: 144.992, formats: ['reformer', 'mat'] },
    { ...studio, _id: 'form-flow', name: 'Form & Flow Studio', description: 'Thoughtful mat Pilates and strong foundations in Richmond.', imageUrl: image('Form and Flow'), address: 'Sample studio, Richmond VIC', latitude: -37.819, longitude: 145.0, formats: ['mat'], partnerType: 'stockist' },
  ],
  Instructor: [{ _id: 'mia-chen', name: 'Mia Chen', bio: 'Reformer specialist focused on strength, rehabilitation and joyful movement.', imageUrl: image('Mia Chen'), independent: false, approvalStatus: 'approved', published: true }],
  Product: [
    { ...product, _id: 'grip-socks-pink', title: 'Crew Grip Socks · Sweetie Candy Pink', description: 'Crew grip socks designed to support your Pilates practice. Sweetie Candy Pink.', imageUrl: image('Sweetie Candy Pink'), collection: 'grip-socks', tags: ['pilates', 'crew', 'essentials'], variants: [{ id: 'pink-s', title: 'S / Candy Pink', price: 2295, available: true }, { id: 'pink-m', title: 'M / Candy Pink', price: 2295, available: true }, { id: 'pink-l', title: 'L / Candy Pink', price: 2295, available: false }] },
    { ...product, _id: 'grip-socks-blue', title: 'Crew Grip Socks · Donut Ice Blue', description: 'Comfortable grip socks for your next studio session. Donut Ice Blue.', imageUrl: image('Donut Ice Blue'), collection: 'grip-socks', tags: ['pilates', 'crew', 'essentials'], variants: [{ id: 'blue-s', title: 'S / Ice Blue', price: 2295, available: true }, { id: 'blue-m', title: 'M / Ice Blue', price: 2295, available: true }, { id: 'blue-l', title: 'L / Ice Blue', price: 2295, available: true }] },
    { ...product, _id: 'yoga-mat-espresso', title: 'Microfibre Yoga Mat · Check Espresso', description: 'A thoughtful studio essential for your mat practice. Check Espresso.', imageUrl: image('Check Espresso Mat'), collection: 'mats', tags: ['mat', 'equipment'], variants: [{ id: 'mat-espresso', title: 'Check Espresso', price: 10900, available: true }] },
    { ...product, _id: 'starter-bundle', title: 'Pilates Starter Bundle', description: 'Pair your grip socks with a studio mat in one starter kit.', imageUrl: image('Pilates Starter Bundle'), collection: 'bundles', tags: ['bundle', 'equipment', 'essentials'], variants: [{ id: 'starter-pink-m', title: 'Pink M socks + Espresso mat', price: 12900, available: true }], bundleProductIds: ['grip-socks-pink', 'yoga-mat-espresso'] },
  ],
  Workout: [
    { _id: 'reformer-reset', title: '15-minute Reformer Reset', description: 'A calm full-body sequence for the days you need to reset, reconnect and move well.', format: 'reformer', level: 'beginner', durationMinutes: 15, interests: ['strength', 'relaxation'], studioId: 'core-collective', instructorIds: ['mia-chen'], productIds: ['grip-socks-pink', 'yoga-mat-espresso', 'starter-bundle'], imageUrl: image('Reformer Reset'), videoUrl: 'https://example.com/demo/reformer-reset.mp4', published: true, publishedAt: new Date('2026-11-23T00:00:00Z') },
    { _id: 'full-body-mat-flow', title: 'Full Body Mat Flow', description: 'Build strength, balance and flexibility with Mia in this full-body mat session.', format: 'mat', level: 'beginner', durationMinutes: 20, interests: ['strength', 'balance', 'flexibility'], studioId: 'core-collective', instructorIds: ['mia-chen'], productIds: ['grip-socks-blue', 'yoga-mat-espresso'], imageUrl: image('Full Body Mat Flow'), videoUrl: 'https://example.com/demo/full-body-mat-flow.mp4', published: true, publishedAt: new Date('2026-11-22T12:00:00Z') },
  ],
  Referral: [
    { _id: 'referral-mia', code: 'MIA10', ownerType: 'instructor', ownerId: 'mia-chen', active: true },
    { _id: 'referral-core', code: 'CORE-DEMO', ownerType: 'studio', ownerId: 'core-collective', active: true },
  ],
};
