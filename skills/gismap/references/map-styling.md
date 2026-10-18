# Styling and 3D

See https://gismap.online/schemas/renderer-v1.schema.json and https://gismap.online/api/capabilities.json. Inspect source fields and their types first; build a renderer with supported types such as `choropleth`, using the real field and an advertised classification method/ramp. `renderers.validate` can check a renderer and field compatibility when supplied fields; `layers.suggestStyles` can recommend styles for a loaded layer. Preserve pinned class breaks when reproducibility matters.

3D extrusion and renderer compatibility differ between engines. Do not invent a normalized extrusion schema or claim a renderer works on both engines; verify the actual engine and rendered heights, including null/negative data. Unsupported renderers or dropped configuration require an explicit warning or a verified fallback.
