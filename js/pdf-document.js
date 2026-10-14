// A small PDF writer for the app's reports: letter pages with the GIS Map Online
// header band, wrapped Helvetica text, and JPEG images. No dependencies.
const textEncoder = new TextEncoder();

export const dataUrlBytes = (dataUrl) => Uint8Array.from(atob(String(dataUrl).split(",")[1] || ""), (character) => character.charCodeAt(0));

/**
 * Re-encodes an image as a JPEG asset for a PDF. With `width` and `height` the
 * image is letterboxed onto that canvas; with `maxSide` it keeps its own shape.
 */
export function imageToJpeg(source, { width, height, maxSide, quality = 0.92 } = {}) {
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
      context.fillStyle = "#ffffff";
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

export const PDF_COLORS = Object.freeze({ ink: "0.09 0.16 0.14", muted: "0.36 0.44 0.41", accent: "0.08 0.36 0.30" });

export class PdfDocument {
  constructor({ heading, logo = null, pageWidth = 612, pageHeight = 792, margin = 48 }) {
    Object.assign(this, { heading, logo, pageWidth, pageHeight, margin });
    this.pages = [];
    this.page = null;
    this.y = 0;
    this.newPage();
  }

  newPage() {
    this.page = { commands: [
      "0.06 0.16 0.13 rg 48 712 516 32 re f",
      "1 1 1 rg BT /F2 14 Tf 96 724 Td (GIS MAP ONLINE) Tj ET",
      `0.08 0.37 0.30 rg BT /F2 11 Tf 48 682 Td (${pdfSafeText(this.heading)}) Tj ET`,
    ], images: [] };
    if (this.logo) {
      this.page.images.push({ name: "ImLogo", asset: this.logo });
      this.page.commands.push("q 24 0 0 24 60 716 cm /ImLogo Do Q");
    }
    this.pages.push(this.page);
    this.y = 660;
  }

  gap(points) {
    this.y -= points;
  }

  addLines(text, { size = 10, leading = 15, color = PDF_COLORS.ink, bold = false, maxChars = 91 } = {}) {
    wrap(text, maxChars).forEach((line) => {
      if (this.y < this.margin + leading) this.newPage();
      this.page.commands.push(`${color} rg BT /F${bold ? 2 : 1} ${size} Tf ${this.margin} ${this.y} Td (${pdfSafeText(line)}) Tj ET`);
      this.y -= leading;
    });
  }

  heading2(text) {
    this.addLines(text, { size: 13, leading: 18, color: PDF_COLORS.accent, bold: true });
  }

  /** Places an image at full text width (or narrower to respect maxHeight), starting a page if it does not fit. */
  addImage(asset, { maxHeight = 360, gapAfter = 18 } = {}) {
    if (!asset?.bytes?.length) return;
    const maxWidth = this.pageWidth - (this.margin * 2);
    const ratio = asset.height / asset.width;
    const imageHeight = Math.min(maxHeight, maxWidth * ratio);
    const imageWidth = imageHeight / ratio;
    if (this.y - imageHeight < this.margin) this.newPage();
    const name = `Im${this.pages.length}x${this.page.images.length}`;
    this.page.images.push({ name, asset });
    this.page.commands.push(`q ${imageWidth.toFixed(2)} 0 0 ${imageHeight.toFixed(2)} ${this.margin} ${(this.y - imageHeight).toFixed(2)} cm /${name} Do Q`);
    this.y -= imageHeight + gapAfter;
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
      setObject(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${this.pageWidth} ${this.pageHeight}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >>${xObjects ? ` /XObject << ${xObjects} >>` : ""} >> /Contents ${contentId} 0 R >>`);
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
