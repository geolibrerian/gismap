import { DEVELOPMENT_POSTS, FEED_API, filterPosts, labelForType, normalizePosts, validateSmartMapUrl } from "./feed-data.js";

const app = document.querySelector("#feed-app");
const basePath = "/feed/";
let allPosts = [];

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

function routePath() {
  return location.pathname.replace(/^\/feed\/?/, "").replace(/\/+$/, "");
}

function feedHref(path = "") { return `${basePath}${path}`; }

function postHref(post) { return `${basePath}p/${encodeURIComponent(post.id)}`; }

function nav(active = "discover") {
  const items = [
    ["discover", "Discover", feedHref()], ["following", "Following", feedHref("following/")],
    ["reels", "Reels", feedHref("reels/")], ["explore", "Explore", feedHref("explore/")],
    ["publish", "Publish", feedHref("publish/")],
  ];
  const header = element("header", "feed-header");
  const brand = element("a", "feed-brand"); brand.href = feedHref(); brand.setAttribute("aria-label", "GISMap Feed home");
  brand.append(element("span", "feed-brand__mark", "⌁"), element("span", "feed-brand__name", "GISMap Feed"));
  const links = element("nav", "feed-nav"); links.setAttribute("aria-label", "Feed navigation");
  for (const [key, label, href] of items) { const link = element("a", key === active ? "is-active" : "", label); link.href = href; if (key === active) link.setAttribute("aria-current", "page"); links.append(link); }
  header.append(brand, links);
  return header;
}

function bottomNav(active = "discover") {
  const navNode = element("nav", "feed-bottom-nav"); navNode.setAttribute("aria-label", "Feed navigation");
  for (const [key, label, href, icon] of [["discover", "Discover", feedHref(), "◉"], ["explore", "Explore", feedHref("explore/"), "⌖"], ["publish", "Publish", feedHref("publish/"), "+"]]) {
    const link = element("a", key === active ? "is-active" : ""); link.href = href; if (key === active) link.setAttribute("aria-current", "page");
    link.append(element("span", "feed-bottom-nav__icon", icon), element("span", "", label)); navNode.append(link);
  }
  return navNode;
}

function preview(post) {
  const box = element("div", `post-preview post-preview--${post.post_type || "map"}`); box.setAttribute("aria-label", `${labelForType(post.post_type)} preview`);
  const terrain = element("span", "post-preview__terrain");
  const line = element("span", "post-preview__line");
  const label = element("span", "post-preview__label", labelForType(post.post_type));
  box.append(terrain, line, label);
  return box;
}

async function sharePost(post) {
  const url = new URL(postHref(post), location.origin).href;
  const share = { title: post.title, text: post.description || "", url };
  try {
    if (navigator.share) await navigator.share(share);
    else { await navigator.clipboard.writeText(url); announce("Link copied."); }
  } catch (error) { if (error?.name !== "AbortError") announce("Could not share that post."); }
}

function announce(message) { const status = document.querySelector("#feed-status"); if (status) status.textContent = message; }

function postCard(post) {
  const card = element("article", "post-card");
  const author = element("header", "post-card__author");
  const avatar = element("span", "post-card__avatar", (post.author?.display_name || "G").slice(0, 1).toUpperCase()); avatar.setAttribute("aria-hidden", "true");
  const identity = element("div"); identity.append(element("strong", "", post.author?.display_name || "GISMap creator"), element("span", "post-card__handle", `@${post.author?.handle || "creator"}`));
  const fixture = post.development_fixture ? element("span", "post-card__fixture", "Development fixture") : null;
  author.append(avatar, identity); if (fixture) author.append(fixture);
  const detail = element("a", "post-card__preview-link"); detail.href = postHref(post); detail.append(preview(post));
  const body = element("div", "post-card__body");
  const title = element("h2"); const titleLink = element("a", "", post.title); titleLink.href = postHref(post); title.append(titleLink);
  const description = element("p", "post-card__description", post.description || "");
  const meta = element("p", "post-card__meta", [post.location_label, post.source_name].filter(Boolean).join(" · "));
  const tags = element("div", "post-card__tags"); for (const tag of post.tags || []) tags.append(element("span", "", `#${tag}`));
  body.append(title, description, meta, tags);
  const actions = element("footer", "post-card__actions");
  const explore = element("a", "post-card__explore", "Explore map"); explore.href = post.source_url; explore.target = "_blank"; explore.rel = "noopener noreferrer";
  const save = element("button", "post-card__save", "Save"); save.type = "button"; save.disabled = true; save.title = "Save is coming with accounts";
  const share = element("button", "post-card__share", "Share"); share.type = "button"; share.addEventListener("click", () => sharePost(post));
  actions.append(explore, save, share); card.append(author, detail, body, actions); return card;
}

