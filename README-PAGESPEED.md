# SignalAudit — PageSpeed integration branch

This branch adds an opt-in server-side PageSpeed Insights endpoint. It is not live until this branch is reviewed, merged, and deployed.

## What changed

- Moves the static website into `public/index.html` for a Worker static-assets deployment.
- Adds `GET /api/pagespeed?url=https%3A%2F%2Fexample.com&strategy=mobile`.
- Calls Google PageSpeed Insights from the Worker so the API key is not exposed in browser JavaScript.
- Populates the existing performance score, LCP, CLS, INP (when available), device, and report URL fields.
- Keeps the manual Google PageSpeed workflow available as a fallback.
- Rejects local/private-looking targets, checks request origin, applies a best-effort per-isolate request limit, and returns bounded error messages.

## Configure locally / in Cloudflare

1. Enable the PageSpeed Insights API in a Google Cloud project and create an API key. Restrict the key to the PageSpeed Insights API where possible.
2. Install Wrangler in your development environment.
3. Set the key as a Worker secret (do not put it in source code):

   ```sh
   npx wrangler secret put PAGESPEED_API_KEY
   ```

4. Run a local preview:

   ```sh
   npx wrangler dev
   ```

5. Deploy only after reviewing the diff and configuring production limits:

   ```sh
   npx wrangler deploy
   ```

## Before production

- Configure a Cloudflare rate-limiting rule or durable rate-limit binding. The in-memory limiter is only a best-effort guard and does not enforce a global quota across isolates.
- Set a Google Cloud quota and billing alert if applicable.
- Test mobile and desktop responses, invalid URLs, Google quota errors, timeout behavior, and the printable/downloaded report.
- Confirm the Cloudflare Worker uses this repository and the intended production environment before deploying.

## API response behavior

The endpoint returns performance score, Lighthouse LCP and CLS, INP from field data if Google returns it, and Google's report URL. INP can be absent; the UI leaves it blank rather than fabricating a value. A successful test only fills the form; the user still generates and reviews the draft report.

This branch has not been deployed or verified against a live Cloudflare Worker.
