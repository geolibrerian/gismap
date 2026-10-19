import { buildManifest, PUBLIC_STATE_SCHEMA } from "../js/application-manifest.js";
// Every generated page and machine-readable file of the site, as { path: contents }.
// Pure (no Node APIs), so scripts/build-examples.mjs writes or checks it in CI and
// the same code can run in a browser. Inputs that are files are read through
// `readText(path)` (relative to the repository root).
import { EXAMPLE_CATEGORIES, POPULAR_SERVICES } from "../js/catalog.js";
import { CORN_LINK, agentGuide, buildAgentOutputs, layerLink, renderGuideHtml } from "./agent-docs.mjs";
import { AI_EXAMPLES, aiExampleLinks, aiExamplePath, aiExamplesMarkdown } from "./ai-examples.mjs";
import { WORKFLOW_EXAMPLES, workflowExampleLinks, workflowExamplePath, workflowExamplesMarkdown } from "./workflow-examples.mjs";

const esc = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const appLink = (item) => `/?example=${encodeURIComponent(item.slug || item.id)}`;
const typeLabel = (type) => ({ feature: "ArcGIS FeatureServer", "map-image": "ArcGIS MapServer", imagery: "ArcGIS ImageServer", geojson: "GeoJSON" }[type] || type);

function shell({ title, description, path, body, breadcrumbs = [], structuredData = null }) {
  const canonical = `https://gismap.online${path}`;
  const trail = [{ name: "Home", path: "/" }, ...breadcrumbs];
  const breadcrumbSchema = {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem", position: index + 1, name: item.name,
      item: `https://gismap.online${item.path}`,
    })),
  };
  const graph = [{ "@type": "WebPage", name: title, description, url: canonical }, breadcrumbSchema];
  if (structuredData) graph.push(structuredData);
  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  const breadcrumbHtml = `<nav class="breadcrumbs wrap" aria-label="Breadcrumb"><ol>${trail.map((item, index) => `<li>${index === trail.length - 1 ? `<span aria-current="page">${esc(item.name)}</span>` : `<a href="${item.path}">${esc(item.name)}</a>`}</li>`).join("")}</ol></nav>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} | GIS Map Online</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}"><meta name="robots" content="index, follow, max-image-preview:large"><meta property="og:type" content="website"><meta property="og:site_name" content="GIS Map Online"><meta property="og:title" content="${esc(title)} | GIS Map Online"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="https://gismap.online/assets/gis-map-online-mark-v2.png"><meta property="og:image:width" content="1254"><meta property="og:image:height" content="1254"><meta property="og:image:alt" content="GIS Map Online"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)} | GIS Map Online"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="https://gismap.online/assets/gis-map-online-mark-v2.png"><meta name="twitter:image:alt" content="GIS Map Online">
<link rel="icon" href="/assets/gis-map-online-mark-v2.png" type="image/png"><link rel="stylesheet" href="/css/content.css"><script type="application/ld+json">${jsonLd}</script></head>
<body><header class="site-header"><div class="site-header__inner"><a class="brand" href="/">GIS MAP ONLINE</a><nav class="site-nav" aria-label="Main navigation"><a href="/">Open map</a><a href="/examples/">Examples</a><a href="/guides/">Guides</a><a href="https://github.com/geolibrerian/gismap">GitHub</a></nav></div></header>${breadcrumbHtml}${body}<footer class="site-footer"><div class="wrap">GIS Map Online is a free, browser-based spatial intelligence studio. Public data remains subject to its publisher’s terms.</div></footer></body></html>`;
}

function exampleCard(item) {
  const search = [item.title, item.provider, item.category, typeLabel(item.serviceType), ...item.tags].join(" ").toLowerCase();
  return `<article class="card example-card" data-category="${esc(item.category)}" data-search="${esc(search)}"><div class="eyebrow">${esc(item.category)}</div><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p><div class="meta"><span class="pill">${esc(typeLabel(item.serviceType))}</span><span class="pill">${esc(item.provider)}</span></div><div class="card__links"><a href="${appLink(item)}">Open in GISMap</a>${item.featured ? `<a href="/examples/${esc(item.slug)}/">View details</a>` : ""}</div></article>`;
}

