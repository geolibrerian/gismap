import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Fieldwork's left workspace rail launches and reflects Cinematic Mode", async () => {
  const workspace = await readFile(new URL("../js/fieldwork-workspace.js", import.meta.url), "utf8");
  assert.match(workspace, /\['cinematic','Cinematic mode'\]/);
  assert.match(workspace, /id === 'cinematic'[\s\S]*?action\('mode-cinematic'\)/);
  assert.match(workspace, /app\.dataset\.presentation === 'cinematic' \? 'cinematic'/);
  assert.match(workspace, /cinematic: '<path/);
});
