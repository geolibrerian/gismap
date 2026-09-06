import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXAMPLE_CATEGORIES, POPULAR_SERVICES } from "../js/catalog.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const generated = [];
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
<link rel="canonical" href="${canonical}"><meta name="robots" content="index, follow, max-image-preview:large"><meta property="og:type" content="website"><meta property="og:site_name" content="GIS Map Online"><meta property="og:title" content="${esc(title)} | GIS Map Online"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="https://gismap.online/assets/gis-map-online-logo.png"><meta property="og:image:width" content="1536"><meta property="og:image:height" content="600"><meta property="og:image:alt" content="GIS Map Online"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)} | GIS Map Online"><meta name="twitter:description" content="${esc(description)}"><meta name="twitter:image" content="https://gismap.online/assets/gis-map-online-logo.png"><meta name="twitter:image:alt" content="GIS Map Online">
<link rel="stylesheet" href="/css/content.css"><script type="application/ld+json">${jsonLd}</script></head>
<body><header class="site-header"><div class="site-header__inner"><a class="brand" href="/">GIS MAP ONLINE</a><nav class="site-nav" aria-label="Main navigation"><a href="/">Open map</a><a href="/examples/">Examples</a><a href="/guides/">Guides</a><a href="https://github.com/geolibrerian/gismap">GitHub</a></nav></div></header>${breadcrumbHtml}${body}<footer class="site-footer"><div class="wrap">GIS Map Online is a free, browser-based spatial intelligence studio. Public data remains subject to its publisher’s terms.</div></footer></body></html>`;
}

function exampleCard(item) {
  const search = [item.title, item.provider, item.category, typeLabel(item.serviceType), ...item.tags].join(" ").toLowerCase();
  return `<article class="card example-card" data-category="${esc(item.category)}" data-search="${esc(search)}"><div class="eyebrow">${esc(item.category)}</div><h3>${esc(item.title)}</h3><p>${esc(item.description)}</p><div class="meta"><span class="pill">${esc(typeLabel(item.serviceType))}</span><span class="pill">${esc(item.provider)}</span></div><div class="card__links"><a href="${appLink(item)}">Open in GISMap</a>${item.featured ? `<a href="/examples/${esc(item.slug)}/">View details</a>` : ""}</div></article>`;
}

function examplesIndex() {
  const options = EXAMPLE_CATEGORIES.filter((category) => POPULAR_SERVICES.some((item) => item.category === category)).map((category) => `<option>${esc(category)}</option>`).join("");
  const body = `<main><section class="hero"><div class="wrap"><div class="eyebrow">Public GIS examples</div><h1>Open useful spatial data in one click.</h1><p class="lede">Browse curated ArcGIS REST services and GeoJSON feeds, then load them directly into GIS Map Online. No account or desktop GIS installation is required.</p><div class="actions"><a class="button" href="/">Open GISMap</a><a class="button button--secondary" href="#catalog">Browse datasets</a></div></div></section><section id="catalog"><div class="wrap"><h2>Example data catalog</h2><p>Search by topic, publisher, format, or keyword. Service availability and publisher terms can change; verify source metadata before relying on a dataset.</p><div class="controls"><label><span class="eyebrow">Search</span><input id="example-search" type="search" placeholder="Earthquakes, USGS, FeatureServer…"></label><label><span class="eyebrow">Category</span><select id="example-category"><option value="">All categories</option>${options}</select></label></div><div id="example-grid" class="grid">${POPULAR_SERVICES.map(exampleCard).join("")}</div><p id="example-empty" class="empty">No examples match those filters.</p></div></section><section><div class="wrap"><h2>Viewer guides</h2><div class="grid">${GUIDES.map((guide) => `<article class="card"><div class="eyebrow">Guide</div><h3>${esc(guide.title)}</h3><p>${esc(guide.description)}</p><a href="/${guide.slug}/">Read guide</a></article>`).join("")}</div></div></section></main><script>(()=>{const q=document.querySelector('#example-search'),c=document.querySelector('#example-category'),cards=[...document.querySelectorAll('.example-card')],empty=document.querySelector('#example-empty');function filter(){const term=q.value.trim().toLowerCase(),category=c.value;let shown=0;cards.forEach(card=>{const visible=(!term||card.dataset.search.includes(term))&&(!category||card.dataset.category===category);card.hidden=!visible;if(visible)shown++});empty.classList.toggle('is-visible',shown===0)}q.addEventListener('input',filter);c.addEventListener('change',filter)})();</script>`;
  return shell({ title: "Public GIS data examples", description: "Open curated ArcGIS REST services, FeatureServers, MapServers, ImageServers, and GeoJSON feeds directly in a free browser GIS viewer.", path: "/examples/", breadcrumbs: [{ name: "Examples", path: "/examples/" }], body });
}

function examplePage(item) {
  const body = `<main><section class="hero"><div class="wrap"><div class="eyebrow">${esc(item.category)} · ${esc(typeLabel(item.serviceType))}</div><h1>${esc(item.title)}</h1><p class="lede">${esc(item.description)}</p><div class="actions"><a class="button" href="${appLink(item)}">Open this dataset in GISMap</a><a class="button button--secondary" href="/examples/">All examples</a></div></div></section><section><div class="wrap prose"><h2>What this dataset contains</h2><p>${esc(item.description)} ${esc(item.whyUseful)}</p><div class="facts"><div class="fact"><strong>Publisher</strong>${esc(item.sourceOrganization)}</div><div class="fact"><strong>Service type</strong>${esc(typeLabel(item.serviceType))}</div><div class="fact"><strong>Category</strong>${esc(item.category)}</div></div><h2>Open the source directly</h2><p>The button above creates a shareable GISMap URL using the catalog slug. You can also inspect or reuse the publisher endpoint:</p><pre class="endpoint"><code>${esc(item.url)}</code></pre><h2>Attribution and terms</h2><p>${esc(item.licenseOrTerms)}</p><p><a href="${esc(item.sourcePage)}">View the publisher’s source page and metadata</a>.</p><div class="callout"><strong>Availability note.</strong> Public services can change without notice. Confirm currency, coverage, accuracy, and usage terms with the publisher before operational use.</div></div></section></main>`;
  const structuredData = { "@type": "Dataset", name: item.title, description: item.description, url: `https://gismap.online/examples/${item.slug}/`, distribution: { "@type": "DataDownload", contentUrl: item.url, encodingFormat: typeLabel(item.serviceType) }, creator: { "@type": "Organization", name: item.sourceOrganization }, keywords: item.tags.join(", ") };
  return shell({ title: item.title, description: `${item.description} Open this ${typeLabel(item.serviceType)} dataset directly in GIS Map Online.`, path: `/examples/${item.slug}/`, breadcrumbs: [{ name: "Examples", path: "/examples/" }, { name: item.title, path: `/examples/${item.slug}/` }], body, structuredData });
}

