# Project Orbit backend

NestJS 11 with the Express adapter, TypeScript, Mongoose and MongoDB. Implements the **clickable / simulated MVP** in the developer brief dated 20 November 2026. The consumer app remains in `../pilates`; this is a separate API project.

## Run

Use Node.js 22.11+ (Node 24 recommended).

```powershell
cd D:\mvp\pilates-backend
npm ci
# A local .env is already configured for the latest supplied Atlas cluster.
# On a new machine: Copy-Item .env.example .env, then set MONGODB_URI and ADMIN_TOKEN.
npm run seed
npm run build
npm start
```

- API: `http://127.0.0.1:4000/api/v1`
- Swagger UI: `http://127.0.0.1:4000/docs`
- OpenAPI JSON: `http://127.0.0.1:4000/docs/openapi.json`
- Database readiness: `GET /api/v1/health`

`npm run dev` compiles and watches the compiled server; run `npm run build` after TypeScript edits, or run `npx tsc --watch` in a second terminal. `npm test` compiles and runs HTTP integration tests against a temporary local MongoDB replica set. Its first run downloads a MongoDB binary into `.cache/`; it never uses the configured Atlas database.

## Environment

The ignored `.env` contains the supplied Atlas URI and a generated private admin token. `.env.example` contains placeholders only. Never embed `ADMIN_TOKEN` or database credentials in the React Native app. Atlas must allow the machine's outbound IP and the configured database user must have read/write permission to the `pilates-backend` database. Checkout uses MongoDB transactions and requires Atlas or another replica set; a standalone local MongoDB server is insufficient.

`HOST` defaults to `127.0.0.1`; set `0.0.0.0` when accessing the API from a physical device or container. `PORT` defaults to `4000`. `CORS_ORIGINS` is an exact, comma-separated browser-origin allowlist. Native React Native HTTP requests do not require CORS. Anonymous sessions expire after `SESSION_TTL_DAYS` (1–90; default 30).

Seeding is explicit, additive, repeatable and limited to named demo records. It does not drop databases or overwrite edits. Once its completion marker exists, subsequent runs make no changes. Demo image URLs use placeholders and workout media/booking URLs are deliberately nonfunctional `example.com` links. Replace these through the admin API with approved test content when available.

## Consumer flow

1. `POST /sessions` returns an anonymous session token, ID and expiry. Store the token in device secure storage. There is no account registration requirement in this brief.
2. Pass `Authorization: Bearer <session-token>` for personal endpoints. `PATCH /sessions/me` saves onboarding area or coordinates, interests, formats and completion. `GET /sessions/me` restores it; `DELETE /sessions/me` revokes access.
3. Browse `GET /workouts` with `format`, `level`, `interest`, `studioId`, `instructorId`, `search`, `page`, `limit`. Published sessions sort newest first. Detail at `/workouts/:id` includes the studio, instructors and product tags.
4. Browse `GET /studios` with `search`, `city`, `format`, `latitude`, `longitude`, `radiusKm`, `sort=nearest`, `page`, `limit`. Coordinates must be supplied together. Distance uses the Haversine formula. Studio detail includes branding, outbound URLs, affiliations and selected workouts. Instructor detail at `/instructors/:id` includes affiliations and workouts.
5. Enter the distinct `/shop` API environment: `GET /shop/collections`, `/shop/products`, `/shop/products/:id`. Products include variants, simulated availability and bundle components. Product filters: `search`, `collection`, `tag`, `sort=price-asc|price-desc`, `page`, `limit`.
6. `PUT /shop/cart/items` sets an absolute product/variant quantity. `GET /shop/cart` shows server-priced items. Remove via `DELETE /shop/cart/items/:productId/:variantId`, or clear with `DELETE /shop/cart`.
7. `GET /referrals/:code` resolves a demo referral and custom-scheme deep link. `POST /referrals/apply` attaches last-applied attribution to the session. Attribution is copied into order snapshots, with no commission calculation.
8. `POST /shop/checkout/quote` returns sample pricing. `POST /shop/checkout` with an `Idempotency-Key` header creates an atomic demo order and clears the cart. Retry the same key and body to retrieve the same result. Changed bodies with reused keys return 409. Order history and detail are session-private at `/shop/orders` and `/shop/orders/:id`.
9. `GET /offers?latitude=...&longitude=...` returns active, unexpired nearby studio partner or stockist offers. Without location it returns an empty list. Basic listed studios are ineligible.
10. Optional `POST /events` stores approved interaction names and `app` / `web` source locally for future analytics attribution. There is no Polar, GA or Klaviyo integration.

All paths above are relative to `/api/v1`. Lists return `{ data, pagination: { page, limit, total, pages } }`; default page size is 20, maximum 100. IDs are strings. Prices are integer minor currency units (2200 = AUD 22.00). Cart contents must share a currency.

### Example session and order

