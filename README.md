# Paper Explainer Blog

A production-oriented research-paper explanation platform built on:

- GitHub Pages
- Cloudflare Workers
- Cloudflare D1
- Cloudflare KV
- Cloudflare Workers AI
- Google Gemini
- marked.js

The system accepts research-paper text, generates a structured explanation in Hindi or English, and allows the resulting explanation to be published as a public paper.

## 1. Architecture

```
                    ┌──────────────────────┐
                    │      GitHub Pages    │
                    │                      │
                    │  index.html          │
                    │  papers.html         │
                    │  paper.html          │
                    └──────────┬───────────┘
                               │ HTTPS
                               ▼
                    ┌──────────────────────┐
                    │ Cloudflare Worker    │
                    │                      │
                    │ /api/explain         │
                    │ /api/publish         │
                    │ /api/papers          │
                    │ /api/search          │
                    │ /api/stats           │
                    └──────┬───────┬───────┘
                           │       │
             ┌─────────────┘       └─────────────┐
             ▼                                   ▼
      ┌─────────────┐                     ┌──────────────┐
      │   Gemini    │                     │ Workers AI   │
      │ Primary AI  │                     │   Fallback   │
      └─────────────┘                     └──────────────┘

                           │
                           ▼
                    ┌──────────────┐
                    │ Cloudflare   │
                    │ D1           │
                    └──────────────┘

                           │
                           ▼
                    ┌──────────────┐
                    │ Cloudflare   │
                    │ KV           │
                    └──────────────┘
```

The frontend is static.

The Worker is an API service.

The Worker does not serve the public HTML application.

## 2. AI Routing

The explanation service uses a three-tier strategy.

### Tier 1 — Gemini

Gemini is attempted when:

1. `GEMINI_API_KEY` exists.
2. Daily Gemini usage is below the configured limit.

The configured daily request limit is:

`1450 requests/day`

The Gemini request timeout is:

`25 seconds`

### Tier 2 — Cloudflare Workers AI

Workers AI is automatically attempted when Gemini fails for any reason.

Examples:

- Gemini timeout
- Gemini HTTP error
- Gemini rate limit
- Gemini network error
- Gemini empty response
- Gemini unavailable
- Gemini daily quota exhausted

Workers AI model:

`@cf/meta/llama-3.1-8b-instruct`

### Tier 3 — HTTP 503

If both providers fail, the API returns:

`503 Service Unavailable`

The response does not expose provider secrets.

## 3. API Endpoints

### POST /api/explain

Generate an explanation.

Request:

```json
{
  "text": "Research paper text...",
  "lang": "en"
}
```

or:

```json
{
  "text": "Research paper text...",
  "lang": "hi"
}
```

Successful response:

```json
{
  "explanation": "...",
  "provider": "gemini",
  "model": "gemini-1.5-flash",
  "latencyMs": 1234,
  "tokensUsed": 1200
}
```

Workers AI responses additionally expose neuron usage when available:

```json
{
  "explanation": "...",
  "provider": "workers-ai",
  "model": "@cf/meta/llama-3.1-8b-instruct",
  "latencyMs": 1730,
  "neuronsUsed": 42
}
```

### POST /api/publish

Publish an explanation.

Example:

```json
{
  "title": "Understanding Cellular Senescence",
  "content": "# Cellular Senescence\n\n...",
  "lang": "en",
  "tags": ["aging", "biology"],
  "author": "Micromath"
}
```

The API creates or updates the corresponding author and tags and stores the paper in D1.

### GET /api/papers

Returns published papers.

Supported query parameters include:

- `page`
- `limit`
- `q`
- `lang`
- `tag`

Examples:

```
/api/papers?page=1&limit=12
/api/papers?q=longevity
/api/papers?lang=hi
/api/papers?tag=biology
```

### GET /api/papers/:slug

Returns one public paper.

A successful request also updates the paper view counter.

### DELETE /api/papers/:slug

Deletes a paper.

This endpoint requires the configured administrative bearer token.

### GET /api/tags

Returns available tags.

### GET /api/tags/:slug

Returns information for a specific tag.

### GET /api/authors/:slug

Returns information for a specific author.

### GET /api/search

Performs full-text search.

The database uses SQLite FTS5.

### GET /api/stats

Returns application statistics and provider usage information.

This endpoint requires administrative authorization.

### POST /api/explain-test

Administrative provider-testing endpoint.

This endpoint requires administrative authorization.

It can be used to test a specific AI provider without exposing provider credentials to the browser.

## 4. Required Cloudflare Resources

The application requires:

### D1

Create a Cloudflare D1 database:

```bash
npx wrangler d1 create paper-explainer-db
```

Record the database ID returned by Wrangler.

### KV

Create a Cloudflare KV namespace:

```bash
npx wrangler kv namespace create PAPER_EXPLAINER_KV
```

Record the namespace ID returned by Wrangler.

### Workers AI