const GUIDES = [
  { slug: "arcgis-rest-service-viewer", title: "ArcGIS REST service viewer", description: "How to open public ArcGIS REST endpoints in a browser-based GIS viewer.", eyebrow: "ArcGIS REST guide", intro: "GISMap can open public ArcGIS FeatureServer, MapServer, and ImageServer URLs directly. The endpoint type determines whether you can inspect vector attributes, view server-rendered maps, or explore imagery.", sections: [
    ["Recognize a service URL", "ArcGIS REST URLs commonly end in FeatureServer, MapServer, or ImageServer. A number such as /0 identifies one layer inside a multi-layer service. GISMap can inspect a service root and, when needed, let you choose a sublayer."],
    ["Open a service", "Choose Data, then Add ArcGIS REST service. Paste the HTTPS endpoint, review any discovered layers, and add the one you need. Public servers must permit cross-origin browser requests; private services may require an ArcGIS connection."],
    ["Choose the right endpoint", "Use FeatureServer for queryable vector features and tables, MapServer for server-rendered cartography and map sublayers, and ImageServer for imagery or raster products. Check the publisher metadata for scale, fields, refresh schedule, and terms."],
  ], example: "esri-world-countries" },
  { slug: "arcgis-feature-service-viewer", title: "ArcGIS FeatureServer viewer", description: "Load, inspect, filter, style, and export public ArcGIS feature layers in your browser.", eyebrow: "Feature layer guide", intro: "A FeatureServer publishes queryable geographic features and attributes. In GISMap, supported feature layers can be inspected, filtered, styled, viewed in an attribute table, and exported to common vector formats.", sections: [
    ["Service root or layer URL", "A FeatureServer root may contain several layers and tables. Paste the root to choose among them, or paste a numbered URL such as FeatureServer/0 to open one layer directly."],
    ["Work with attributes", "Click a map feature to inspect its fields, open the attribute table for rows and search, or apply a layer filter. Export can use the active filter, current map extent, or the complete queryable source."],
    ["Common limitations", "The service must allow browser access and may enforce record limits, authentication, or usage constraints. Very large layers are retrieved in pages. Always evaluate publisher metadata before analysis."],
  ], example: "esri-world-countries" },
  { slug: "arcgis-map-service-viewer", title: "ArcGIS MapServer viewer", description: "Understand and open public ArcGIS MapServer endpoints and map sublayers in your browser.", eyebrow: "Map service guide", intro: "A MapServer commonly delivers publisher-controlled map rendering and can contain several sublayers. It is useful when the source’s established cartography matters or when a dataset is not exposed as a FeatureServer.", sections: [
    ["Root and sublayer URLs", "A URL ending in MapServer represents the whole service. A numbered suffix such as MapServer/2 identifies one sublayer. GISMap detects raster sublayers that must remain inside their parent map image layer."],
    ["MapServer versus FeatureServer", "MapServer content is often drawn by the server, while FeatureServer content exposes individual vector features more directly. Identify, filtering, tables, and export depend on the capabilities enabled by the publisher."],
    ["Troubleshooting", "If a service does not load, open its REST metadata page and confirm that it is public, uses HTTPS, supports the desired operation, and allows cross-origin access from the browser."],
  ], example: "usgs-recent-earthquakes-map" },
  { slug: "geojson-viewer", title: "GeoJSON viewer", description: "Open local or remote GeoJSON, inspect its properties, and explore it in 3D.", eyebrow: "Open data guide", intro: "GeoJSON is a portable JSON format for geographic features. GISMap opens local GeoJSON files and public HTTPS GeoJSON URLs without uploading them to an application database.", sections: [
    ["Local files and remote feeds", "Use Open local file for data on your device, or Add GeoJSON URL for a public feed. Remote servers must allow browser cross-origin requests. URLs can be shared; local file contents are never embedded in a share link."],
    ["Explore and export", "Click features to inspect properties, use the table and filter tools for queryable data, and export supported vector geometry to GeoJSON, KML, KMZ, or a zipped Shapefile."],
    ["Data quality checks", "Confirm that coordinates use longitude and latitude, geometry is valid, and properties have consistent types. Live feeds may change between sessions, so consult the publisher for update frequency and definitions."],
  ], example: "usgs-earthquakes-month" },
  { slug: "3d-gis-viewer", title: "3D GIS viewer", description: "Explore public GIS services, terrain, imagery, and vector data in an interactive 3D scene.", eyebrow: "3D GIS guide", intro: "GISMap uses an interactive 3D scene so geographic layers can be explored with terrain, tilt, rotation, imagery, and familiar map styles—all in the browser.", sections: [
    ["Navigate the scene", "Zoom, rotate, and tilt with the on-map controls or pointer gestures. The home control returns to a broad view, while a layer’s Zoom action frames its available extent."],
    ["Basemaps and terrain", "Basemap styling and ground elevation are independent choices. Imagery can provide visual context, while elevation makes topography legible. Some flat cartographic basemaps remain useful in the same 3D scene."],
    ["Add operational data", "Open ArcGIS REST services, GeoJSON, KML/KMZ, zipped Shapefiles, WMS, or supported WFS sources. Vector layers are draped on the scene ground by default so they remain visible over terrain."],
  ], example: "usgs-naip-plus" },
];

