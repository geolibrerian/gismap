// Packs JSON into a URL-safe string for links and QR codes. New links are
// deflate-compressed ("z" prefix) when the browser can; "j" marks plain JSON.
// Links made before compression (bare base64 JSON) still decode.

function toBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value) {
  const normalized = String(value || "").replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function pipe(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export const canCompress = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

export async function encodePayload(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (canCompress()) return `z${toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw")))}`;
  return `j${toBase64Url(bytes)}`;
}

export async function decodePayload(text) {
  const value = String(text || "").trim();
  if (!value) throw new Error("This link has no content.");
  try {
    if (value[0] === "z") {
      if (!canCompress()) throw new Error("This browser cannot open compressed links. Try a current version of Chrome, Edge, Firefox or Safari.");
      return JSON.parse(new TextDecoder().decode(await pipe(fromBase64Url(value.slice(1)), new DecompressionStream("deflate-raw"))));
    }
    const body = value[0] === "j" ? value.slice(1) : value;
    return JSON.parse(new TextDecoder().decode(fromBase64Url(body)));
  } catch (error) {
    if (/browser cannot/.test(error.message)) throw error;
    throw new Error("This link is damaged or incomplete.");
  }
}