Workers AI must be enabled for the Cloudflare account used for the Worker.

The Worker uses the AI binding:

`AI`

## 5. Database Initialization

Apply the schema locally:

```bash
npx wrangler d1 execute paper-explainer-db --local --file=schema.sql
```

Apply the schema remotely:

```bash
npx wrangler d1 execute paper-explainer-db --remote --file=schema.sql
```

The remote command modifies the production D1 database.

Verify:

```bash
npx wrangler d1 execute paper-explainer-db --remote --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"
```

## 6. Environment Variables and Secrets

The Worker requires:

- `GEMINI_API_KEY`
- `ADMIN_TOKEN`
- `ALLOWED_ORIGIN`

`GEMINI_API_KEY` and `ADMIN_TOKEN` are secrets.

`ALLOWED_ORIGIN` is the public GitHub Pages origin.

Do not put `GEMINI_API_KEY` or `ADMIN_TOKEN` into:

- HTML
- JavaScript
- GitHub Pages
- Git
- client-side configuration
- browser localStorage
- browser sessionStorage

### Configure Gemini Secret

```bash
npx wrangler secret put GEMINI_API_KEY
```

Wrangler will request the secret interactively.

Do not commit the key to Git.

### Configure Admin Token

```bash
npx wrangler secret put ADMIN_TOKEN
```

Generate a long random token with Node.js:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

### Configure Allowed Origin

For a GitHub Pages deployment such as:

`https://username.github.io`

configure:

`ALLOWED_ORIGIN=https://username.github.io`

For a custom domain, use that exact origin.

Do not include a trailing path or slash.

Examples:

`https://example.com`

not:

`https://example.com/`

and not:

`https://example.com/papers`

## 7. Frontend API Configuration

The static frontend reads:

`window.PAPER_EXPLAINER_API_BASE`

before falling back to an empty value.

For a cross-origin GitHub Pages deployment, configure the actual Worker API URL before publishing the frontend.

Example:

```html
<script>
window.PAPER_EXPLAINER_API_BASE =
  "https://actual-worker-domain.workers.dev";
</script>
```

The actual production Worker hostname is deployment-specific and must come from the Cloudflare deployment.

## 8. Local Development

Install dependencies:

```bash
npm install
```

Start the Worker:

```bash
npx wrangler dev
```

Serve the static frontend separately, for example:

```bash
npx serve public
```

The browser frontend must point to the local Worker endpoint during local development.

## 9. Production Deployment

Deploy the Worker:

```bash
npx wrangler deploy
```

After deployment, Wrangler reports the Worker URL.

Verify:

```bash
curl https://YOUR_WORKER_DOMAIN/api/stats
```

Administrative endpoints require the appropriate authorization header.

## 10. GitHub Pages Deployment

The public directory contains:

```
public/index.html
public/papers.html
public/paper.html
```

Configure GitHub Pages to publish the `public` directory through the repository's Pages configuration or deployment workflow.

The frontend is deployed independently from the Worker.

## 11. Security Model

### CORS

The Worker checks the request origin against `ALLOWED_ORIGIN`.

Unknown browser origins are rejected.

### Rate limiting

The explanation API uses KV-backed per-IP rate limiting.

Configured limit:

`5 requests/minute/IP`

The source IP is hashed before it is used as a KV key.

The raw IP address is not stored as the rate-limit key.

### Administrative authorization

Administrative operations require:

```
Authorization: Bearer <ADMIN_TOKEN>
```

The administrative token is stored as a Cloudflare Worker secret.

It is never returned to clients.

### Input validation

The Worker validates request bodies, language, paper text, title, tags, author, slug, pagination parameters, and search parameters.

Invalid input results in a 400 response.

### SQL injection protection

Database values are passed through D1 parameterized queries.

User-controlled values are not interpolated directly into SQL statements.

### Full-text search

Search queries are normalized before being passed to the FTS5 query.

## 12. Markdown Security

The frontend renders generated content using marked.js.

The backend-generated content is treated as untrusted input.

The application must not treat Markdown as trusted HTML.

If arbitrary user-generated HTML is enabled in future versions, an HTML sanitizer must be introduced before rendering.

## 13. AI Failure Handling

The routing sequence is:

```
Request
   │
   ▼
Gemini available?
   │
   ├── No ───────────────┐
   │                     │
   ▼                     │
Gemini                   │
   │                     │
   ├── Success ──► Return│
   │                     │
   └── Failure ──────────┤
                         ▼
                    Workers AI
                         │
                         ├── Success ──► Return
                         │
                         └── Failure ──► 503
```

A Gemini failure does not immediately fail the user request.

## 14. Gemini Daily Usage

The application maintains a daily Gemini usage counter in KV.

Configured threshold:

`1450 requests/day`

The counter is namespaced by UTC date.

Example key:

`gemini:usage:2026-09-21`

The value is automatically expired.

## 15. Workers AI Neuron Accounting