function examplesIndex() {
  const options = EXAMPLE_CATEGORIES.filter((category) => POPULAR_SERVICES.some((item) => item.category === category)).map((category) => `<option>${esc(category)}</option>`).join("");
  const body = `<main><section class="hero"><div class="wrap"><div class="eyebrow">Public GIS examples</div><h1>Open useful spatial data in one click.</h1><p class="lede">Browse curated ArcGIS REST services and GeoJSON feeds, then load them directly into GIS Map Online. No account or desktop GIS installation is required.</p><div class="actions"><a class="button" href="/">Open GISMap</a><a class="button button--secondary" href="#catalog">Browse datasets</a></div></div></section>${aiExampleSection()}${workflowExampleSection()}<section id="data-connections"><div class="wrap"><h2>Data connections</h2><p>Connect your own data to GISMap using local and browser-friendly services.</p><div class="grid"><article class="card"><div class="eyebrow">Local PostGIS · Intermediate</div><h3>Connect a Local PostGIS Database to GISMap.online</h3><p>Set up pg_featureserv on your computer and browse PostGIS collections without GeoServer or a cloud deployment. GISMap’s PostGIS integration is experimental.</p><div class="card__links"><a href="/examples/data-connections/local-postgis/">Read the tutorial</a></div></article></div></div></section><section id="catalog"><div class="wrap"><h2>Example data catalog</h2><p>Search by topic, publisher, format, or keyword. Service availability and publisher terms can change; verify source metadata before relying on a dataset.</p><div class="controls"><label><span class="eyebrow">Search</span><input id="example-search" type="search" placeholder="Earthquakes, USGS, FeatureServer…"></label><label><span class="eyebrow">Category</span><select id="example-category"><option value="">All categories</option>${options}</select></label></div><div id="example-grid" class="grid">${POPULAR_SERVICES.map(exampleCard).join("")}</div><p id="example-empty" class="empty">No examples match those filters.</p></div></section><section><div class="wrap"><h2>Viewer guides</h2><div class="grid">${GUIDES.map((guide) => `<article class="card"><div class="eyebrow">Guide</div><h3>${esc(guide.title)}</h3><p>${esc(guide.description)}</p><a href="${guidePath(guide)}">Read guide</a></article>`).join("")}</div></div></section></main><script>(()=>{const q=document.querySelector('#example-search'),c=document.querySelector('#example-category'),cards=[...document.querySelectorAll('.example-card')],empty=document.querySelector('#example-empty');function filter(){const term=q.value.trim().toLowerCase(),category=c.value;let shown=0;cards.forEach(card=>{const visible=(!term||card.dataset.search.includes(term))&&(!category||card.dataset.category===category);card.hidden=!visible;if(visible)shown++});empty.classList.toggle('is-visible',shown===0)}q.addEventListener('input',filter);c.addEventListener('change',filter)})();</script>`;
  return shell({ title: "Public GIS data examples", description: "Open curated ArcGIS REST services, FeatureServers, MapServers, ImageServers, and GeoJSON feeds directly in a free browser GIS viewer.", path: "/examples/", breadcrumbs: [{ name: "Examples", path: "/examples/" }], body });
}

function examplePage(item) {
  const body = `<main><section class="hero"><div class="wrap"><div class="eyebrow">${esc(item.category)} · ${esc(typeLabel(item.serviceType))}</div><h1>${esc(item.title)}</h1><p class="lede">${esc(item.description)}</p><div class="actions"><a class="button" href="${appLink(item)}">Open this dataset in GISMap</a><a class="button button--secondary" href="/examples/">All examples</a></div></div></section><section><div class="wrap prose"><h2>What this dataset contains</h2><p>${esc(item.description)} ${esc(item.whyUseful)}</p><div class="facts"><div class="fact"><strong>Publisher</strong>${esc(item.sourceOrganization)}</div><div class="fact"><strong>Service type</strong>${esc(typeLabel(item.serviceType))}</div><div class="fact"><strong>Category</strong>${esc(item.category)}</div></div><h2>Open the source directly</h2><p>The button above creates a shareable GISMap URL using the catalog slug. You can also inspect or reuse the publisher endpoint:</p><pre class="endpoint"><code>${esc(item.url)}</code></pre><h2>For AI agents and scripts</h2><p>Open the endpoint without the catalog with a <code>?layer=</code> link, or describe the whole map as one <a href="/schemas/map-v1.schema.json">map-v1</a> JSON object (see <a href="/guides/ai-agents/">Making maps with an AI agent</a>):</p><pre class="endpoint"><code>${esc(layerLink(item))}</code></pre><pre><code class="language-json">${esc(JSON.stringify({ version: 1, layers: [{ url: item.url, title: item.title }] }, null, 2))}</code></pre><h2>Attribution and terms</h2><p>${esc(item.licenseOrTerms)}</p><p><a href="${esc(item.sourcePage)}">View the publisher’s source page and metadata</a>.</p><div class="callout"><strong>Availability note.</strong> Public services can change without notice. Confirm currency, coverage, accuracy, and usage terms with the publisher before operational use.</div></div></section></main>`;
  const structuredData = { "@type": "Dataset", name: item.title, description: item.description, url: `https://gismap.online/examples/${item.slug}/`, distribution: { "@type": "DataDownload", contentUrl: item.url, encodingFormat: typeLabel(item.serviceType) }, creator: { "@type": "Organization", name: item.sourceOrganization }, keywords: item.tags.join(", ") };
  return shell({ title: item.title, description: `${item.description} Open this ${typeLabel(item.serviceType)} dataset directly in GIS Map Online.`, path: `/examples/${item.slug}/`, breadcrumbs: [{ name: "Examples", path: "/examples/" }, { name: item.title, path: `/examples/${item.slug}/` }], body, structuredData });
}

