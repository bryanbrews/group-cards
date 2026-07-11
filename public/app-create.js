import { api, resizeImage, wireCopyButton, saveMyCard } from "./common.js";

const coverDrop = document.getElementById("cover-drop");
const coverInput = document.getElementById("cover-input");
const coverCta = document.getElementById("cover-cta");
const titleInput = document.getElementById("title-input");
const recipientInput = document.getElementById("recipient-input");
const createBtn = document.getElementById("create-btn");
const createError = document.getElementById("create-error");

let coverDataUrl = null;
let coverThumbUrl = null;

function showError(msg) {
  createError.textContent = msg;
  createError.classList.toggle("hidden", !msg);
}

// ---- cover picker ----

coverDrop.addEventListener("click", () => coverInput.click());
coverDrop.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    coverInput.click();
  }
});
coverDrop.addEventListener("dragover", (e) => {
  e.preventDefault();
  coverDrop.classList.add("dragover");
});
coverDrop.addEventListener("dragleave", () => coverDrop.classList.remove("dragover"));
coverDrop.addEventListener("drop", (e) => {
  e.preventDefault();
  coverDrop.classList.remove("dragover");
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) handleCoverFile(file);
});
coverInput.addEventListener("change", () => {
  const file = coverInput.files && coverInput.files[0];
  if (file) handleCoverFile(file);
});

async function handleCoverFile(file) {
  showError("");
  coverCta.textContent = "Shrinking photo…";
  try {
    coverDataUrl = await resizeImage(file);
    // Small thumbnail for the /cards gallery tile.
    try {
      coverThumbUrl = await resizeImage(file, { maxDim: 320, quality: 0.7, maxChars: 80_000 });
    } catch {
      coverThumbUrl = null; // gallery shows a placeholder tile instead
    }
    let img = coverDrop.querySelector("img.cover-preview");
    if (!img) {
      img = document.createElement("img");
      img.className = "cover-preview";
      img.alt = "Cover preview";
      coverDrop.prepend(img);
    }
    img.src = coverDataUrl;
    coverDrop.classList.add("has-image");
    coverCta.textContent = "Change photo";
  } catch (err) {
    coverDataUrl = null;
    coverThumbUrl = null;
    coverCta.textContent = "Tap to choose a photo of the guest of honor";
    showError(err.message || "Couldn't read that photo — try another one.");
  }
}

// ---- create ----

createBtn.addEventListener("click", async () => {
  showError("");
  const title = titleInput.value.trim();
  if (!title) {
    showError(“Give the card a title — “Happy Birthday!” style.”);
    titleInput.focus();
    return;
  }

  createBtn.disabled = true;
  createBtn.textContent = "Creating…";
  try {
    const card = await api("", {
      method: "POST",
      body: {
        title,
        recipient_name: recipientInput.value.trim(),
        cover_image: coverDataUrl,
        cover_thumb: coverThumbUrl,
        is_private: document.getElementById("private-input").checked,
      },
    });
    saveMyCard({ id: card.id, adminToken: card.admin_token, title: card.title });
    showLinks(card);
  } catch (err) {
    showError(err.message || "Something went wrong — try again.");
    createBtn.disabled = false;
    createBtn.textContent = "Create the card";
  }
});

function showLinks(card) {
  // Strip the last path segment (works for /cards/new, /cards/new.html).
  // Extensionless links because Cloudflare Pages redirects *.html to pretty URLs.
  // The share link carries the sign_token so it keeps working if the card is
  // later made private.
  const base = location.origin + location.pathname.replace(/[^/]*$/, "");
  const shareUrl = `${base}view?c=${card.id}&t=${card.sign_token}`;
  const adminUrl = `${base}view?c=${card.id}&t=${card.admin_token}`;

  document.getElementById("share-url").textContent = shareUrl;
  document.getElementById("admin-url").textContent = adminUrl;
  wireCopyButton(document.getElementById("copy-share"), shareUrl);
  wireCopyButton(document.getElementById("copy-admin"), adminUrl);
  document.getElementById("open-card-link").href = adminUrl;

  document.getElementById("create-panel").classList.add("hidden");
  document.getElementById("links-panel").classList.remove("hidden");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
