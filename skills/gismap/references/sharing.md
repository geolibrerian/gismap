# Sharing

`await mapSpec.createLink(spec)` returns a URL and QR suitability; `mapSpec.decode` checks its encoded content. Inspect the decoded spec against intended filters, layers, renderer, camera and briefing. Then open the result in the app and verify rendered state. Encoded equality is not a rendering or mobile test. Public links expose their content: do not include credentials, sensitive personal information, or private service URLs. Respect payload limits; use the app's supported file export or hosted map spec instead of a third-party shortener. See https://gismap.online/guides/ai-agents/.

## Embeds

GISMap can publish a configured **public map** as an iframe. The embedded map preserves the public layers, style, layer filters, camera, basemap and interface skin in the share URL. It is a live map, not a screenshot or a copied dataset. Use the Share & export dialog's Embed option, or in a running assistant session call `get_map_embed` to receive the embed URL and paste-ready iframe.

For a normal map share URL, use the standalone helpers at `https://gismap.online/js/embed-share.js`:

```js
import { createEmbedUrl, createEmbedIframe } from "https://gismap.online/js/embed-share.js";

const embedUrl = createEmbedUrl(sharedMapUrl, { kind: "map" });
const iframe = createEmbedIframe(sharedMapUrl, {
  kind: "map",
  title: "County health dashboard",
  height: 600,
});
```

`kind` may be `map`, `briefing` or `tour` when the supplied share URL is that artifact. The helper only adds `embed=1` and `embedKind`; the original share fragment remains the authoritative configuration. Heights are bounded to 280–1200 px. Test the final iframe in the destination site, including resize behavior, keyboard navigation, fullscreen and geolocation permission. Do not claim it is embedded or working just because the string was generated.

Embeds can only carry shareable public web resources. Local files, device-only layers, private URLs, and sources with tokens, keys or passwords must be exported as a project/package or hosted by the publisher with suitable public access. The remote publisher can still change, throttle, block CORS, or remove a public service after embedding.
