// A small PDF writer for the app's reports: letter pages with the GIS Map Online
// header band, wrapped Helvetica text, and JPEG images. No dependencies.
const textEncoder = new TextEncoder();

export const dataUrlBytes = (dataUrl) => Uint8Array.from(atob(String(dataUrl).split(",")[1] || ""), (character) => character.charCodeAt(0));

/**
 * Re-encodes an image as a JPEG asset for a PDF. With `width` and `height` the
 * image is letterboxed onto that canvas; with `maxSide` it keeps its own shape.
 */
export function imageToJpeg(source, { width, height, maxSide, quality = 0.92, background = "#ffffff" } = {}) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => {
      const natural = { width: image.naturalWidth || 1, height: image.naturalHeight || 1 };
      const scaleToFit = maxSide ? Math.min(1, maxSide / Math.max(natural.width, natural.height)) : 1;
      const canvasWidth = width ?? Math.round(natural.width * scaleToFit);
      const canvasHeight = height ?? Math.round(natural.height * scaleToFit);
      const canvas = document.createElement("canvas");
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
      const context = canvas.getContext("2d");
      context.fillStyle = background;
      context.fillRect(0, 0, canvasWidth, canvasHeight);
      const scale = Math.min(canvasWidth / natural.width, canvasHeight / natural.height);
      const drawWidth = natural.width * scale;
      const drawHeight = natural.height * scale;
      context.drawImage(image, (canvasWidth - drawWidth) / 2, (canvasHeight - drawHeight) / 2, drawWidth, drawHeight);
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      resolve({ bytes: dataUrlBytes(dataUrl), width: canvasWidth, height: canvasHeight, dataUrl });
    };
    image.onerror = () => resolve(null);
    image.src = source;
  });
}

export const BRAND_LOGO = "./assets/gis-map-online-mark-v2.png";
// The header band colour; the logo is flattened onto it so it has no white box.
const HEADER_BAND = "#0f2921";

/** The GIS Map Online mark as a JPEG asset that blends into the PDF header band. */
export const loadBrandLogo = () => imageToJpeg(BRAND_LOGO, { width: 120, height: 120, background: HEADER_BAND });

const loadImage = (source) => new Promise((resolve) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => resolve(null);
  image.src = source;
});

/**
 * Frames a map snapshot like the QR cards, for every PDF the app makes: a green
 * border, the GIS Map Online mark and name, a title and subtitle above, and an
 * optional pin legend below. `legend` items are { shape: "diamond" | "small-diamond"
 * | "circle", label }. `footerText` provides a plain left-aligned alternative
 * for exports, such as Smart Images, that do not have a truthful symbol legend.
 */
