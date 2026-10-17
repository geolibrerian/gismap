const queue = [];
globalThis.__testResults = [];
let scheduled = false;
export default function test(name, fn) {
  queue.push({ name, fn });
  if (!scheduled) { scheduled = true; setTimeout(run, 0); }
}
async function run() {
  while (queue.length) {
    const { name, fn } = queue.shift();
    try { await fn(); globalThis.__testResults.push({ name, ok: true }); }
    catch (error) { globalThis.__testResults.push({ name, ok: false, error: String(error?.message || error) }); }
  }
  scheduled = false;
}
export { test };