const aiExampleCard = (example) => `<article class="card"><div class="eyebrow">${esc(example.kind)}</div><h3>${esc(example.title)}</h3><p>${esc(example.description)}</p><div class="card__links"><a href="${aiExamplePath(example)}">See how it was made</a></div></article>`;

function aiExampleSection() {
  return `<section id="ai"><div class="wrap"><h2>Made with chatbots and AI agents</h2><p>Worked examples of a chatbot or an AI agent making a GIS Map Online map or briefing from public data: the prompt, the code, the finished link and QR code, and what to check. <a href="/examples/ai/">All AI examples</a> · <a href="/guides/ai-agents/">Guide for AI agents</a></p><div class="grid">${AI_EXAMPLES.map(aiExampleCard).join("")}</div></div></section>`;
}

function aiExamplesIndex() {
  const body = `<main><section class="hero"><div class="wrap"><div class="eyebrow">AI examples</div><h1>Maps and briefings made by chatbots and agents.</h1><p class="lede">GIS Map Online opens a map, its styles and its slides from a link. A chatbot can write that link; an agent can check the data first and build richer briefings. Each example below has the prompt, the agent's code, and the finished result to open or scan.</p><div class="actions"><a class="button" href="/guides/ai-agents/">Guide for AI agents</a><a class="button button--secondary" href="/llms.txt">llms.txt</a></div></div></section><section><div class="wrap"><div class="grid">${AI_EXAMPLES.map(aiExampleCard).join("")}</div></div></section></main>`;
  return shell({ title: "Maps made with chatbots and AI agents", description: "Worked examples of chatbots and AI agents making GIS Map Online maps and briefings from public data, with prompts, code, links and QR codes.", path: "/examples/ai/", breadcrumbs: [{ name: "Examples", path: "/examples/" }, { name: "AI examples", path: "/examples/ai/" }], body });
}

function aiExamplePage(example, link) {
  const path = aiExamplePath(example);
  const code = (lang, text) => `<pre><code class="language-${lang}">${esc(text)}</code></pre>`;
  const files = example.files.map((item) => `<a href="${path}${item.file}" download>${esc(item.label)}</a>`).join(" · ");
  const body = `<main><section class="hero"><div class="wrap"><div class="eyebrow">${esc(example.eyebrow)}</div><h1>${esc(example.title)}</h1><p class="lede">${esc(example.intro)}</p><div class="actions"><a class="button" href="${esc(link)}">${esc(example.openLabel)}</a><a class="button button--secondary" href="/examples/ai/">All AI examples</a></div></div></section><section><div class="wrap prose">
<h2>What it shows off</h2><ul>${example.shows.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
<h2>Ask a chatbot</h2><p>${esc(example.chat.intro)}</p><blockquote class="prompt">${esc(example.chat.prompt)}</blockquote>
<h2>${esc(example.agent.heading)}</h2><p>${esc(example.agent.intro)}</p>${code(example.agent.lang, example.agent.code)}${example.agent.after ? `<p>${esc(example.agent.after)}</p>` : ""}${example.agent.extra ? code(example.agent.extra.lang, example.agent.extra.code) : ""}
<h2>The result</h2><div class="ai-result">${example.qr ? `<figure class="ai-qr"><img src="${path}${example.qr.file}" alt="QR code that opens the ${esc(example.short)}" width="380" loading="lazy"><figcaption>${esc(example.qr.caption)} <a href="${path}${example.qr.file}" download>Download the QR code</a></figcaption></figure>` : ""}<div><p><a href="${esc(link)}">Open the ${esc(example.short)}</a> in GIS Map Online. Everything it needs is in the link (${link.length.toLocaleString("en-US")} characters): no account, no server, no upload.</p><p>${files}</p><details><summary>Show the full link</summary><pre class="endpoint ai-link"><code>${esc(link)}</code></pre></details></div></div>
<h2>Check before you share</h2><ul>${example.caveats.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
<h2>Data</h2><ul>${example.sources.map((source) => `<li><a href="${esc(source.url)}">${esc(source.label)}</a></li>`).join("")}</ul>
<div class="callout"><strong>Make your own.</strong> The <a href="/guides/ai-agents/">guide for AI agents</a> and <a href="/llms.txt">llms.txt</a> explain the link formats, the map and briefing schemas, and the in-page API, for chatbots and agents alike.</div></div></section></main>`;
  const structuredData = { "@type": "TechArticle", headline: example.title, description: example.description, url: `https://gismap.online${path}`, about: example.sources.map((source) => ({ "@type": "Dataset", name: source.label, url: source.url })) };
  return shell({ title: example.title, description: example.description, path, breadcrumbs: [{ name: "Examples", path: "/examples/" }, { name: "AI examples", path: "/examples/ai/" }, { name: example.short, path }], body, structuredData });
}