export async function brandedMapCanvas(mapImage, {
  title = "",
  subtitle = "",
  legend = [],
  footerText = "",
  mapWidth = 1200,
} = {}) {
  const [map, logo] = await Promise.all([loadImage(mapImage.dataUrl), loadImage(BRAND_LOGO)]);
  if (!map) return null;
  const border = 18;
  const header = 118;
  const footer = 64;
  const mapHeight = Math.round(mapWidth * (mapImage.height / mapImage.width));
  const canvas = document.createElement("canvas");
  canvas.width = mapWidth + border * 2;
  canvas.height = header + mapHeight + footer + border;
  const context = canvas.getContext("2d");
  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, "#071f1c");
  gradient.addColorStop(1, "#145b4e");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#f3ae2b";
  context.fillRect(0, 0, 10, canvas.height);
  if (logo) context.drawImage(logo, border + 14, 18, 82, 82);
  context.textBaseline = "alphabetic";
  context.fillStyle = "#55cdb1";
  context.font = "700 26px system-ui, sans-serif";
  context.fillText("GIS MAP", border + 112, 50);
  context.fillStyle = "#f3ae2b";
  context.font = "700 15px system-ui, sans-serif";
  context.fillText("O N L I N E", border + 114, 74);
  context.textAlign = "right";
  context.fillStyle = "#ffffff";
  context.font = "700 34px Georgia, serif";
  context.fillText(String(title).slice(0, 48), canvas.width - border - 10, 56, 760);
  context.fillStyle = "#b8d8d0";
  context.font = "20px system-ui, sans-serif";
  context.fillText(String(subtitle).slice(0, 90), canvas.width - border - 10, 90, 760);
  context.textAlign = "left";
  context.drawImage(map, border, header, mapWidth, mapHeight);
  context.strokeStyle = "#55cdb1";
  context.lineWidth = 3;
  context.strokeRect(border - 1.5, header - 1.5, mapWidth + 3, mapHeight + 3);
  const legendY = header + mapHeight + 40;
  let x = border + 10;
  const diamond = (cx, cy, size) => {
    context.fillStyle = "#d9951e";
    context.strokeStyle = "#ffffff";
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(cx, cy - size); context.lineTo(cx + size, cy); context.lineTo(cx, cy + size); context.lineTo(cx - size, cy); context.closePath();
    context.fill(); context.stroke();
  };
  const shapes = {
    diamond: (cx, cy) => diamond(cx, cy, 10),
    "small-diamond": (cx, cy) => diamond(cx, cy, 7),
    circle: (cx, cy) => {
      context.fillStyle = "#0f8f6e";
      context.strokeStyle = "#ffffff";
      context.lineWidth = 3;
      context.beginPath(); context.arc(cx, cy, 9, 0, Math.PI * 2); context.fill(); context.stroke();
    },
  };
  legend.forEach(({ shape, label }) => {
    shapes[shape]?.(x + 12, legendY - 7);
    context.fillStyle = "#ffffff";
    context.font = "600 20px system-ui, sans-serif";
    context.fillText(label, x + 32, legendY);
    x += 44 + context.measureText(label).width;
  });
  if (!legend.length && footerText) {
    context.fillStyle = "#ffffff";
    context.font = "600 18px system-ui, sans-serif";
    context.fillText(String(footerText).slice(0, 92), x, legendY, canvas.width - border * 2 - 190);
  }
  context.fillStyle = "#f3ae2b";
  context.font = "700 18px system-ui, sans-serif";
  context.textAlign = "right";
  context.fillText("gismap.online", canvas.width - border - 10, legendY);
  context.textAlign = "left";
  return canvas;
}

export async function brandedMapImage(mapImage, options = {}) {
  const canvas = await brandedMapCanvas(mapImage, options);
  if (!canvas) return null;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return { bytes: dataUrlBytes(dataUrl), width: canvas.width, height: canvas.height };
}

// PDF strings escape backslashes and parentheses; URLs are otherwise plain ASCII here.
const pdfUri = (url) => String(url).replace(/[^\x20-\x7e]/g, "").replace(/[\\()]/g, "\\$&");

// The built-in PDF fonts use a limited encoding. Preserve the meaning of common
// map and measurement characters instead of emitting question marks.
export const pdfSafeText = (value) => String(value ?? "")
  .replace(/[µμ]/g, "u").replace(/³/g, "3").replace(/²/g, "2")
  .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/[·•]/g, "-")
  .replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "?");

const wrap = (value, maxChars) => String(value ?? "").split(/\n/).flatMap((paragraph) => {
  if (!paragraph.trim()) return [""];
  const words = paragraph.trim().split(/\s+/);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    if (`${line} ${word}`.trim().length > maxChars && line) {
      lines.push(line);
      line = word;
    } else line = `${line} ${word}`.trim();
  });
  if (line) lines.push(line);
  return lines;
});

export const PDF_COLORS = Object.freeze({ ink: "0.09 0.16 0.14", muted: "0.36 0.44 0.41", accent: "0.08 0.36 0.30", link: "0.05 0.40 0.55" });

export class PdfDocument {
  constructor({ heading, logo = null, homeUrl = "https://gismap.online/", pageWidth = 612, pageHeight = 792, margin = 48 }) {
    Object.assign(this, { heading, logo, homeUrl, pageWidth, pageHeight, margin });
    this.pages = [];
    this.page = null;
    this.y = 0;
    this.newPage();
  }

