# Charting Tools

Charts & Analytics is available from **Tools → Charts & Analytics**. The
builder stores a portable GISMap chart definition, then translates that
definition to Apache ECharts only at render time. ECharts is lazy-loaded from
the pinned 5.5.1 CDN build; the builder retains a keyboard-accessible HTML bar
fallback if it cannot be loaded.

## Data contract

`js/charting-tools.js` owns the versioned chart model and aggregation output.
Definitions are stored at `project.charts`, never with copied source records:

```json
{
  "schemaVersion": 1,
  "id": "chart-id",
  "type": "bar",
  "source": { "layerId": "stable-layer-id", "scope": "filtered" },
  "dimension": { "field": "YEAR_", "interpretation": "category" },
  "measure": { "field": "GIS_ACRES", "aggregation": "sum" },
  "interaction": { "mapHighlight": true, "crossFilter": false }
}
```

The query adapter uses the map controller rather than an engine-specific
renderer. `filtered` uses the layer’s active canonical definition expression;
`all` ignores it, and `viewport` adds the current map extent. When an engine
reports a transfer limit, the chart is marked partial and is not presented as
a complete aggregate.

## Interaction and dashboard

Clicking a chart mark publishes a shared selection containing the matching
features and asks the active map engine to highlight the representative
feature. Adding a chart to Instant Dashboard creates the existing `charts`
panel with the same stored chart definition, so it remains bound to the map
layer after a map-engine switch or project reload.

The current Phase 1 renderer supports bar, line, area, histogram, scatter,
donut, and KPI charts. It does not turn a chart click into a permanent layer
filter: selection and filtering remain separate operations.