const workflowExampleCard = (example) => `<article class="card"><div class="eyebrow">${esc(example.kind)}</div><h3>${esc(example.title)}</h3><p>${esc(example.description)}</p><div class="card__links"><a href="${workflowExamplePath(example)}">See how it was made</a></div></article>`;

function workflowExampleSection() {
  return `<section id="workflows"><div class="wrap"><h2>Guided tours and field tasks</h2><p>The other two things a link can carry: a tour that flies the 3D map from place to place, and a field task that sends someone out with a checklist and brings their report back.</p><div class="grid">${WORKFLOW_EXAMPLES.map(workflowExampleCard).join("")}</div></div></section>`;
}

function workflowExamplePage(example, links) {
  const path = workflowExamplePath(example);
  const steps = (list) => `<ol>${list.map((item) => `<li>${esc(item)}</li>`).join("")}</ol>`;
  const first = links[`${example.slug}/${example.links[0].file}`];
  const results = example.links.map((item) => {
    const url = links[`${example.slug}/${item.file}`];
    return `<div class="ai-result">${item.qr ? `<figure class="ai-qr"><img src="${path}${item.qr.file}" alt="QR code: ${esc(item.label)}" width="380" loading="lazy"><figcaption>${esc(item.qr.caption)} <a href="${path}${item.qr.file}" download>Download the QR code</a></figcaption></figure>` : ""}<div><h3>${esc(item.label)}</h3><p><a href="${esc(url)}">Open it</a> in GIS Map Online. Everything is in the link (${url.length.toLocaleString("en-US")} characters): no account, no server, no upload.</p><details><summary>Show the full link</summary><pre class="endpoint ai-link"><code>${esc(url)}</code></pre></details></div></div>`;
  }).join("");
  const body = `<main><section class="hero"><div class="wrap"><div class="eyebrow">${esc(example.eyebrow)}</div><h1>${esc(example.title)}</h1><p class="lede">${esc(example.intro)}</p><div class="actions"><a class="button" href="${esc(first)}">${esc(example.openLabel)}</a><a class="button button--secondary" href="/examples/#workflows">More examples</a></div></div></section><section><div class="wrap prose">
<h2>What it shows off</h2><ul>${example.shows.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
<h2>${esc(example.make.heading)}</h2>${steps(example.make.steps)}
<h2>${esc(example.generate.heading)}</h2><p>${esc(example.generate.intro)}</p><ul>${example.generate.steps.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
${example.agent ? `<h2>${esc(example.agent.heading)}</h2><p>${esc(example.agent.intro)}</p><pre><code class="language-${example.agent.lang}">${esc(example.agent.code)}</code></pre>` : ""}
<h2>The result</h2>${results}
<h2>Check before you share</h2><ul>${example.caveats.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
<h2>Data</h2><ul>${example.sources.map((source) => `<li><a href="${esc(source.url)}">${esc(source.label)}</a></li>`).join("")}</ul></div></section></main>`;
  const structuredData = { "@type": "TechArticle", headline: example.title, description: example.description, url: `https://gismap.online${path}` };
  return shell({ title: example.title, description: example.description, path, breadcrumbs: [{ name: "Examples", path: "/examples/" }, { name: example.short, path }], body, structuredData });
}

