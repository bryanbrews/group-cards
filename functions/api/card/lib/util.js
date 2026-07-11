// Shared helpers for the group card API.

export const LIMITS = {
  IMAGE_CHARS: 1_200_000, // data-URL length cap (~900KB binary)
  THUMB_CHARS: 80_000, // gallery thumbnail data-URL cap (~60KB binary)
  MESSAGE: 5_000,
  NAME: 120,
  ENTRIES_PER_CARD: 100,
};

export const FONTS = ["caveat", "shadows", "homemade", "kalam"];
export const COLORS = ["ink", "sea", "plum", "forest", "brick"];

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...corsHeaders(),
      ...extra,
    },
  });
}

export function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export function optionsResponse() {
  return new Response(null, { headers: corsHeaders() });
}

// 32-char hex token
export function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 10-char base36 id
export function randomId() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return [...bytes].map((b) => (b % 36).toString(36)).join("");
}

// Look up a card and resolve the caller's role from ?t=TOKEN.
// Returns { card, role } where role is 'admin' | 'share' | null.
// - admin_token → admin (full control)
// - sign_token OR view_token → share (old v1 links keep working)
// - no/wrong token → share on public cards, null (403) on private ones
export async function getCardAndRole(env, cardId, request) {
  const card = await env.DB.prepare("SELECT * FROM cards WHERE id = ?")
    .bind(cardId)
    .first();
  if (!card) return { card: null, role: null };
  const token = new URL(request.url).searchParams.get("t") || "";
  let role = null;
  if (token && token === card.admin_token) role = "admin";
  else if (token && (token === card.sign_token || token === card.view_token)) role = "share";
  else if (!card.is_private) role = "share";
  return { card, role };
}

export function cleanText(value, maxLen) {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s.length > maxLen) return null;
  return s;
}

// data:image/(jpeg|png|webp);base64,... with a length cap
export function isValidImageData(value) {
  return (
    typeof value === "string" &&
    value.length <= LIMITS.IMAGE_CHARS &&
    /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(value)
  );
}

// https URL on an allowlisted GIF media host
export function isAllowedGifUrl(value) {
  if (typeof value !== "string" || value.length > 600) return false;
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return (
    host === "tenor.com" ||
    host.endsWith(".tenor.com") ||
    host.endsWith(".giphy.com")
  );
}