  newPage() {
    // The header band mirrors the QR cards: dark green, a gold edge, the mark,
    // "GIS MAP" in teal over a spaced, gold "ONLINE". It links to the site.
    this.page = { commands: [
      "0.06 0.16 0.13 rg 48 704 516 44 re f",
      "0.95 0.68 0.17 rg 48 704 4 44 re f",
      "0.33 0.80 0.69 rg BT /F2 15 Tf 100 729 Td (GIS MAP) Tj ET",
      "0.95 0.68 0.17 rg BT /F2 7.5 Tf 2.2 Tc 101 715 Td (ONLINE) Tj ET 0 Tc",
      `0.08 0.37 0.30 rg BT /F2 11 Tf 48 682 Td (${pdfSafeText(this.heading)}) Tj ET`,
    ], images: [], links: [] };
    if (this.logo) {
      this.page.images.push({ name: "ImLogo", asset: this.logo });
      this.page.commands.push("q 36 0 0 36 60 708 cm /ImLogo Do Q");
    }
    if (this.homeUrl) this.addLink([48, 704, 260, 748], this.homeUrl);
    this.pages.push(this.page);
    this.y = 660;
  }

  /** Makes a rectangle [x1, y1, x2, y2] on the current page open a URL. */
  addLink(rect, url) {
    if (url) this.page.links.push({ rect: rect.map((value) => Number(value).toFixed(2)), url });
  }

  gap(points) {
    this.y -= points;
  }

  /** Wrapped text. With `link`, each line is underlined and opens the URL. */
  addLines(text, { size = 10, leading = 15, color = PDF_COLORS.ink, bold = false, maxChars = 91, link = null } = {}) {
    wrap(text, maxChars).forEach((line) => {
      if (this.y < this.margin + leading) this.newPage();
      const lineColor = link ? PDF_COLORS.link : color;
      this.page.commands.push(`${lineColor} rg BT /F${bold ? 2 : 1} ${size} Tf ${this.margin} ${this.y} Td (${pdfSafeText(line)}) Tj ET`);
      if (link) {
        // Helvetica averages about half the font size per character.
        const width = Math.min(this.pageWidth - this.margin * 2, line.length * size * 0.52);
        this.page.commands.push(`${lineColor} RG 0.6 w ${this.margin} ${this.y - 1.6} m ${(this.margin + width).toFixed(2)} ${this.y - 1.6} l S`);
        this.addLink([this.margin, this.y - 3, this.margin + width, this.y + size], link);
      }
      this.y -= leading;
    });
  }

  heading2(text) {
    this.addLines(text, { size: 13, leading: 18, color: PDF_COLORS.accent, bold: true });
  }

  /** Places an image at full text width (or narrower to respect maxHeight), starting a page if it does not fit. */
  addImage(asset, { maxHeight = 360, gapAfter = 18, link = null, maxWidth: widthLimit = null } = {}) {
    if (!asset?.bytes?.length) return;
    const maxWidth = widthLimit ?? this.pageWidth - (this.margin * 2);
    const ratio = asset.height / asset.width;
    const imageHeight = Math.min(maxHeight, maxWidth * ratio);
    const imageWidth = imageHeight / ratio;
    if (this.y - imageHeight < this.margin) this.newPage();
    const name = `Im${this.pages.length}x${this.page.images.length}`;
    this.page.images.push({ name, asset });
    this.page.commands.push(`q ${imageWidth.toFixed(2)} 0 0 ${imageHeight.toFixed(2)} ${this.margin} ${(this.y - imageHeight).toFixed(2)} cm /${name} Do Q`);
    if (link) this.addLink([this.margin, this.y - imageHeight, this.margin + imageWidth, this.y], link);
    this.y -= imageHeight + gapAfter;
  }