async function fetchPosts() {
  try {
    const response = await fetch(`${FEED_API}/posts?limit=20`, { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`Feed service unavailable (${response.status})`);
    const result = normalizePosts(await response.json());
    return result.posts.length ? { posts: result.posts, source: "live" } : { posts: DEVELOPMENT_POSTS, source: "fixtures" };
  } catch { return { posts: DEVELOPMENT_POSTS, source: "fixtures" }; }
}

function discovery({ mode = "discover" } = {}) {
  app.replaceChildren(nav(mode), element("main", "feed-main"), bottomNav(mode));
  const main = app.querySelector("main");
  const hero = element("section", "feed-hero");
  hero.append(element("p", "feed-kicker", "GISMap Feed"), element("h1", "", mode === "explore" ? "Find a story\nnear a place." : "Maps worth\nexploring."), element("p", "feed-hero__lede", mode === "explore" ? "Place-based discovery is starting with searchable public map stories." : "A lightweight place for interactive maps, Briefs, and Tours. Open the artifact when you are ready to explore."));
  const controls = element("section", "feed-controls"); const search = element("input", "feed-search"); search.type = "search"; search.placeholder = mode === "explore" ? "Search a place or theme" : "Search stories, places, and topics"; search.setAttribute("aria-label", search.placeholder);
  const filters = element("div", "feed-filters"); filters.setAttribute("aria-label", "Filter by content type");
  const choices = [["all", "All"], ["map", "Maps"], ["brief", "Briefs"], ["tour", "Tours"]]; let selected = "all";
  const list = element("section", "feed-list"); list.setAttribute("aria-live", "polite");
  const redraw = () => { const matching = filterPosts(allPosts, { query: search.value, type: selected }); list.replaceChildren(...matching.map(postCard)); if (!matching.length) list.append(emptyState("No stories match that search.", "Try a different place or remove a filter.")); };
  for (const [value, label] of choices) { const button = element("button", value === selected ? "is-active" : "", label); button.type = "button"; button.addEventListener("click", () => { selected = value; [...filters.children].forEach(item => item.classList.toggle("is-active", item.textContent === label)); redraw(); }); filters.append(button); }
  search.addEventListener("input", redraw); controls.append(search, filters); main.append(hero, controls, list, element("p", "feed-status", ""));
  fetchPosts().then(({ posts, source }) => { allPosts = posts; if (source === "fixtures") { const note = element("aside", "feed-fixture-note", "Preview collection — these are clearly labelled GISMap development fixtures. Public community posts will appear after review."); main.insertBefore(note, list); } redraw(); }).catch(() => list.replaceChildren(emptyState("The Feed is unavailable.", "Please try again shortly.")));
}

function emptyState(title, detail) { const section = element("section", "feed-empty"); section.append(element("h2", "", title), element("p", "", detail)); return section; }

async function detail(postId) {
  app.replaceChildren(nav("discover"), element("main", "feed-main"), bottomNav("discover")); const main = app.querySelector("main"); main.append(element("p", "feed-loading", "Loading story…"));
  const local = DEVELOPMENT_POSTS.find((post) => post.id === postId);
  let post = local;
  if (!post) { try { const response = await fetch(`${FEED_API}/posts/${encodeURIComponent(postId)}`); if (response.ok) post = await response.json(); } catch { /* handled below */ } }
  main.replaceChildren();
  if (!post) { main.append(emptyState("This story is not available.", "It may be unlisted, under review, or no longer published.")); return; }
  const article = element("article", "post-detail"); const back = element("a", "post-detail__back", "← Back to Feed"); back.href = feedHref(); article.append(back, preview(post));
  const type = element("p", "feed-kicker", labelForType(post.post_type)); const title = element("h1", "", post.title); const copy = element("p", "post-detail__description", post.description || ""); const place = element("p", "post-detail__place", post.location_label || "Location not specified");
  const tags = element("div", "post-card__tags"); for (const tag of post.tags || []) tags.append(element("span", "", `#${tag}`));
  const actions = element("div", "post-detail__actions"); const explore = element("a", "post-card__explore", "Open interactive map"); explore.href = post.source_url; explore.target = "_blank"; explore.rel = "noopener noreferrer"; const share = element("button", "post-card__share", "Share"); share.type = "button"; share.addEventListener("click", () => sharePost(post)); actions.append(explore, share);
  article.append(type, title, copy, place, tags, actions); main.append(article);
}

function publish() {
  app.replaceChildren(nav("publish"), element("main", "feed-main"), bottomNav("publish")); const main = app.querySelector("main");
  const section = element("section", "publish"); section.append(element("p", "feed-kicker", "Publish to Feed"), element("h1", "", "Share a map story."), element("p", "publish__lede", "Paste a public GISMap Smart Map, Brief, Tour, or example link. We check the link before anything is submitted."));
  const form = element("form", "publish-form"); const source = element("input"); source.type = "url"; source.required = true; source.maxLength = 8192; source.placeholder = "https://gismap.online/#map=…"; source.value = new URLSearchParams(location.search).get("source") || (() => { try { return sessionStorage.getItem("gismap.feed.source") || ""; } catch { return ""; } })();
  const title = element("input"); title.required = true; title.maxLength = 160; title.placeholder = "A concise title";
  const description = element("textarea"); description.maxLength = 1000; description.rows = 4; description.placeholder = "What should readers notice?";
  const tags = element("input"); tags.maxLength = 240; tags.placeholder = "planning, water, history";
  const previewButton = element("button", "button-secondary", "Check link"); previewButton.type = "button"; const submit = element("button", "button-primary", "Submit for review"); submit.type = "submit";
  const result = element("div", "publish-result"); result.setAttribute("aria-live", "polite");
  const label = (text, control) => { const node = element("label", "publish-field"); node.append(element("span", "", text), control); return node; };
  form.append(label("GISMap link", source), label("Title", title), label("Description (optional)", description), label("Topics (optional)", tags), previewButton, submit, result); section.append(form, element("p", "publish__privacy", "Only public, credential-free GISMap links are accepted. Submission does not make private layers public, and new posts stay pending review.")); main.append(section);
  const check = async () => {
    try {
      const local = validateSmartMapUrl(source.value); let preview = local;
      try { const response = await fetch(`${FEED_API}/preview`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source_url: source.value }) }); if (response.ok) preview = await response.json(); } catch { /* local validation remains useful offline */ }
      if (!title.value && preview.title) title.value = preview.title;
      result.replaceChildren(element("strong", "publish-result__ok", `${labelForType(preview.post_type)} link ready to review.`), element("p", "", "Your link is safe to prepare. Add a clear title and submit when signed in to GISMap SI."));
      return preview;
    } catch (error) { result.replaceChildren(element("strong", "publish-result__error", error.message)); throw error; }
  };
  previewButton.addEventListener("click", () => { void check().catch(() => {}); });
  form.addEventListener("submit", async (event) => { event.preventDefault(); try { await check(); result.append(element("p", "", "Feed submissions are connected to GISMap SI accounts. Sign in to GISMap SI to submit this for moderator review; public publishing is never automatic.")); } catch { /* validation already shown */ } });
  if (source.value) void check().catch(() => {});
}

function unavailable(label) {
  app.replaceChildren(nav(label), element("main", "feed-main"), bottomNav(label)); const main = app.querySelector("main"); const heading = label === "following" ? "Following is on its way." : label === "reels" ? "Reels are coming soon." : "Explore is starting simply."; main.append(emptyState(heading, label === "following" ? "Creator accounts and follows arrive in Phase 2. Discover public stories in the meantime." : "This first Feed release keeps initial browsing lightweight while the richer experience is built."));
}

function start() {
  const path = routePath();
  if (path.startsWith("p/")) return detail(decodeURIComponent(path.slice(2)));
  if (path === "publish") return publish();
  if (path === "explore") return discovery({ mode: "explore" });
  if (path === "following" || path === "reels") return unavailable(path);
  return discovery();
}

start();