export const GUIDES = [
  { slug: "arcgis-rest-service-viewer", title: "ArcGIS REST service viewer", description: "How to open public ArcGIS REST endpoints in a browser-based GIS viewer.", eyebrow: "ArcGIS REST guide", intro: "GISMap can open public ArcGIS FeatureServer, MapServer, and ImageServer URLs directly. The endpoint type determines whether you can inspect vector attributes, view server-rendered maps, or explore imagery.", sections: [
    ["Recognize a service URL", "ArcGIS REST URLs commonly end in FeatureServer, MapServer, or ImageServer. A number such as /0 identifies one layer inside a multi-layer service. GISMap can inspect a service root and, when needed, let you choose a sublayer."],
    ["Open a service", "Choose Data, then Add ArcGIS REST service. Paste the HTTPS endpoint, review any discovered layers, and add the one you need. Public servers must permit cross-origin browser requests; private services may require an ArcGIS connection."],
    ["Choose the right endpoint", "Use FeatureServer for queryable vector features and tables, MapServer for server-rendered cartography and map sublayers, and ImageServer for imagery or raster products. Check the publisher metadata for scale, fields, refresh schedule, and terms."],
  ], example: "esri-world-countries" },
  { slug: "arcgis-feature-service-viewer", title: "ArcGIS FeatureServer viewer", description: "Load, inspect, filter, style, and export public ArcGIS feature layers in your browser.", eyebrow: "Feature layer guide", question: "How can I make an interactive map from an ArcGIS FeatureServer?", answer: "Open the public service in GISMap, choose a layer, then inspect, filter and style it in your browser. A shareable link can reproduce a map using a public service URL. The publisher must permit browser access; authentication, record limits and service availability can affect what you can view or export.", intro: "A FeatureServer publishes queryable geographic features and attributes. In GISMap, supported feature layers can be inspected, filtered, styled, viewed in an attribute table, and exported to common vector formats.", sections: [
    ["Service root or layer URL", "A FeatureServer root may contain several layers and tables. Paste the root to choose among them, or paste a numbered URL such as FeatureServer/0 to open one layer directly."],
    ["Work with attributes", "Click a map feature to inspect its fields, open the attribute table for rows and search, or apply a layer filter. Export can use the active filter, current map extent, or the complete queryable source."],
    ["Common limitations", "The service must allow browser access and may enforce record limits, authentication, or usage constraints. Very large layers are retrieved in pages. Always evaluate publisher metadata before analysis."],
  ], example: "esri-world-countries" },
  { slug: "arcgis-map-service-viewer", title: "ArcGIS MapServer viewer", description: "Understand and open public ArcGIS MapServer endpoints and map sublayers in your browser.", eyebrow: "Map service guide", intro: "A MapServer commonly delivers publisher-controlled map rendering and can contain several sublayers. It is useful when the source’s established cartography matters or when a dataset is not exposed as a FeatureServer.", sections: [
    ["Root and sublayer URLs", "A URL ending in MapServer represents the whole service. A numbered suffix such as MapServer/2 identifies one sublayer. GISMap detects raster sublayers that must remain inside their parent map image layer."],
    ["MapServer versus FeatureServer", "MapServer content is often drawn by the server, while FeatureServer content exposes individual vector features more directly. Identify, filtering, tables, and export depend on the capabilities enabled by the publisher."],
    ["Troubleshooting", "If a service does not load, open its REST metadata page and confirm that it is public, uses HTTPS, supports the desired operation, and allows cross-origin access from the browser."],
  ], example: "usgs-recent-earthquakes-map" },
  { slug: "geojson-viewer", title: "GeoJSON viewer", description: "Open local or remote GeoJSON, inspect its properties, and explore it in 3D.", eyebrow: "Open data guide", question: "How can I open GeoJSON in a browser?", answer: "Use GISMap to open a GeoJSON file from your device or add a public HTTPS GeoJSON URL, then inspect its features and style the layer. Remote URLs require browser cross-origin access. A shared link can reference a public URL, but cannot include a local file’s contents.", intro: "GeoJSON is a portable JSON format for geographic features. GISMap opens local GeoJSON files and public HTTPS GeoJSON URLs without uploading them to an application database.", sections: [
    ["Local files and remote feeds", "Use Open local file for data on your device, or Add GeoJSON URL for a public feed. Remote servers must allow browser cross-origin requests. URLs can be shared; local file contents are never embedded in a share link."],
    ["Explore and export", "Click features to inspect properties, use the table and filter tools for queryable data, and export supported vector geometry to GeoJSON, KML, KMZ, or a zipped Shapefile."],
    ["Data quality checks", "Confirm that coordinates use longitude and latitude, geometry is valid, and properties have consistent types. Live feeds may change between sessions, so consult the publisher for update frequency and definitions."],
  ], example: "usgs-earthquakes-month" },
  { slug: "3d-gis-viewer", title: "3D GIS viewer", description: "Explore public GIS services, terrain, imagery, and vector data in an interactive 3D scene.", eyebrow: "3D GIS guide", question: "How can I make a 3D geographic map without installing desktop GIS?", answer: "GISMap can display supported geographic layers in a browser-based 3D scene with terrain, rotation and tilt. The available terrain, basemaps and 3D styling depend on the map engine and source. A desktop GIS may be a better fit for extensive editing or specialized analysis.", intro: "GISMap uses an interactive 3D scene so geographic layers can be explored with terrain, tilt, rotation, imagery, and familiar map styles—all in the browser.", sections: [
    ["Navigate the scene", "Zoom, rotate, and tilt with the on-map controls or pointer gestures. The home control returns to a broad view, while a layer’s Zoom action frames its available extent."],
    ["Basemaps and terrain", "Basemap styling and ground elevation are independent choices. Imagery can provide visual context, while elevation makes topography legible. Some flat cartographic basemaps remain useful in the same 3D scene."],
    ["Add operational data", "Open ArcGIS REST services, GeoJSON, KML/KMZ, zipped Shapefiles, WMS, or supported WFS sources. Vector layers are draped on the scene ground by default so they remain visible over terrain."],
  ], example: "modis-active-fires" },
  { slug: "ai-agents", path: "/guides/ai-agents/", title: "Making maps with an AI agent", description: "How a language model or agent makes a GIS Map Online map: a link written by hand, code that builds one, or a browser it drives.", eyebrow: "Agent guide", intro: "GIS Map Online opens a map from a link. An agent that can only write text can make a map by writing one JSON object into a URL; agents that run code or drive a browser get validation, statistics and live control. No API key, account or server call is needed.", cta: { href: CORN_LINK, label: "Open the worked example" } },
  { slug: "ai-connection-guide", title: "Connect an AI model", description: "Configure local Ollama or connect an API-key provider for context-aware GIS analysis directly in your browser.", eyebrow: "AI connection guide", intro: "GISMap can send clicked locations, reverse-geocoder details, selected feature data, and loaded-layer metadata to a model you configure. Choose local Ollama or a supported online API provider.", html: `
    <h2>Before you connect</h2>
    <p>Open <strong>Tools → Connect to AI</strong>. GISMap does not provide a hosted model or proxy: your browser connects directly to the endpoint you enter. When you ask a question, the configured provider receives the question and a bounded JSON map context containing the clicked coordinates, address and geocoder details, selected features, and loaded-layer metadata.</p>
    <div class="callout"><strong>API-token privacy.</strong> Online API tokens remain only in page memory, are never written to browser storage or project exports, and must be entered again after a reload. The provider still receives the question and map context. Do not send sensitive data to a provider you do not trust.</div>
    <h2>Option 1: local Ollama</h2>
    <ol>
      <li>Install and start <a href="https://ollama.com/">Ollama</a>, then install a model—for example, run <code>ollama pull llama3.2</code>.</li>
      <li>In GISMap, select <strong>Ollama (local)</strong>. Keep the endpoint <code>http://localhost:11434</code> unless Ollama runs elsewhere.</li>
      <li>Enter the complete installed model tag shown by <code>ollama list</code>, including a suffix such as <code>:27b</code> when present.</li>
      <li>Allow Ollama to accept requests from the GISMap site origin, restart Ollama, select <strong>Test connection</strong>, then select <strong>Use for this tab</strong>.</li>
    </ol>
    <h3>Allow the production site on macOS</h3>
    <pre><code>launchctl setenv OLLAMA_ORIGINS "https://gismap.online"</code></pre>
    <p>Fully quit Ollama from its menu-bar icon and reopen it before testing. For local development, replace the quoted origin with the exact local origin shown in your browser, including its port.</p>
    <h3>Windows or Linux</h3>
    <p>Set <code>OLLAMA_ORIGINS</code> to the exact GISMap origin in the environment used to start the Ollama service, then restart that service. Avoid using <code>*</code>: Ollama's local API has no authentication, so an exact trusted origin is safer.</p>
    <h2>Option 2: an API-key provider</h2>
    <ol>
      <li>Select <strong>OpenAI</strong>, <strong>Anthropic Claude</strong>, or <strong>OpenAI-compatible endpoint</strong>.</li>
      <li>Confirm the HTTPS endpoint and enter a model identifier available to your account.</li>
      <li>Paste the API token and select <strong>Use for this tab</strong>. The token disappears when the page reloads.</li>
    </ol>
    <p>OpenAI uses the <code>/responses</code> API. OpenAI-compatible servers must implement a browser-accessible <code>/chat/completions</code> endpoint. Both must permit cross-origin requests from GISMap. A provider can reject a request because of an invalid model, key, endpoint, account limit, or browser CORS policy.</p>
    <div class="callout"><strong>Production recommendation.</strong> Direct browser keys are suitable only for personal testing. For a public or shared deployment, put paid-provider credentials behind a controlled server-side proxy with authentication, rate limits, origin checks, logging appropriate to your privacy policy, and a restricted model allowlist.</div>
    <h2>Chat with your map: the Map assistant</h2>
    <p>Once a model is connected, open <strong>Tools → Map assistant</strong> and ask in plain words: “Map U.S. corn sales by county”, “make a briefing of these features”, “a guided tour of the five largest ballparks”, “draft a field task to check these two sites”. The assistant reads your data first (fields, codes that mean no data, real feature names and places), then builds the map, briefing, tour or field task, and each step it takes shows in the conversation. Field tasks open as drafts for you to check before sharing.</p>
    <p>GIS Map Online writes the model's instructions itself and sends them with every message, together with what is on the map and the actions it may take, so nothing needs to be set up on the provider's side. Models that support tool calling (most current Ollama, OpenAI, Anthropic and OpenAI-compatible models) act directly; others are guided through a simpler text format. Larger models plan better; on a laptop, expect each step to take a few seconds to a minute.</p>
    <div class="callout"><strong>What the assistant sends.</strong> Your messages, the map's layers and fields, and the results of its actions (such as the features it read) go to the provider you configured. Use local Ollama to keep everything on your computer.</div>
    <h2>Troubleshooting</h2>
    <ul>
      <li><strong>Ollama cannot be reached:</strong> confirm it is running, the endpoint is correct, and <code>OLLAMA_ORIGINS</code> matches the browser origin exactly.</li>
      <li><strong>Model not found:</strong> use the exact tag returned by <code>ollama list</code> or the provider's model list.</li>
      <li><strong>Failed to fetch or CORS error:</strong> the endpoint must allow direct requests from the current GISMap origin.</li>
      <li><strong>401 or 403:</strong> re-enter a valid token and confirm that it has access to the selected model.</li>
      <li><strong>No AI controls:</strong> finish configuration with <strong>Use for this tab</strong>; Intelligence shows AI controls only while a provider is configured.</li>
    </ul>` },
];

