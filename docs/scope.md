# Brief-to-backend scope map

Source: Project Orbit MVP Developer Brief, 20 November 2026, supplied PDF. This document records implementation requirements from the brief; its process notes are not treated as commands to contact stakeholders or publish the prototype.

| Requirement | Implementation |
| --- | --- |
| Isolated test environment, sample data | Dedicated configured database, explicit idempotent seed, every checkout simulated |
| Onboarding location and interests | Anonymous sessions and persisted validated profile |
| Fresh curated Pilates content as primary journey | Published workout feed sorted by publish time, detail with tagged products |
| Studio directory, search, mat/reformer, nearest | Search and format/city filters, coordinate distance and radius filtering |
| Studio branding, location, formats, instructors, content, outbound link | Aggregated studio profile; HTTPS URLs, no booking engine |
| Instructor via studio, affiliations and content | Instructor profile with published studio affiliations and workout selection |
| Studio-led affiliation model | MoveActive-only admin affiliation management; public eligibility checks |
| Independent instructor approval | Manual internal admin approval status before public visibility; criteria deferred |
| Tagged products and purchase path | Workout product tags, separate D2C `/shop`, variants and bundles, cart and demo checkout |
| Referral unique link/code | Studio/instructor codes, custom-scheme demo links, last-applied session attribution and order snapshots |
| Basic MoveActive admin | Protected list/create/detail/update/archive APIs for studios, instructors, workouts, products, codes and offers |
| Geo offers reserved for partners and stockists | Eligibility validated by admin and rechecked in public nearby-offer reads |
| Shopify product/image/stock/transaction concepts | Sample catalog and order snapshots only; no live Shopify calls or inventory writes |
| Warehouse collection, no studio pickup | Demo warehouse-collect fulfillment enum only |
| Bundling visible | Seeded starter bundle and linked component products |
| Welcome and seasonal code concepts | Clearly simulated WELCOME15 / SEASON10, no stacking; first demo order per session |
| Future app/web sales attribution | Required source on checkout and local events; referral snapshot persisted |

## Deliberately deferred

- Community feeds, follows, comments, chat.
- Studio/instructor self-service portals and independent application workflows.
- Bookings, marketplace, waitlists.
- Live Shopify checkout, real inventory or transaction writes, live studio stock display.
- B2B wholesale ordering/restocking.
- Commission calculation/payouts or membership revenue-share rules.
- Apple in-app purchase rails, AI overlays/form correction.
- Premium/basic listing pricing, full mapping across six Shopify stores, live Polar/GA attribution.
- Beta release, contacting studios or stakeholders, and NDA/content acquisition.

## Implementation choices for internal playtesting

The brief does not prescribe account registration, shipping rates, currencies for each region, discount implementation, or a production authentication system. The backend uses anonymous sessions, a private internal admin token, AUD sample products with support for AUD/USD/GBP product records, flat demo shipping and session-scoped first-order eligibility. These choices are explicit demo behavior, not business policy for a production rollout. Photos, videos, booking destinations and studio addresses are placeholders. No real personal, payment, or studio stock data is required.
