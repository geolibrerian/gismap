# Cinematic Mode v0.3 — adaptive animation plan

This turns the v0.3 "Adaptive Animations" proposal into an order of work that
fits GISMap as it is: static ES modules, one shared clock, MapLibre + ArcGIS
engines, Clips that export frame-accurate movies, and decorative effects that
never change data.

## Done in the first slice

**Measured, then fixed, the slowdown in large scenes.** Profiling the California
Historic Fire Perimeters build-up (17,950 features) showed four causes. None
was the map filter, which costs about 1 ms even at 18,000 features.

| Cause | Fix |
|---|---|
| The effect budget kept the *oldest* outlines, so past ~3,000 fires the newest perimeter (the one that should flare) got no effect. | Budgets are spent newest first (fresh, then from the end of the list). |
| Every step rebuilt every outline: up to ~190,000 vertices / 180,000 triangles, 30–70 ms of CPU. | Build-ups split into a **settled** layer (older outlines, edge only, rebuilt about every 120 steps, when stepping back, or on a zoom-level change) and a **recent** layer (the newest 120–240, full flames, rebuilt each step). |
| On 3D terrain each rebuild re-sampled ground heights: ~5,000 lookups per geometry at ~20 µs, then again for 8 s. | A shared terrain-height cache (metres, keyed by terrain state and zoom level). Refreshes while tiles load are capped at 4. |
| Full flame detail on every perimeter, even a few pixels across at state zoom. | Effect geometry is simplified to half a screen pixel at the current zoom (the map still draws the exact outline). There is a **Detail** setting (Auto / Eco / Balanced / Cinematic): Eco draws edges only, Balanced draws flames on the newest outlines only, and Auto chooses from scene size. |

Result at state zoom on the same scene: about 660 vertices / 1 ms per step for
the recent layer, plus about 1,300 vertices for the settled layer, built
occasionally. Before, it was about 140,000 vertices / 60 ms every step.

**Animation without a date field.** A layer's temporal mapping has a `kind`:

- `time`: the observed timeline, as before.
- `number`: **Scenario**, a sweep through a numeric field's values, lowest first. Build up shows everything up to the current value.
- `none`: **Ambient**, every feature at once with its effect looping. There is no timeline bar. Export movie records the loop with the Clip's camera moves.

The setup dialog asks "Animate by". Ranges, Go to, labels, Clips and Clip
JSON all understand the three kinds.

**Create an animation guide.** A 10-step hands-on walkthrough, from the Tools
and Modes menus, the setup dialog and the Cinematic panel. It loads an example
layer if the map has none.

## Next phases

### Phase 1 — Performance foundation (continue)
1. **Frame-time monitor and diagnostics panel** (Tools → Cinematic diagnostics):
   draw calls, vertices, effect items, settled/recent sizes, build ms, and
   measured frame time. Auto Detail steps down when sustained frame time
   exceeds a budget. It reads `document.visibilityState`, so a background tab
   doesn't count as slow.
2. **Idle rendering:** stop continuous repaint when nothing animates (effects
   paused, reduced motion, or Detail = Eco with static edges).
3. **Worker geometry prep:** move `effectParts` / ribbon building for settled
   layers into a Web Worker. It's already pure, deterministic data → buffers.
4. **Native-layer tier:** at regional zoom, draw settled fire edges as a
   MapLibre line layer (blur + width expressions) instead of three.js.
   That needs no custom GL and costs almost nothing.
5. **Scenario binning:** sweep a numeric field in N quantile or equal steps
   (default about 200) instead of every distinct value. A 23,290-value acreage
   sweep is too fine-grained.

### Phase 2 — Animation primitives and tracks
Recast effects as primitives with one interface (geometry, attribute mapping,
time source, style, backend, quality): **Pulse, Flow, Spread, Extrude,
Reveal, Particle field**. The existing glow/fire/pulse/wind/water/flow become
recipes over these.
- Distinguish `dataTime`, `animationTime`, `phase` (0–1 in a cycle) and
  `scenarioValue` in the shared clock; effects read `phase`, so loops stay
  deterministic when seeking and exporting.
- **Multiple tracks:** several layers, each with its own effect and cycle,
  composed under the master clock (traffic + electricity + trees together).
- Field mappings per recipe (e.g. Flow `intensityField`, `direction`), never
  implying physical speed from animation speed.

### Phase 3 — Recommender and recipes
- **Animate this layer** recommender (rules, no AI required): point + time →
  event playback, line + direction/magnitude → flow, polygon + number + year →
  choropleth or extrusion over time, buildings + dates → construction reveal.
- Demonstrator recipes: wildfire perimeter (tiered), hurricane track,
  flood inundation (scenario depth), traffic flow (ambient), population
  extrusion (statistical).
- Semantic presentation policies: Scientific / Operational / Cinematic /
  Educational, with an observed / modeled / illustrative label on every recipe.

### Phase 4 — Library growth
Extreme events (hurricane, tornado, flood, heat, rain, snow/ice, smoke,
lightning), infrastructure (electric, water, gas, transit, construction),
statistical cinematics (crime hotspots on aggregated cells, property values,
demographics, commuting flows), and planning (zoning envelopes from real
ordinances, existing vs proposed, shadow studies). Each is a recipe over the
primitives. Statistical recipes animate the statistic, not imaginary people.
Sensitive point data is aggregated.

### Phase 5 — Optional renderers
Three.js instancing for repeated objects (trees, vehicles, birds), and
deck.gl or texture-based animation for very large fields, added only where a
recipe needs it and a benchmark justifies the dependency.

## Rules carried through every phase
- Decoration gives way first; data is never dropped or reinterpreted to keep
  a frame rate.
- One master clock: interactive playback, Briefs and movie export render the
  same moment the same way.
- Animation speed is never presented as physical speed.
- What was observed, modeled, simulated or illustrated stays visible to the viewer.