Workers AI usage is tracked in KV.

The AI module records estimated neuron consumption when the provider response does not expose a direct usage value.

This tracking is intended for application-level accounting and monitoring. It is not a replacement for Cloudflare billing data.

## 16. Provider Statistics

Provider statistics are stored separately in KV.

The system tracks:

- Gemini successful requests
- Workers AI successful requests
- Gemini usage
- Workers AI neuron usage

These values support the administrative statistics endpoint.

## 17. Cost Model

The application has two independent AI cost paths.

### Gemini

Gemini usage is controlled by the application-level daily limit of 1450 requests/day.

Actual Gemini billing depends on the Google AI service configuration and model pricing associated with the API account.

The application-level limit does not guarantee a specific monetary cost.

### Workers AI

Workers AI usage is measured in Neurons.

Actual monetary cost depends on the Cloudflare account's current Workers AI pricing and usage.

Application-side neuron tracking is for operational accounting.

### Cloudflare D1

D1 costs depend on:

- rows read
- rows written
- database storage
- account plan
- current Cloudflare pricing

### Cloudflare KV

KV costs depend on:

- reads
- writes
- stored data
- account plan
- current Cloudflare pricing

## 18. Troubleshooting

### Gemini always falls back

Check:

```bash
npx wrangler secret list
npx wrangler tail
```

Verify that `GEMINI_API_KEY` exists.

### Workers AI fails

Verify that the Worker contains the AI binding:

```toml
[ai]
binding = "AI"
```

Also verify that Workers AI is enabled for the Cloudflare account.

### CORS error

Check `ALLOWED_ORIGIN`.

The value must exactly match the browser origin.

For example:

`https://example.github.io`

is different from:

`https://www.example.github.io`

### Papers page is empty

Check the API directly:

```bash
curl "https://YOUR_WORKER_DOMAIN/api/papers"
```

If the API returns papers but the browser does not display them, verify the frontend API base configuration.

### Individual paper returns 404

Check:

```
paper.html?slug=<slug>
```

Then query:

```bash
curl "https://YOUR_WORKER_DOMAIN/api/papers/<slug>"
```

### Publish returns 401

Verify:

- `ADMIN_TOKEN`
- Authorization header
- Bearer token
- Worker secret configuration

### Publish returns 429

The request has exceeded the configured rate limit.

Wait for the rate-limit window to expire before retrying.

### API returns 503

This means the explanation request could not be completed by either configured AI provider.

Inspect:

```bash
npx wrangler tail
```

and check both provider configurations.

## 19. Testing

Run the test suite:

```bash
npm test
```

Run Vitest directly:

```bash
npx vitest run
```

Run with coverage:

```bash
npx vitest run --coverage
```

## 20. Project Structure

```
paper-explainer/
│
├── .github/
│   └── workflows/
│       └── deploy.yml
│
├── public/
│   ├── index.html
│   ├── papers.html
│   └── paper.html
│
├── src/
│   ├── ai.js
│   └── index.js
│
├── tests/
│   └── smoke.test.js
│
├── package.json
├── schema.sql
├── wrangler.toml
└── README.md
```

## 21. Deployment Order

For a new deployment:

1. Create D1
2. Create KV
3. Configure `wrangler.toml`
4. Apply `schema.sql`
5. Configure `GEMINI_API_KEY`
6. Configure `ADMIN_TOKEN`
7. Configure `ALLOWED_ORIGIN`
8. Deploy Worker
9. Record Worker URL
10. Configure frontend API URL
11. Deploy `public/`
12. Run smoke tests
13. Verify production API
14. Verify public paper listing
15. Verify individual paper
16. Verify Gemini
17. Verify Workers AI fallback

## 22. Production Verification

Before considering deployment complete:

- [ ] D1 exists
- [ ] D1 schema applied
- [ ] KV exists
- [ ] AI binding exists
- [ ] Gemini secret exists
- [ ] Admin secret exists
- [ ] Allowed origin is correct
- [ ] Worker deploy succeeds
- [ ] `/api/papers` works
- [ ] `/api/search` works
- [ ] `/api/tags` works
- [ ] `/api/authors/:slug` works
- [ ] `/api/explain` works
- [ ] Gemini provider works
- [ ] Workers AI fallback works
- [ ] `/api/publish` works
- [ ] public paper page works
- [ ] rate limiting works
- [ ] unauthorized admin requests fail
- [ ] GitHub Pages frontend loads

## 23. Operational Principle

The frontend never receives:

- GEMINI_API_KEY
- ADMIN_TOKEN
- Cloudflare credentials
- D1 credentials
- KV credentials

All privileged operations remain inside the Cloudflare Worker.

```
Browser
   │
   │ HTTPS
   ▼
Cloudflare Worker
   │
   ├── D1
   ├── KV
   ├── Gemini
   └── Workers AI
```

This separation is intentional.

## 24. License

Choose and add the project's intended license before public redistribution.
