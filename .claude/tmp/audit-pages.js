window.auditPages = async (pages) => {
  const script = await (await fetch("/.claude/tmp/contrast-audit.js", { cache: "no-store" })).text();
  const report = {};
  for (const page of pages) {
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:900px;opacity:0;pointer-events:none";
    frame.src = page;
    document.body.append(frame);
    await new Promise((resolve) => frame.addEventListener("load", resolve, { once: true }));
    frame.contentWindow.eval(script);
    frame.contentDocument.querySelectorAll("details").forEach((details) => { details.open = true; });
    report[page] = frame.contentWindow.contrastAudit().map((item) => `${item.tag}.${item.cls} "${item.text}" ${item.ratio}`);
    frame.remove();
  }
  return { dark: matchMedia("(prefers-color-scheme: dark)").matches, report };
};
