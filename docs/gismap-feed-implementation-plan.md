# GISMap Feed — Phase 1 implementation plan

## Current architecture

GISMap Online is a static Cloudflare Assets application. The map workspace is
loaded from the root application and its reusable share code lives in
`js/share.js`, `js/map-share.js`, `js/briefing-share.js`, and `js/tour-share.js`.
Those modules already enforce HTTPS-only public layer URLs, reject credential
parameters, and encode Smart Map / Brief / Tour state in share URLs and QR
cards. GISMap SI is a FastAPI + PostGIS application with authenticated
workspaces; it is the persistence and moderation boundary for Feed content.

## Phase 1 vertical slice

The first release adds a separate, static `/feed/` application with:

- a mobile-first Discover feed, accessible filtering, search, skeleton,
  empty, and error states;
- clearly labelled GISMap development fixtures used only when the Feed API has
  no published content or is unavailable;
- stable client-side `/feed/p/:id` detail routes and a standalone
  `/feed/publish/` Smart Map submission flow;
- browser-only Smart Map validation and safe metadata inference. It never
  fetches the submitted URL, so it cannot be used as an SSRF proxy;
- a direct, additive **Publish to GISMap Feed** action in the existing Share &
  export dialog. It creates the standard Smart Map link with the existing
  serializer and carries it to Feed publish.

The feed initial page imports neither MapLibre nor the GISMap map application.
An original map opens only after the reader chooses **Explore map**.

## SI API contract

GISMap SI will expose `/api/v1/social`:

- `GET /posts` — public, cursor-paginated published posts, with type/tag/search
  filters and optional geographic bounding-box query;
- `GET /posts/{post_id}` — public detail for a known published or unlisted
  capability URL;
- `GET /featured`, `GET /tags` — public discovery metadata;
- `POST /preview` — unauthenticated, bounded local URL validation and metadata
  inference only; it never dereferences an arbitrary submitted URL;
- `POST /posts` — authenticated SI users only; creates `pending_review`, never
  an immediately public post.

The initial schema has profiles, posts, tags, source attribution, and the
future interaction tables. Only posts/tags/sources are active in Phase 1.
Public listing reads only `published` + `public` rows. Moderation is a manual
database/operational action until a dedicated dashboard is built.

## Publishing data flow

1. A creator makes a map, Brief, or Tour in GISMap Online.
2. Share & export calls the existing `createShareLink` path.
3. Feed publish receives the link and validates scheme, host, length,
   credentials, sensitive parameters, and recognized Smart Map conventions.
4. Preview derives only the artifact type and safe presentation metadata; no
   remote URL is fetched.
5. An authenticated SI submission is saved as `pending_review` with normalized
   tags and optional creator-supplied geographic metadata.
6. A moderator can transition it to `published`; only then does it appear in
   the public API.

## Security boundaries

- GISMap Online validates only `https://gismap.online` / `www.gismap.online`
  artifact URLs for Phase 1.
- Embedded credentials and token-like parameters are rejected before preview or
  persistence.
- SI validates independently; client validation is a convenience, not trust.
- No submitted source is fetched by the SI API in this release.
- Server-side post creation requires a current SI session and starts in manual
  review. Private workspaces and dataset publication capabilities remain
  separate from Feed posts.

## Deferred work

Accounts and profile editing, moderation UI, likes/comments/follows/bookmarks,
QR image decoding, media upload/transcoding, full geographic map Explore,
remixing, agent tools, per-post server-rendered social metadata, RSS, and a
sitemap are Phase 2+ work. The frontend keeps interfaces intentionally small
until those services are real.

## Test strategy

Add lightweight node tests for Feed URL validation, type inference, pagination
normalization, and the presence of a no-map-engine first load. Exercise the SI
API’s validation and visibility queries using the existing FastAPI/PostGIS
deployment flow. Manually verify narrow and desktop layouts, keyboard controls,
share-copy, invalid links, and a source link sent from Share & export.
