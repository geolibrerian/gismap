// Builds the tour and field-task example links (deterministic), and their QR cards.
window.buildWorkflowLinks = async () => {
  const ui = await (await fetch("/js/ui.js?v=0.34.0")).text();
  const version = (name) => ui.match(new RegExp(`(?<![\\w-])${name.replace(".", "\\.")}\\?v=[\\d.]+`))[0];
  const { createEmbeddedTourUrl } = await import(`/js/${version("tour-share.js")}`);
  const { createFieldTaskUrl } = await import(`/js/${version("field-task-share.js")}`);
  const { SHARE_BASEMAPS } = await import(`/js/${version("share.js")}`);
  const { brandedQrFile } = await import(`/js/${version("pdf-document.js")}`);
  const parks = [
    ["Fenway Park", "Boston Red Sox · opened 1912, the oldest ballpark in the majors", 42.34622, -71.09771, 40],
    ["Wrigley Field", "Chicago Cubs · opened 1914, ivy on the outfield walls", 41.94806, -87.65565, 0],
    ["Dodger Stadium", "Los Angeles Dodgers · opened 1962 in Chavez Ravine", 34.07388, -118.23995, 30],
    ["Oriole Park at Camden Yards", "Baltimore Orioles · opened 1992 beside the B&O warehouse", 39.28395, -76.62156, 300],
    ["Coors Field", "Colorado Rockies · opened 1995, a mile above sea level", 39.75635, -104.99414, 0],
    ["Oracle Park", "San Francisco Giants · opened 2000 on the bay", 37.7784, -122.38969, 90],
    ["PNC Park", "Pittsburgh Pirates · opened 2001 facing downtown", 40.44705, -80.00616, 150],
    ["Petco Park", "San Diego Padres · opened 2004 in the Gaslamp Quarter", 32.70757, -117.15704, 0],
  ];
  const presentation = { title: "Eight classic ballparks", skin: "clean-light", playbackMode: "auto", chapters: parks.map(([title, body, lat, lon, heading]) => ({ title, body, basemapId: "satellite", lingerSeconds: 6, transitionMode: "smooth", viewState: { center: [lon, lat], zoom: 16.6, tilt: 55, heading } })) };
  const tour = createEmbeddedTourUrl({ baseUrl: "https://gismap.online/", presentation, allowedBasemaps: new Set(SHARE_BASEMAPS), tourOnly: true });
  const PARKS = "https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/Major_League_Baseball_Stadiums/FeatureServer/0";
  const task = {
    id: "opening-day-pa",
    title: "Opening-day wayfinding check",
    location: "Philadelphia and Pittsburgh ballparks",
    notes: "Before the gates open, check each ballpark's accessible entrances and wayfinding from the nearest transit stop. Mark each ballpark done and add what you found.",
    steps: [{ text: "Accessible entrances open and signed" }, { text: "Wayfinding signs readable from the transit stop" }, { text: "Photo of the main gate taken" }],
    features: [
      { layerUrl: PARKS, objectId: 3, latitude: 39.90618, longitude: -75.16647, label: "Citizens Bank Park" },
      { layerUrl: PARKS, objectId: 17, latitude: 40.44705, longitude: -80.00616, label: "PNC Park" },
    ],
    latitude: 40.17, longitude: -77.58,
  };
  const assign = createFieldTaskUrl({ baseUrl: "https://gismap.online/", task });
  const report = createFieldTaskUrl({ baseUrl: "https://gismap.online/", kind: "return", task: {
    ...task,
    features: task.features.map((feature) => ({ ...feature, done: true })),
    steps: task.steps.map((step, index) => ({ ...step, done: index !== 1 })),
    checkIn: { latitude: 39.90551, longitude: -75.16624, accuracy: 12, at: "2026-03-26T16:42:00.000Z" },
    report: "Both accessible entrances open. At Citizens Bank Park the sign from the subway exit is faded; photo attached to the work order.",
    completedBy: "Field crew A",
    completedAt: "2026-03-26T17:05:00.000Z",
  } });
  const put = (path, body) => fetch(`/${path}`, { method: "PUT", body }).then((response) => response.status);
  const qr = (url, title, lines, footer) => brandedQrFile(url, { title, lines, footer });
  return {
    tour: await put("examples/tours/classic-ballparks/link.txt", `${tour}\n`),
    tourQr: await put("examples/tours/classic-ballparks/qr.png", await qr(tour, "Eight classic ballparks", ["Scan to play the tour: eight ballparks,", "from Fenway Park to Petco Park."], "Complete tour encoded in this QR")),
    assign: await put("examples/field-tasks/opening-day-wayfinding/assignment.txt", `${assign}\n`),
    assignQr: await put("examples/field-tasks/opening-day-wayfinding/assignment-qr.png", await qr(assign, "Opening-day wayfinding check", ["Scan to open the task: two ballparks,", "three steps, check-in and report."], "Complete field task encoded in this QR")),
    report: await put("examples/field-tasks/opening-day-wayfinding/report.txt", `${report}\n`),
    reportQr: await put("examples/field-tasks/opening-day-wayfinding/report-qr.png", await qr(report, "Wayfinding check: report", ["Scan to read the completed report:", "check-in, steps done and notes."], "Complete report encoded in this QR")),
    lengths: [tour.length, assign.length, report.length],
  };
};
