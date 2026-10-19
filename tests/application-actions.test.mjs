import test from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry } from '../js/application-registry.js';
import { createActionsApi } from '../js/application-actions.js';
import { LAYER_TOOL_DEFINITIONS } from '../js/layer-tools.js';
import { AUTHORING_TOOL_DEFINITIONS } from '../js/agent-authoring-tools.js';

function fixture() {
  const tools = new ToolRegistry(); let calls = 0;
  for (const definition of [...LAYER_TOOL_DEFINITIONS, ...AUTHORING_TOOL_DEFINITIONS]) tools.register({ ...definition, execute: () => ++calls });
  tools.register({ id: 'legacy', displayName: 'Legacy', execute: () => ++calls });
  const api = createActionsApi({ runtime: { tools, runTool: (id, input) => tools.execute(id, input) }, state: { snapshot: () => ({ revision: 3 }) } });
  return { api, calls: () => calls };
}
test('actions discover actual registered tools without exposing executable functions', () => {
  const { api } = fixture();
  assert.equal(api.list().length, LAYER_TOOL_DEFINITIONS.length + AUTHORING_TOOL_DEFINITIONS.length + 1);
  assert.equal(api.describe('legacy').validatedExecution, false);
  assert.equal(api.describe('unknown'), null);
  assert.doesNotThrow(() => JSON.stringify(api.list()));
});
test('validate before execution, enforce revision, and preserve the registry', async () => {
  const f = fixture();
  for (const request of [
    { id: 'layer.add', input: { url: 'https://example.test/data', opacity: 2 } },
    { id: 'layer.list', input: { secret: true } },
    { id: 'source.inspect', input: { url: ' ' } },
    { id: 'layer.list', expectedRevision: 2 },
    { id: 'legacy' },
    { id: 'missing' },
  ]) await assert.rejects(f.api.execute(request), (error) => Boolean(error.code));
  assert.equal(f.calls(), 0);
  assert.equal(await f.api.execute({ id: 'layer.list', expectedRevision: 3 }), 1);
  assert.equal(await f.api.execute({ id: 'layer.add', input: { url: 'https://example.test/data', opacity: 0.5 } }), 2);
});
test('unsupported schema assertions fail closed', async () => {
  const tools = new ToolRegistry(); let called = false;
  tools.register({ id: 'custom', inputSchema: { type: 'object', allOf: [] }, execute: () => { called = true; } });
  const api = createActionsApi({ runtime: { tools, runTool: (...args) => tools.execute(...args) }, state: { snapshot: () => ({ revision: 0 }) } });
  await assert.rejects(api.execute({ id: 'custom' }), { code: 'UNSUPPORTED_SCHEMA' });
  assert.equal(called, false);
});
