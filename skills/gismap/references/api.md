# API and workflow

The canonical discovery document is https://gismap.online/api/capabilities.json. The pure client module is https://gismap.online/js/gismap-core.js; its `sources`, `renderers`, `mapSpec`, and `briefing` namespaces are documented at https://gismap.online/guides/ai-agents/. There is no hosted REST authoring endpoint or MCP server. In-browser APIs require `await gisMapOnline.ready`.

Typical in-page flow: `await gisMapOnline.sources.inspect(url)`, `gisMapOnline.mapSpec.validate(spec)`, `await gisMapOnline.mapSpec.createLink(spec)`, and `await gisMapOnline.mapSpec.decode(payload)`. `gisMapOnline.layers.add`, `layers.update`, `camera.fitTo`, and `describe` control or inspect a running page. Check live capabilities before use; inspect `issues` and any normalized output, not just `valid`.

Dataset-discovery integrations are optional. A provider-neutral discovery result can contain title, description, source URL, geographic coverage, geometry, fields, license and service operations. Treat it as a lead; inspect the actual source independently. No live mcp.place connection is claimed.