/** Where a guide lives: most at /<slug>/, the agent guide at /guides/ai-agents/. */
const guidePath = (guide) => guide.path || `/${guide.slug}/`;

function guidePage(guide, html = guide.html) {
  const item = POPULAR_SERVICES.find((entry) => entry.id === guide.example);
  const guideContent = html || guide.sections.map(([heading, copy]) => `<h2>${esc(heading)}</h2><p>${esc(copy)}</p>`).join("");
  const body = `<main><section class="hero"><div class="wrap"><div class="eyebrow">${esc(guide.eyebrow)}</div><h1>${esc(guide.title)}</h1>${guide.question ? `<h2>${esc(guide.question)}</h2><p>${esc(guide.answer)}</p>` : ""}<p class="lede">${esc(guide.intro)}</p><div class="actions"><a class="button" href="${guide.cta ? esc(guide.cta.href) : item ? appLink(item) : "/"}">${guide.cta ? esc(guide.cta.label) : item ? `Try ${esc(item.title)}` : "Open GISMap"}</a><a class="button button--secondary" href="/examples/">Browse examples</a></div></div></section><section><div class="wrap prose">${guideContent}<div class="callout"><strong>Privacy by design.</strong> GISMap runs in the browser. Remote services are requested from their publishers, and local files stay on the device unless you choose to export or share them elsewhere.</div><h2>Continue exploring</h2><p>Use the <a href="/examples/">public GIS examples catalog</a> to open a working dataset, or return to the <a href="/">GISMap viewer</a> to add your own source.</p></div></section></main>`;
  return shell({ title: guide.title, description: guide.description, path: guidePath(guide), breadcrumbs: [{ name: "Guides", path: "/guides/" }, { name: guide.title, path: guidePath(guide) }], body });
}