  /**
   * A ruled table. `columns` are { label, width } in points (summing to the text
   * width); cells wrap within their column and rows move to a new page whole,
   * repeating the header.
   */
  addTable(columns, rows, { size = 7, leading = 9, padding = 4 } = {}) {
    const charsFor = (width) => Math.max(4, Math.floor((width - padding * 2) / (size * 0.5)));
    const cellLines = (value, width) => wrap(value, charsFor(width)).flatMap((line) => {
      const max = charsFor(width);
      const chunks = [];
      for (let index = 0; index < line.length; index += max) chunks.push(line.slice(index, index + max));
      return chunks.length ? chunks : [""];
    });
    const drawRow = (cells, { header = false } = {}) => {
      const lines = cells.map((value, index) => cellLines(value, columns[index].width));
      const height = Math.max(...lines.map((cell) => cell.length)) * leading + padding * 2;
      if (this.y - height < this.margin) {
        this.newPage();
        if (!header) drawRow(columns.map((column) => column.label), { header: true });
      }
      const top = this.y;
      if (header) this.page.commands.push(`0.91 0.95 0.93 rg ${this.margin} ${(top - height).toFixed(2)} ${this.pageWidth - this.margin * 2} ${height.toFixed(2)} re f`);
      let x = this.margin;
      lines.forEach((cell, index) => {
        cell.forEach((line, lineIndex) => {
          this.page.commands.push(`${header ? PDF_COLORS.accent : PDF_COLORS.ink} rg BT /F${header ? 2 : 1} ${size} Tf ${(x + padding).toFixed(2)} ${(top - padding - size - lineIndex * leading).toFixed(2)} Td (${pdfSafeText(line)}) Tj ET`);
        });
        x += columns[index].width;
      });
      this.page.commands.push(`0.75 0.80 0.78 RG 0.5 w ${this.margin} ${(top - height).toFixed(2)} m ${this.pageWidth - this.margin} ${(top - height).toFixed(2)} l S`);
      this.y = top - height;
    };
    drawRow(columns.map((column) => column.label), { header: true });
    rows.forEach((row) => drawRow(row.map((value) => String(value ?? ""))));
    this.y -= 12;
  }

  toBlob() {
    const objects = [null];
    const reserve = () => { objects.push(""); return objects.length - 1; };
    const setObject = (id, value) => { objects[id] = value; };
    const catalogId = reserve();
    const pagesId = reserve();
    const regularFontId = reserve();
    const boldFontId = reserve();
    setObject(regularFontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    setObject(boldFontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    const imageIds = new Map();
    const imageObject = (asset) => {
      if (imageIds.has(asset)) return imageIds.get(asset);
      const imageId = reserve();
      const header = textEncoder.encode(`<< /Type /XObject /Subtype /Image /Width ${asset.width} /Height ${asset.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${asset.bytes.length} >>\nstream\n`);
      const footer = textEncoder.encode("\nendstream");
      const bytes = new Uint8Array(header.length + asset.bytes.length + footer.length);
      bytes.set(header);
      bytes.set(asset.bytes, header.length);
      bytes.set(footer, header.length + asset.bytes.length);
      setObject(imageId, bytes);
      imageIds.set(asset, imageId);
      return imageId;
    };
    const pageIds = this.pages.map((currentPage) => {
      const stream = currentPage.commands.join("\n");
      const contentId = reserve();
      setObject(contentId, `<< /Length ${textEncoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
      const pageId = reserve();
      const xObjects = currentPage.images.map(({ name, asset }) => `/${name} ${imageObject(asset)} 0 R`).join(" ");
      const annotations = currentPage.links.map(({ rect, url }) => {
        const annotationId = reserve();
        setObject(annotationId, `<< /Type /Annot /Subtype /Link /Rect [${rect.join(" ")}] /Border [0 0 0] /A << /S /URI /URI (${pdfUri(url)}) >> >>`);
        return `${annotationId} 0 R`;
      });
      setObject(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >>${xObjects ? ` /XObject << ${xObjects} >>` : ""} >>${annotations.length ? ` /Annots [${annotations.join(" ")}]` : ""} /Contents ${contentId} 0 R >>`);
      return pageId;
    });
    setObject(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    setObject(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const chunks = [textEncoder.encode("%PDF-1.4\n%????\n")];
    let length = chunks[0].length;
    const offsets = [0];
    objects.slice(1).forEach((object, index) => {
      offsets[index + 1] = length;
      const head = textEncoder.encode(`${index + 1} 0 obj\n`);
      const body = typeof object === "string" ? textEncoder.encode(object) : object;
      const tail = textEncoder.encode("\nendobj\n");
      chunks.push(head, body, tail);
      length += head.length + body.length + tail.length;
    });
    const xrefOffset = length;
    chunks.push(textEncoder.encode(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
    return new Blob(chunks, { type: "application/pdf" });
  }
}