function guidePage(guide) {
  const item = POPULAR_SERVICES.find((entry) => entry.id === guide.example);
  const body = `<main><section class="hero"><div class="wrap"><div class="eyebrow">${esc(guide.eyebrow)}</div><h1>${esc(guide.title)}</h1><p class="lede">${esc(guide.intro)}</p><div class="actions"><a class="button" href="${item ? appLink(item) : "/"}">${item ? `Try ${esc(item.title)}` : "Open GISMap"}</a><a class="button button--secondary" href="/examples/">Browse examples</a></div></div></section><section><div class="wrap prose">${guide.sections.map(([heading, copy]) => `<h2>${esc(heading)}</h2><p>${esc(copy)}</p>`).join("")}<div class="callout"><strong>Privacy by design.</strong> GISMap runs in the browser. Remote services are requested from their publishers, and local files stay on the device unless you choose to export or share them elsewhere.</div><h2>Continue exploring</h2><p>Use the <a href="/examples/">public GIS examples catalog</a> to open a working dataset, or return to the <a href="/">GISMap viewer</a> to add your own source.</p></div></section></main>`;
  return shell({ title: guide.title, description: guide.description, path: `/${guide.slug}/`, breadcrumbs: [{ name: "Guides", path: "/guides/" }, { name: guide.title, path: `/${guide.slug}/` }], body });
}

