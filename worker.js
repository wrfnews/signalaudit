export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/pagespeed") {
      return env.ASSETS.fetch(request);
    }

    const origin = request.headers.get("Origin");
    if (origin && origin !== url.origin) {
      return json({ error: "Cross-origin requests are not allowed." }, 403);
    }
    if (request.method !== "GET") {
      return json({ error: "Use GET for this endpoint." }, 405, { Allow: "GET" });
    }

    const clientIp = request.headers.get("CF-Connecting-IP") || "unknown";
    const now = Date.now();
    const windowMs = 10 * 60 * 1000;
    const limit = 10;
    globalThis.__signalauditRateLimit ||= new Map();
    const buckets = globalThis.__signalauditRateLimit;
    for (const [ip, entry] of buckets) {
      if (now - entry.startedAt >= windowMs) buckets.delete(ip);
    }
    const bucket = buckets.get(clientIp);
    if (bucket && now - bucket.startedAt < windowMs && bucket.count >= limit) {
      return json({ error: "Rate limit reached. Try again in a few minutes." }, 429, {
        "Retry-After": String(Math.ceil((windowMs - (now - bucket.startedAt)) / 1000))
      });
    }
    if (!bucket || now - bucket.startedAt >= windowMs) {
      buckets.set(clientIp, { startedAt: now, count: 1 });
    } else {
      bucket.count += 1;
    }

    const rawTarget = url.searchParams.get("url") || "";
    const strategy = url.searchParams.get("strategy") || "mobile";
    let target;
    try {
      target = new URL(rawTarget);
    } catch {
      return json({ error: "Enter a complete public website URL." }, 400);
    }
    if (target.href.length > 2048) {
      return json({ error: "The website URL is too long. Use a URL under 2,048 characters." }, 400);
    }
    if (!isPublicUrl(target)) {
      return json({ error: "Only public HTTP or HTTPS website URLs are allowed." }, 400);
    }
    if (!["mobile", "desktop"].includes(strategy)) {
      return json({ error: "Strategy must be mobile or desktop." }, 400);
    }

    if (!env.PAGESPEED_API_KEY) {
      return json({ error: "PageSpeed integration is not configured yet. Add the PAGESPEED_API_KEY secret in Cloudflare before using live tests." }, 503);
    }

    const apiUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
    apiUrl.searchParams.set("url", target.href);
    apiUrl.searchParams.set("strategy", strategy);
    apiUrl.searchParams.set("category", "performance");
    if (env.PAGESPEED_API_KEY) apiUrl.searchParams.set("key", env.PAGESPEED_API_KEY);

    let upstream;
    try {
      upstream = await fetch(apiUrl, { signal: AbortSignal.timeout(25000) });
    } catch {
      return json({ error: "PageSpeed Insights timed out or could not be reached. Please retry." }, 504);
    }
    if (!upstream.ok) {
      if (upstream.status === 429) {
        return json({ error: "Google PageSpeed quota is temporarily exhausted. Try again later." }, 429);
      }
      if (upstream.status >= 500) {
        return json({ error: "Google PageSpeed Insights is temporarily unavailable." }, 502);
      }
      return json({ error: "PageSpeed Insights could not analyze this URL. Check the URL and try again." }, 400);
    }

    let data;
    try {
      data = await upstream.json();
    } catch {
      return json({ error: "PageSpeed Insights returned an unreadable response." }, 502);
    }
    const audits = data.lighthouseResult?.audits || {};
    const score = data.lighthouseResult?.categories?.performance?.score;
    const lcpMs = audits["largest-contentful-paint"]?.numericValue;
    const cls = audits["cumulative-layout-shift"]?.numericValue;
    const inpField = data.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT?.percentile ?? data.loadingExperience?.metrics?.INTERACTION_TO_NEXT_PAINT_MS?.percentile ?? data.loadingExperience?.metrics?.EXPERIMENTAL_INTERACTION_TO_NEXT_PAINT?.percentile;
    const reportUrl = data.id || "";
    return json({
      url: target.href,
      strategy,
      performanceScore: Number.isFinite(score) ? Math.round(score * 100) : null,
      lcpSeconds: Number.isFinite(lcpMs) ? Math.round((lcpMs / 1000) * 10) / 10 : null,
      cls: Number.isFinite(cls) ? Math.round(cls * 100) / 100 : null,
      inpMilliseconds: Number.isFinite(inpField) ? Math.round(inpField) : null,
      reportUrl,
      note: "Metrics are returned by Google PageSpeed Insights. INP may be unavailable when field data is absent."
    });
  }
};

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extraHeaders }
  });
}

function isPublicUrl(target) {
  if (!["http:", "https:"].includes(target.protocol) || !target.hostname || target.username || target.password) return false;
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host.includes(":")) return false;
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || /\.(example|test|invalid)$/.test(host)) return false;
  if (host === "::" || host === "::1" || /^(fc|fd|fe[89ab])/i.test(host)) return false;
  const octets = host.split(".");
  if (octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) {
    const [a, b] = octets.map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127)) return false;
  }
  return host.includes(".") && !host.endsWith(".");
}
