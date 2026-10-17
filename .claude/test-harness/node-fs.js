// Like Node: text with an encoding, otherwise a Buffer (the page's Buffer shim).
export const readFile = async (url, options) => {
  const response = await fetch(url, { cache: "no-store" });
  const encoding = typeof options === "string" ? options : options?.encoding;
  return encoding ? response.text() : globalThis.Buffer.from(await response.arrayBuffer());
};
export default { readFile };
