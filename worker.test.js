import test from "node:test";
import assert from "node:assert/strict";
import worker from "./worker.js";

let ipCounter = 1;
function makeRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("CF-Connecting-IP", `198.51.100.${ipCounter++ % 250 + 1}`);
  return new Request(`https://preview.example${path}`, { ...options, headers });
}
async function jsonBody(response) {
  return response.json();
}

test("non-API paths are served by the static assets binding", async () => {
  const response = await worker.fetch(makeRequest("/"), {
    ASSETS: { fetch: async () => new Response("static app") }
  });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "static app");
});

test("rejects cross-origin requests", async () => {
  const response = await worker.fetch(makeRequest("/api/pagespeed", {
    headers: { Origin: "https://attacker.example" }
  }), {});
  assert.equal(response.status, 403);
});

test("rejects methods other than GET", async () => {
  const response = await worker.fetch(makeRequest("/api/pagespeed", {
    method: "POST",
    headers: { Origin: "https://preview.example" }
  }), {});
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
});

test("rejects an incomplete target URL", async () => {
  const response = await worker.fetch(makeRequest("/api/pagespeed?url=not-a-url"), {});
  assert.equal(response.status, 400);
});

test("rejects local website targets", async () => {
  const target = encodeURIComponent("http://localhost/admin");
  const response = await worker.fetch(makeRequest(`/api/pagespeed?url=${target}`), {});
  assert.equal(response.status, 400);
});

test("rejects target URLs longer than 2,048 characters", async () => {
  const target = encodeURIComponent("https://example.com/" + "a".repeat(2_100));
  const response = await worker.fetch(makeRequest(`/api/pagespeed?url=${target}`), {});
  assert.equal(response.status, 400);
  assert.match((await jsonBody(response)).error, /too long/i);
});

test("rejects unsupported strategies", async () => {
  const target = encodeURIComponent("https://example.com/");
  const response = await worker.fetch(makeRequest(`/api/pagespeed?url=${target}&strategy=tablet`), {});
  assert.equal(response.status, 400);
});

test("returns a clear configuration error when the API key is missing", async () => {
  const target = encodeURIComponent("https://example.com/");
  const response = await worker.fetch(makeRequest(`/api/pagespeed?url=${target}`), {});
  assert.equal(response.status, 503);
  assert.match((await jsonBody(response)).error, /not configured/i);
});

test("maps available Google PageSpeed metrics into a stable response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: "https://pagespeed.web.dev/analysis?url=https%3A%2F%2Fexample.com",
    lighthouseResult: {
      categories: { performance: { score: 0.823 } },
      audits: {
        "largest-contentful-paint": { numericValue: 2300 },
        "cumulative-layout-shift": { numericValue: 0.081 }
      }
    },
    loadingExperience: {
      metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 175 } }
    }
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    const target = encodeURIComponent("https://example.com/");
    const response = await worker.fetch(makeRequest(`/api/pagespeed?url=${target}&strategy=mobile`), {
      PAGESPEED_API_KEY: "test-key"
    });
    assert.equal(response.status, 200);
    const body = await jsonBody(response);
    assert.equal(body.performanceScore, 82);
    assert.equal(body.lcpSeconds, 2.3);
    assert.equal(body.cls, 0.08);
    assert.equal(body.inpMilliseconds, 175);
    assert.match(body.reportUrl, /^https:\/\/pagespeed\.web\.dev\//);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
