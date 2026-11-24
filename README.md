# Project Orbit backend

NestJS 11 with the Express adapter, TypeScript, Mongoose and MongoDB. Implements the **clickable / simulated MVP** in the developer brief dated 20 November 2026. The consumer app remains in `../pilates`; this is a separate API project.

## Run

Use Node.js 22.11 or newer within Node 22 LTS (`22.x`), matching the Vercel runtime.

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

Seeding is explicit, additive, repeatable and limited to named demo records. It does not drop databases or overwrite edits. Once its completion marker exists, subsequent runs make no changes. Seeded image URLs use packaged backend raster files; workout media/booking URLs are deliberately nonfunctional `example.com` links. Replace these through the admin API with approved test content when available.

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

The prototype has hardcoded credentials in `src/admin-auth.ts`: username **`admin`**, password **`OrbitAdmin123!`**. Call `POST /api/v1/admin/auth/login` with `{ "username": "admin", "password": "OrbitAdmin123!" }` and use its returned `accessToken` in Swagger's **admin** Authorize field or as `Authorization: Bearer <accessToken>`. Login is limited to five attempts per minute per IP. Admin sessions expire after eight hours; `DELETE /api/v1/admin/auth/session` revokes the current token. Only token hashes are stored in MongoDB. Consumer tokens cannot access admin resources. Trusted API clients can also continue using the optional private `ADMIN_TOKEN` from `.env`. There are no studio or instructor self-service accounts.

Internal playtest staff may optionally use the fixed shared credentials **`staff` / `OrbitStaff123!`**. First create an anonymous session, then call `POST /api/v1/auth/login` with its bearer token and the shared credentials. This changes only that session's account type; session profile, bag and orders remain intact. `POST /api/v1/auth/logout` returns the session to guest mode. Staff sign-in does not grant admin access, and failed attempts are rate limited.

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

The React Native UI in `../pilates` consumes these APIs for onboarding, discovery, details, variants, cart, referral attribution, quotes, demo orders and internal admin management. Its `src/api/config.ts` uses `https://pilates-backend-sigma.vercel.app/api/v1` for development and release builds. The mobile entry screen requires staff/admin sign-in before opening the corresponding prototype journeys. The app never connects directly to MongoDB or bundles the admin token.

`npm run seed` also applies the additive `orbit-ui-v2` seed in `src/ui-seed-data.ts`. It adds the frontend's Core Collective / Mia Chen records, three Melbourne studios, two workouts, four products at their UI prices, studio-led affiliation and MIA10 / CORE-DEMO referral codes. Existing version-one records and admin edits are preserved. The `orbit-media-v3` migration replaces the UI records' original placeholder images with backend `/media/images/*` paths, while retaining custom image URLs. Images are served from `public/images`, which is also included in the Docker image. Completion markers are per seed version, so rerunning applies only missing versions. `GET /config` supplies onboarding areas, interest options and hero image URLs; `GET /referrals` lists available connections. The frontend contains no mock record or artwork lookup maps.

