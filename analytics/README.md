# Salieri visitor map

The homepage stays on GitHub Pages. A separate Cloudflare Worker receives page visits, uses Cloudflare request geolocation, and stores aggregated daily visitor records in D1.

## Deploy

Use Node.js 22 or later. In this directory:

```bash
npm install
npx wrangler login --device --scopes account:read user:read workers:write workers_scripts:write d1:write
npx wrangler d1 create salieri-visitors
```

Put the returned `database_id` into `wrangler.jsonc`, then initialize the database:

```bash
npx wrangler d1 migrations apply salieri-visitors --remote
npx wrangler secret put VISITOR_SECRET
npx wrangler deploy
```

For `VISITOR_SECRET`, use a new random secret with at least 32 characters (for example generate one in a password manager). Enter it through the CLI prompt; never put it in `js/config.js`, source files, or a public repository. Changing it changes visitor identities and can increase estimated visitor counts until old data expires.

This deployment binds `stats.salieri.site` as a Worker custom domain through `routes` in `wrangler.jsonc`. The `salieri.site` zone must be active in the same Cloudflare account before deploying that route. Cloudflare creates the statistics hostname's DNS record and certificate; do not manually point it at GitHub Pages. Keep the apex GitHub Pages A records and the `www` CNAME in DNS-only mode. For a different domain, update the route, `ALLOWED_ORIGINS`, and the frontend endpoint together.

After deployment set `visitors.endpoint` in `../js/config.js` to the Worker HTTPS URL (`https://stats.salieri.site` for this site), without a trailing path. Verify HTTPS and CORS before publishing the homepage normally. A custom domain avoids relying on workers.dev, but reachability still varies by network. DNS alone is not a substitute for binding the hostname to the Worker.

No database data or credentials go into the GitHub repository. `wrangler.jsonc` contains public configuration only. Production accepts only the three explicit origins in `ALLOWED_ORIGINS`; a local preview is intentionally not counted. Add a localhost origin only to a separate development deployment if needed.

## What is counted

- A view is one accepted `/visit` request. Reloads from the same IP/browser within 10 seconds are suppressed.
- Visitors are distinct HMAC-SHA256 identifiers derived from IP + User-Agent using a server-only secret, deduplicated across the selected 7/30-day period. This is an estimate, not a count of physical people. NAT/proxies, browser changes, IP changes, and privacy settings affect it.
- Only Cloudflare-provided `request.cf` geolocation is used. Client-supplied geography is ignored. Coordinates are rounded to a 2-degree grid before storage/publication. Proxy/VPN locations can differ from a visitor's physical location.
- Views without location still contribute to totals. Unknown regions are listed separately and are not plotted at `(0, 0)`.
- Heat brightness/radius use a logarithmic scale based on view count; the right-hand list also ranks by views. The public endpoint exposes aggregates, never IP addresses or visitor hashes. The land map covers 85° N to 60° S; visits outside that range remain in totals.
- Known bot agents, requests without an IP/User-Agent, `DNT: 1`, and `Sec-GPC: 1` are not counted. The frontend also honors these privacy settings.
- Records older than 90 days are removed by a daily UTC cron. Timestamps/buckets use UTC. Public aggregates may be cached for 30 seconds.
- Raw IP addresses and full User-Agents are processed transiently for the HMAC, not stored in D1. Worker observability logging is disabled; Cloudflare still processes requests under its own service policies. Hashes are pseudonymous, not an absolute anonymity guarantee. The page discloses approximate IP-based aggregation.

Origin allowlisting prevents unrelated browser origins from writing, but is not authentication: a non-browser client can spoof Origin/User-Agent. This is a lightweight personal-site counter, not billing-grade or fraud-resistant analytics. For abuse at scale add Cloudflare WAF/rate limiting/Turnstile as appropriate, and monitor the account's resource usage.

## API

`POST /visit` (empty body) returns 204. The Worker reads IP and location from Cloudflare, not a submitted body. Requests need an allowed `Origin` header. Browser credentials/cookies are not used.

`GET /stats?days=7` or `?days=30` returns:

```json
{
  "version": 1,
  "days": 30,
  "updatedAt": "2026-10-27T00:00:00.000Z",
  "totals": { "visitors": 0, "pageviews": 0, "countries": 0, "mappedPageviews": 0 },
  "points": [],
  "countries": []
}
```

Each point contains `country`, `latitude`, `longitude`, `views`, and `visitors`. Each country contains `country`, `views`, and `visitors`. At most the 1000 most visited grid cells are returned.

## Verify

```bash
node worker.test.mjs
npx wrangler deploy --dry-run
```

Tests use actual SQLite in memory through a minimal D1 adapter, with no real IPs, accounts, or external requests. They cover UV deduplication across days, PV retry suppression, trusted geography, unknown coordinates, anonymous storage/public output, privacy preferences, origin/method validation, 7/30-day windows, and retention.

Read-only live check (does not increment the counter):

```bash
curl -H 'Origin: https://salieri.site' 'https://stats.salieri.site/stats?days=30'
```

Open the homepage normally to record a real visit. Do not send artificial visits to populate the public map. An empty map/zero totals is the correct state before real visitors arrive. If the endpoint is not configured, the page shows `--` rather than invented numbers.

## References

- Cloudflare request geolocation: https://developers.cloudflare.com/workers/runtime-apis/request/
- D1 migrations: https://developers.cloudflare.com/d1/wrangler-commands/
- Basemap provenance: `../assets/maps/SOURCE.md`