function guidesIndex() {
  const body = `<main><section class="hero"><div class="wrap"><div class="eyebrow">GIS viewer guides</div><h1>Open spatial data without desktop GIS.</h1><p class="lede">Learn how to open ArcGIS REST services, FeatureServers, MapServers, GeoJSON, and 3D geographic data directly in a modern browser.</p><div class="actions"><a class="button" href="/">Open GISMap</a><a class="button button--secondary" href="/examples/">Try public datasets</a></div></div></section><section><div class="wrap"><h2>Choose a guide</h2><div class="grid">${GUIDES.map((guide) => `<article class="card"><div class="eyebrow">Guide</div><h3>${esc(guide.title)}</h3><p>${esc(guide.description)}</p><a href="${guidePath(guide)}">Read ${esc(guide.title)}</a></article>`).join("")}</div></div></section></main>`;
  return shell({ title: "GIS viewer guides", description: "Practical guides for viewing ArcGIS REST services, FeatureServers, MapServers, GeoJSON, and 3D GIS data in a browser.", path: "/guides/", breadcrumbs: [{ name: "Guides", path: "/guides/" }], body });
}


/** All generated files. `readText(path)` returns a repository file's text. */
export async function buildSiteOutputs({ readText }) {
  const outputs = new Map();
  outputs.set("api/manifest.json", JSON.stringify(buildManifest(), null, 2) + "\n");
  outputs.set("schemas/application-state-v1.schema.json", JSON.stringify(PUBLIC_STATE_SCHEMA, null, 2) + "\n");
  outputs.set("examples/index.html", examplesIndex());
  for (const item of POPULAR_SERVICES.filter((entry) => entry.featured)) outputs.set(`examples/${item.slug}/index.html`, examplePage(item));
  outputs.set("guides/index.html", guidesIndex());
  const capabilities = JSON.parse(await readText("api/capabilities.json"));
  const agentHtml = renderGuideHtml(agentGuide({ errorCodes: capabilities.errorCodes }));
  for (const guide of GUIDES) outputs.set(`${guidePath(guide).slice(1)}index.html`, guidePage(guide, guide.slug === "ai-agents" ? agentHtml : guide.html));
  const aiLinks = await aiExampleLinks(readText);
  const workflowLinks = await workflowExampleLinks(readText);
  for (const example of WORKFLOW_EXAMPLES) outputs.set(`${workflowExamplePath(example).slice(1)}index.html`, workflowExamplePage(example, workflowLinks));
  outputs.set("examples/ai/index.html", aiExamplesIndex());
  for (const example of AI_EXAMPLES) outputs.set(`${aiExamplePath(example).slice(1)}index.html`, aiExamplePage(example, aiLinks[example.slug]));
  const examples = {
    items: [
      ...AI_EXAMPLES.map((example) => ({ title: example.title, url: `https://gismap.online${aiExamplePath(example)}`, summary: example.description })),
      ...WORKFLOW_EXAMPLES.map((example) => ({ title: example.title, url: `https://gismap.online${workflowExamplePath(example)}`, summary: example.description })),
    ],
    markdown: `${aiExamplesMarkdown(aiLinks)}\n\n${workflowExamplesMarkdown(workflowLinks)}`,
  };
  for (const [path, contents] of Object.entries(await buildAgentOutputs({ readText, examples }))) outputs.set(path, contents);
  const urls = ["/", "/examples/", "/examples/data-connections/local-postgis/", "/guides/", ...POPULAR_SERVICES.filter((item) => item.featured).map((item) => `/examples/${item.slug}/`), ...GUIDES.map(guidePath), "/examples/ai/", ...AI_EXAMPLES.map(aiExamplePath), ...WORKFLOW_EXAMPLES.map(workflowExamplePath), "/skills/", "/api/explorer/", "/llms.txt", "/llms-full.txt", "/api/catalog.json"];
  outputs.set("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((path) => `  <url><loc>https://gismap.online${path}</loc>${path === "/examples/data-connections/local-postgis/" ? "<lastmod>2026-10-18</lastmod>" : ""}</url>`).join("\n")}\n</urlset>\n`);
  return outputs;
}