Implementation follows the official [NestJS Mongoose integration](https://docs.nestjs.com/techniques/mongodb), [validation](https://docs.nestjs.com/techniques/validation), and [Swagger setup](https://docs.nestjs.com/openapi/introduction).

### Reference UI and media repair (November 2026)

All seed generations now use packaged `/media/images/*` JPG/PNG artwork. Legacy `placehold.co` URLs defaulted to SVG, which the native mobile image component could not decode. The additive `orbit-media-v4` migration repairs known original URLs on both v1 and UI-v2 records, including databases already marked v3-complete. Custom artwork and archived/publication state are retained. Run `npm run seed` once per environment and restart the API to load the updated catalog code.

Workout discovery now includes instructor/studio context and searches instructor names, studio names, titles and descriptions. Products accept an optional validated `imageUrls` gallery (up to 12 URLs). `/config` supplies the illustrative workshop card; it is a concept, not a booking or a confirmed event date. Membership and checkout remain prototype concepts as documented in the mobile README.

## Deploy this backend to Vercel

Import this backend Git repository into Vercel. If importing a repository containing both projects, set **Root Directory** to `pilates-backend`. Deploy the backend separately from the React Native application.

| Setting | Value |
| --- | --- |
| Framework preset | Other (the checked-in `framework: null` disables automatic NestJS detection) |
| Node.js | 22.x |
| Install command | `MONGOMS_DISABLE_POSTINSTALL=1 npm ci --include=dev` |
| Build command | `npm run vercel-build` |
| Output directory | `public` |
| Function entry | `api/index.js` |

The install command includes TypeScript build dependencies while skipping the test-only MongoDB binary download. The checked-in `vercel.json` sets these build settings, routes requests to the function and includes compiled server files, backend artwork and Swagger assets. `api/index.js` loads TypeScript compiled by `tsc`, retaining the decorator metadata required by Nest's dependency injection. Do not replace it with an uncompiled TypeScript entry or override the project to the automatic NestJS preset.

### Environment and database

Set these values in Vercel **Project Settings → Environment Variables**, for each deployment environment that needs them. Local `.env` files are excluded from uploads and ignored at runtime when `VERCEL=1`.

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | Required MongoDB Atlas/replica-set URI including the target database name |
| `ADMIN_TOKEN` | Optional private API-client token, at least 32 characters; leave absent when using admin username/password login only |
| `CORS_ORIGINS` | Exact comma-separated web client origins; leave empty for native-only clients |
| `SESSION_TTL_DAYS` | Optional integer 1–90; default 30 |

Allow the deployment's outbound network access in Atlas and grant the database user read/write access to the selected database. An Atlas replica set is required for atomic demo checkout. Use separate named sample databases for Preview and Production so preview testing does not change production sessions/orders. Keep the existing prototype admin/staff credentials and access model in mind when choosing deployment access: this remains an internal simulated MVP. Process-local login/API throttles reset on cold starts and are not shared across instances; use Vercel's firewall/rate limiting if a deployment needs a global limit.

Run `npm run seed` once against the chosen database from a trusted local/CI environment before playtesting; configure that process with the target `MONGODB_URI`. Build and request handlers never seed the database. Seeding is additive and creates the indexes needed for unique tokens, referral codes and checkout idempotency. Do not run seeding as the Vercel build command.

### Runtime behavior

- `src/serverless.ts` caches one initialization promise per instance, so concurrent cold requests and warm requests share the Nest application and Mongoose pool. No persistent listener or shutdown signal hooks are registered by the function.
- MongoDB pools allow at most 10 connections per instance, start with no minimum connections, release idle sockets after 60 seconds and bound pool waits to 10 seconds. Autoscaling can create multiple independent pools.
- Initialization failure returns a generic, non-cacheable 503 and permits initialization to retry on a later request. Requests await completion of the Express response. Database details are not sent in error responses.
- Public `/media/images/*` URLs rewrite to `public/images/*` through Vercel static hosting, keeping seeded URLs unchanged. All other API/docs/unknown paths go through the serverless entry. Static images therefore do not require MongoDB to be online.
- `/docs`, `/docs/openapi.json`, authorization, request validation, the 64 KB JSON limit and CORS retain the same behavior as local startup. `npm start` still runs the normal local/container listener.
- The function duration is capped at 60 seconds. There are no background workers, local database files or request-time filesystem writes.

After deploying, check `https://YOUR-DEPLOYMENT/api/v1/health`, `/api/v1/config`, `/docs`, `/docs/openapi.json` and `/media/images/products/grip-socks-pink.png`. Exercise onboarding, add-to-bag and demo checkout against the seeded target database. If Vercel Deployment Protection is enabled, native app requests also need a permitted access path; a sign-in HTML response is not an API JSON response.

The mobile API URL in `../pilates/src/api/config.ts` is configured to `https://pilates-backend-sigma.vercel.app/api/v1`. Change it only when intentionally targeting a different environment.

Validation: `npm run check`, `npm run vercel-build`, and `npm test`. The serverless integration tests invoke the actual `api/index.js` entry and cover shared initialization, warm requests, authentication, validation, media/Swagger assets, CORS, a transactional demo checkout, and retry after a failed cold start. A hosted Vercel deployment is still required to verify platform routing and the target Atlas network configuration.

Configuration references: [Vercel Node.js functions](https://vercel.com/docs/functions/runtimes/node-js), [function files and rewrites](https://vercel.com/docs/project-configuration/vercel-json), and [NestJS serverless initialization](https://docs.nestjs.com/faq/serverless).

## Hosted integration audit · 23 November 2026

The supplied deployment is healthy, has the seeded Core Collective / Mia Chen / Reformer Reset records, and serves config/docs. However, catalog and other list endpoints currently return `400: property path should not exist`. Vercel forwards the `/:path*` rewrite capture as query metadata; Nest's strict query DTOs reject it. The prepared `src/serverless.ts` fix removes this reserved transport field from the URL and any pre-materialized request query before Nest receives the request, retaining actual filters and unknown-field validation. Two regression tests reproduce both runtime request shapes. Deploy the updated source to apply it; no reseeding is needed. Deployment is left to the user.

After deployment, run:

```sh
npm run verify:deployed -- --checkout --report docs/deployed-api-verification.json
```

The check defaults to the supplied deployed host; override `ORBIT_API_URL` when intentionally testing another environment. It reads seeded business/admin records, creates and revokes disposable consumer/admin sessions, and optionally creates one simulated order when `--checkout` is supplied. It never changes seeded catalog records or inventory. Demo order/event history is retained. The script exits nonzero on failed status/contracts and writes a token-free report.

`docs/deployed-api-verification.json` records the current hosted blocker. `docs/local-api-verification.json` records 100 passing requests against an isolated fresh local test database, including the complete simulated checkout. The backend's 40 HTTP integration tests pass. See `../API_INTEGRATION_AUDIT.md` for the complete brief-to-UI/API map and remaining hosted acceptance checks.
