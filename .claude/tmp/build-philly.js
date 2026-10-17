// Writes the Philadelphia example's files from the new full briefing link:
// link.txt, briefing.json (the slides), map.json (the same map and slides as a
// map-v1 spec, for the agent recipe) and qr.png. Verifies the spec link opens the same slides.
window.buildPhilly = async () => {
  const link = (await (await fetch("/.claude/tmp/philly-new-link.txt", { cache: "no-store" })).text()).trim();
  const ui = await (await fetch("/js/ui.js?v=0.34.0")).text();
  const version = (name) => ui.match(new RegExp(`(?<![\\w-])${name.replace(".", "\\.")}\\?v=[\\d.]+`))[0];
  const { readShareLocation } = await import(`/js/${version("map-share.js")}`);
  const { brandedQrFile } = await import(`/js/${version("pdf-document.js")}`);
  const core = await import("/js/gismap-core.js");
  const shared = await readShareLocation(new URL(link));
  const [divisions, districts] = shared.layers;
  // Slides without the per-block IDs the app adds, so the file reads like hand-written JSON.
  const slides = shared.briefing.slides.map(({ blocks, ...slide }) => ({ ...slide, blocks: blocks.map(({ id, ...block }) => block) }));
  const briefing = { schemaVersion: 1, layerId: divisions.url, selection: { useAll: true }, slides };
  const spec = {
    version: 1,
    title: shared.title,
    basemap: shared.basemap,
    skin: shared.skin,
    camera: { center: shared.camera.center, zoom: shared.camera.zoom, heading: 0, tilt: shared.camera.tilt },
    layers: [
      { url: divisions.url, title: divisions.title },
      { url: districts.url, title: districts.title, opacity: districts.opacity },
    ],
    briefing,
  };
  const valid = core.mapSpec.validate(spec);
  const specLink = await core.mapSpec.createLink(spec, { baseUrl: "https://gismap.online/" });
  const reopened = await core.mapSpec.decode(specLink.url.split("#map=")[1]);
  const qr = await brandedQrFile(link, { title: "Philadelphia police divisions", lines: [`Scan to present ${slides.length} slides: divisions,`, "with the districts inside them."], footer: "Complete briefing encoded in this QR" });
  const put = (path, body) => fetch(`/${path}`, { method: "PUT", body }).then((response) => response.status);
  const dir = "examples/ai/philadelphia-police-divisions";
  return {
    valid: valid.valid, issues: valid.issues, slides: slides.length, specLinkLength: specLink.url.length, specQr: specLink.qr, reopenedSlides: reopened.briefing.slides.length,
    link: await put(`${dir}/link.txt`, `${link}\n`),
    briefing: await put(`${dir}/briefing.json`, `${JSON.stringify(briefing, null, 2)}\n`),
    map: await put(`${dir}/map.json`, `${JSON.stringify({ $schema: "https://gismap.online/schemas/map-v1.schema.json", ...spec }, null, 2)}\n`),
    qr: await put(`${dir}/qr.png`, qr),
  };
};
