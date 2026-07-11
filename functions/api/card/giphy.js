import { json, optionsResponse, cleanText } from "./lib/util.js";

// GET /api/card/giphy?q=SEARCH — proxy for Giphy v1 GIF search.
// Keeps the API key server-side; responses are cached for 10 minutes.
// Returns 501 {error:"no_key"} when GIPHY_API_KEY isn't configured, so the
// note form can fall back to its paste-a-link input.
export async function onRequestGet(context) {
  const apiKey = context.env.GIPHY_API_KEY;
  if (!apiKey) return json({ error: "no_key" }, 501);

  const q = cleanText(new URL(context.request.url).searchParams.get("q") || "", 120);
  if (!q) return json({ error: "Missing search query" }, 400);

  const giphyUrl = new URL("https://api.giphy.com/v1/gifs/search");
  giphyUrl.searchParams.set("api_key", apiKey);
  giphyUrl.searchParams.set("q", q);
  giphyUrl.searchParams.set("limit", "24");
  giphyUrl.searchParams.set("rating", "pg-13");

  // Cache on a synthetic key that doesn't include the API key.
  const cacheKey = new Request(
    "https://cache.internal/giphy?q=" + encodeURIComponent(q.toLowerCase())
  );
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let data;
  try {
    const res = await fetch(giphyUrl);
    if (!res.ok) return json({ error: "GIF search is unavailable right now" }, 502);
    data = await res.json();
  } catch {
    return json({ error: "GIF search is unavailable right now" }, 502);
  }

  const results = (data.data || [])
    .map((r) => {
      // downsized (≤2MB) keeps half/full-page GIFs crisp; fall back to
      // fixed_height when Giphy omits it. Stored URLs are never migrated.
      const fh = r.images && r.images.fixed_height;
      const ds = r.images && r.images.downsized;
      const full = ds && ds.url ? ds : fh;
      const small = r.images && r.images.fixed_height_small;
      return {
        id: r.id,
        url: full ? full.url : null,
        preview: small && small.url ? small.url : full ? full.url : null,
        description: r.title || "",
      };
    })
    .filter((r) => typeof r.url === "string" && r.url.startsWith("https://"));

  const response = json(
    { results },
    200,
    { "Cache-Control": "public, max-age=600" }
  );
  await cache.put(cacheKey, response.clone());
  return response;
}

export async function onRequestOptions() {
  return optionsResponse();
}
