import { api, getMyCards, removeMyCard } from "./common.js";

const pageError = document.getElementById("page-error");
const mineSection = document.getElementById("mine-section");
const mineGrid = document.getElementById("mine-grid");
const allGrid = document.getElementById("all-grid");
const emptyNote = document.getElementById("empty-note");

// SECURITY: titles/names only ever reach the DOM via textContent, and
// thumbnails via img.src after a data-URL shape check.

function buildTile(card, { href, locked = false }) {
  const tile = document.createElement("a");
  tile.className = "gallery-tile";
  tile.href = href;

  const cover = document.createElement("div");
  cover.className = "tile-cover";
  if (
    typeof card.cover_thumb === "string" &&
    /^data:image\/(jpeg|png|webp);base64,/.test(card.cover_thumb)
  ) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = "";
    img.src = card.cover_thumb;
    cover.appendChild(img);
  } else {
    const ph = document.createElement("span");
    ph.className = "tile-placeholder";
    ph.textContent = "♥";
    cover.appendChild(ph);
  }
  tile.appendChild(cover);

  if (locked) {
    const badge = document.createElement("span");
    badge.className = "lock-badge";
    badge.textContent = "🔒 private";
    tile.appendChild(badge);
  }

  const body = document.createElement("div");
  body.className = "tile-body";
  const title = document.createElement("div");
  title.className = "tile-title";
  title.textContent = card.title;
  body.appendChild(title);
  const sub = document.createElement("div");
  sub.className = "tile-sub";
  const n = card.entry_count ?? 0;
  sub.textContent =
    (card.recipient_name ? `for ${card.recipient_name} · ` : "") +
    (n === 1 ? "1 note" : `${n} notes`);
  body.appendChild(sub);
  tile.appendChild(body);

  return tile;
}

async function loadMine() {
  const mine = getMyCards();
  if (!mine.length) return;
  const tiles = await Promise.all(
    mine.map(async (rec) => {
      try {
        const card = await api(`/${encodeURIComponent(rec.id)}`, { token: rec.adminToken });
        return buildTile(card, {
          href: `view?c=${encodeURIComponent(card.id)}&t=${encodeURIComponent(rec.adminToken)}`,
          locked: !!card.is_private,
        });
      } catch (err) {
        if (err.status === 404) removeMyCard(rec.id); // deleted card — forget it
        return null;
      }
    })
  );
  const live = tiles.filter(Boolean);
  if (live.length) {
    mineGrid.replaceChildren(...live);
    mineSection.classList.remove("hidden");
    document.getElementById("all-heading").textContent = "All cards";
  }
}

async function loadAll() {
  let data;
  try {
    data = await api("");
  } catch {
    pageError.textContent = "Couldn't load the cards — try refreshing in a moment.";
    pageError.classList.remove("hidden");
    return;
  }
  const cards = data.cards || [];
  if (!cards.length) {
    emptyNote.classList.remove("hidden");
    return;
  }
  allGrid.replaceChildren(
    ...cards.map((card) =>
      buildTile(card, { href: `view?c=${encodeURIComponent(card.id)}` })
    )
  );
}

loadMine();
loadAll();