function guidesIndex() {
  const body = `<main><section class="hero"><div class="wrap"><div class="eyebrow">GIS viewer guides</div><h1>Open spatial data without desktop GIS.</h1><p class="lede">Learn how to open ArcGIS REST services, FeatureServers, MapServers, GeoJSON, and 3D geographic data directly in a modern browser.</p><div class="actions"><a class="button" href="/">Open GISMap</a><a class="button button--secondary" href="/examples/">Try public datasets</a></div></div></section><section><div class="wrap"><h2>Choose a guide</h2><div class="grid">${GUIDES.map((guide) => `<article class="card"><div class="eyebrow">Guide</div><h3>${esc(guide.title)}</h3><p>${esc(guide.description)}</p><a href="/${guide.slug}/">Read ${esc(guide.title)}</a></article>`).join("")}</div></div></section></main>`;
  return shell({ title: "GIS viewer guides", description: "Practical guides for viewing ArcGIS REST services, FeatureServers, MapServers, GeoJSON, and 3D GIS data in a browser.", path: "/guides/", breadcrumbs: [{ name: "Guides", path: "/guides/" }], body });
}

async function output(relative, contents) {
  const target = resolve(root, relative);
  if (check) {
    let actual;
    try { actual = await readFile(target, "utf8"); } catch { throw new Error(`Generated file is missing: ${relative}`); }
    if (actual !== contents) throw new Error(`Generated file is out of date: ${relative}`);
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
  generated.push(relative);
}

await output("examples/index.html", examplesIndex());
for (const item of POPULAR_SERVICES.filter((entry) => entry.featured)) await output(`examples/${item.slug}/index.html`, examplePage(item));
await output("guides/index.html", guidesIndex());
for (const guide of GUIDES) await output(`${guide.slug}/index.html`, guidePage(guide));
const urls = ["/", "/examples/", "/guides/", ...POPULAR_SERVICES.filter((item) => item.featured).map((item) => `/examples/${item.slug}/`), ...GUIDES.map((guide) => `/${guide.slug}/`)];
await output("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((path) => `  <url><loc>https://gismap.online${path}</loc><lastmod>2026-09-06</lastmod></url>`).join("\n")}\n</urlset>\n`);
console.log(`${check ? "Verified" : "Generated"} ${generated.length} files.`);
