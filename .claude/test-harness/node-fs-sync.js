const toUrl = (path) => (path instanceof URL ? path.href : String(path));
export function readFileSync(path) {
  const request = new XMLHttpRequest();
  request.open("GET", toUrl(path), false);
  request.setRequestHeader("Cache-Control", "no-cache");
  request.send();
  if (request.status >= 400) throw new Error(`ENOENT: ${toUrl(path)}`);
  return request.responseText;
}
export function existsSync(path) {
  const request = new XMLHttpRequest();
  request.open("HEAD", toUrl(path), false);
  request.send();
  return request.status < 400;
}
export default { readFileSync, existsSync };