```powershell
$base = 'http://127.0.0.1:4000/api/v1'
$session = Invoke-RestMethod "$base/sessions" -Method Post
$headers = @{ Authorization = "Bearer $($session.token)" }
Invoke-RestMethod "$base/sessions/me" -Method Patch -Headers $headers -ContentType application/json -Body '{"area":"Fitzroy","interests":["strength"],"formats":["mat"],"onboardingComplete":true}'
Invoke-RestMethod "$base/shop/cart/items" -Method Put -Headers $headers -ContentType application/json -Body '{"productId":"product-socks","variantId":"socks-s","quantity":2}'
Invoke-RestMethod "$base/referrals/apply" -Method Post -Headers $headers -ContentType application/json -Body '{"code":"FITZROY-DEMO"}'
$body = '{"fulfillment":"warehouse-collect","source":"app","discountCode":"WELCOME15"}'
Invoke-RestMethod "$base/shop/checkout/quote" -Method Post -Headers $headers -ContentType application/json -Body $body
$headers['Idempotency-Key'] = [guid]::NewGuid().ToString()
Invoke-RestMethod "$base/shop/checkout" -Method Post -Headers $headers -ContentType application/json -Body $body
```

Sample discounts: `WELCOME15` gives 15% on the first demo order **per anonymous session**; `SEASON10` gives 10%. They do not stack. These demonstrate concepts and do not validate actual customer eligibility in Shopify/Klaviyo. Sample shipping is 800 minor units, free when the discounted subtotal is at least 7500 or fulfillment is `warehouse-collect`. This is a demo rule, not a real regional shipping/tax service. Prices are treated as tax-inclusive samples.

The cart is not a reservation. Availability is checked when quoting and checking out; there are no inventory decrements. Orders never accept card details or shipping addresses and never charge, ship, book or reserve anything. `fulfillment=warehouse-collect` demonstrates warehouse collection only; studio collection is unavailable.

## Internal admin API

Use `Authorization: Bearer <ADMIN_TOKEN>` with a trusted internal API client or Swagger. All `/admin/*` endpoints reject consumer session tokens. Admin is disabled if a valid token is not configured. There are no studio or instructor self-service accounts.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/overview` | Counts and demo order summary |
| GET / POST | `/admin/:kind` | List or create resources |
| GET / PATCH / DELETE | `/admin/:kind/:id` | Inspect, update or archive a resource |
| GET / POST | `/admin/affiliations` | List or link studio/instructor pairs |
| DELETE | `/admin/affiliations/:studioId/:instructorId` | Remove an unused affiliation |
| GET | `/admin/activity/events` | Local interaction and order attribution events |
| GET | `/admin/activity/audit` | Internal create/update/archive/link audit trail |
| GET | `/admin/activity/orders` | Demo order records |

`:kind` is one of `studios`, `instructors`, `workouts`, `products`, `referrals`, `offers`. Swagger documents each complete create schema; PATCH accepts a subset and validates the resulting full record. Unknown properties and null required values are rejected. DELETE archives by clearing `published` or `active`, retaining references and historical order snapshots.

Studio-led instructors appear publicly only when affiliated with a published studio. Independent instructors require `approvalStatus=approved` before publication. This is a manual MoveActive admin flag; approval criteria and a self-service approval workflow remain deferred. Workouts require existing studios, linked studio instructors or approved independents, and valid tagged products. Unpublished dependencies and future-dated workouts are hidden from discovery. Removing affiliations used by published workouts is blocked. Only partners and stockists can receive geo-offers.

Validation, a 64 KB JSON limit, security headers, exact-origin CORS, rate limiting (180 requests/minute per IP), hashed anonymous tokens, constant-time admin token comparison and scoped order queries are enabled. Errors return `{ error: { status, message }, timestamp }`. Rate limiting is process-local; this is intended for a single-instance internal prototype. The shared admin token is intentionally a prototype mechanism; multi-user admin identity and production infrastructure are future work.

## Scope coverage and deferred work

See [the scope map](docs/scope.md). No production Shopify, Syncio, Peoplevox, Collabs, Klaviyo, Polar Analytics, GA, payment provider or App Store integration is enabled. There are no community features, bookings, marketplace/waitlists, live studio inventory, B2B reordering, payouts, Apple IAP, or AI form correction.

The frontend is still the original React Native starter. To consume this API, use `http://10.0.2.2:4000/api/v1` on the Android emulator, `http://127.0.0.1:4000/api/v1` on an iOS simulator, or the host's LAN address on a physical device with `HOST=0.0.0.0`. Configure development HTTP access in the mobile platforms as needed. Never connect the mobile app directly to MongoDB.

Implementation follows the official [NestJS Mongoose integration](https://docs.nestjs.com/techniques/mongodb), [validation](https://docs.nestjs.com/techniques/validation), and [Swagger setup](https://docs.nestjs.com/openapi/introduction).
