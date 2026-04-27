#!/usr/bin/env node
// @ts-nocheck
// End-to-end smoke test for handler changes (a5e7105 + 409c9aa).
// Drives the MCP HTTP API directly — no MCP client needed.
//
// Prereqs:
//   1. Server running:    npm start    (or npm run dev)
//   2. Roblox Studio open with MCP plugin connected
//
// Usage: node scripts/smoke-test-handlers.mjs

const HOST = process.env.MCP_HOST || 'http://localhost:58741';
const PARENT = 'game.Workspace';
const PREFIX = 'SmokeTest_';

let pass = 0;
let fail = 0;
const failures = [];

function log(kind, msg, extra) {
  const tag = kind === 'pass' ? '\x1b[32mPASS\x1b[0m' : kind === 'fail' ? '\x1b[31mFAIL\x1b[0m' : '\x1b[36m····\x1b[0m';
  console.log(`${tag}  ${msg}`);
  if (extra !== undefined) console.log('       ' + JSON.stringify(extra));
}

async function call(tool, body) {
  const res = await fetch(`${HOST}/mcp/${tool}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${tool}: ${await res.text()}`);
  const wrapped = await res.json();
  // /mcp/<tool> returns MCP content format: {content:[{type:'text',text:JSON}]}
  if (wrapped?.content?.[0]?.text) {
    try { return JSON.parse(wrapped.content[0].text); }
    catch { return wrapped; }
  }
  return wrapped;
}

function check(name, cond, got) {
  if (cond) { pass++; log('pass', name); }
  else      { fail++; failures.push(name); log('fail', name, got); }
}

function expectNoKey(obj, key, name) {
  check(name, !(key in obj), { offendingKey: key, value: obj[key] });
}

function expectKey(obj, key, name) {
  check(name, key in obj, { missingKey: key, response: obj });
}

async function precheck() {
  const res = await fetch(`${HOST}/health`).catch(() => null);
  if (!res || !res.ok) {
    console.error(`Server not reachable at ${HOST}. Run "npm start" first.`);
    process.exit(2);
  }
  const status = await fetch(`${HOST}/status`).then(r => r.json()).catch(() => ({}));
  if (!status.pluginConnected) {
    console.error('No Studio plugin connected. Open Studio with the MCP plugin loaded.');
    process.exit(2);
  }
  log('info', `Server up at ${HOST}, plugin connected (${status.instanceCount} instance(s))`);
}

async function cleanup() {
  // Best-effort: query and delete anything matching PREFIX.
  try {
    const r = await call('search', { query: PREFIX, searchType: 'name' });
    if (r.results) {
      for (const item of r.results) {
        await call('delete_object', { instancePath: item.path }).catch(() => {});
      }
      if (r.results.length > 0) log('info', `Cleaned ${r.results.length} prior test artifacts`);
    }
  } catch (e) {
    log('info', `Cleanup search failed (non-fatal): ${e.message}`);
  }
}

async function main() {
  await precheck();
  await cleanup();

  // ─── Q12/Q13 — mass_create_objects properties (was bug, now fixed) ───
  {
    const r = await call('mass_create_objects', {
      objects: [
        {
          className: 'Part',
          parent: PARENT,
          name: PREFIX + 'WithProps_A',
          properties: { Anchored: true, Transparency: 0.5, Position: [10, 5, 3] },
        },
        {
          className: 'Part',
          parent: PARENT,
          name: PREFIX + 'WithProps_B',
          properties: { Anchored: true, Color: [1, 0, 0] },
        },
      ],
    });

    // Q17: summary has no `total`
    expectNoKey(r.summary, 'total', 'mass_create_objects: summary.total dropped');
    expectKey(r.summary, 'succeeded', 'mass_create_objects: summary.succeeded present');

    // Q16: per-entry results have no className/parent echoes
    if (r.results?.[0]) {
      expectNoKey(r.results[0], 'className', 'mass_create_objects: entry.className echo dropped');
      expectNoKey(r.results[0], 'parent', 'mass_create_objects: entry.parent echo dropped');
      expectKey(r.results[0], 'instancePath', 'mass_create_objects: entry.instancePath kept');
      expectKey(r.results[0], 'name', 'mass_create_objects: entry.name kept');
    }

    check('mass_create_objects: both entries succeeded', r.summary.succeeded === 2, r.summary);

    // Verify properties actually applied (the bug fix)
    const propsA = await call('get_instance_properties', { instancePath: r.results[0].instancePath, mode: 'full' });
    check(
      'mass_create_objects: Anchored=true applied to entry A',
      propsA.properties?.Anchored === true,
      { Anchored: propsA.properties?.Anchored },
    );
    check(
      'mass_create_objects: Position [10,5,3] applied to entry A',
      propsA.properties?.Position?._type === 'Vector3' && Math.abs((propsA.properties?.Position?.X ?? 0) - 10) < 0.001,
      { Position: propsA.properties?.Position },
    );
    check(
      'mass_create_objects: Transparency=0.5 applied',
      Math.abs((propsA.properties?.Transparency ?? 0) - 0.5) < 0.001,
      { Transparency: propsA.properties?.Transparency },
    );

    const propsB = await call('get_instance_properties', { instancePath: r.results[1].instancePath, mode: 'full' });
    check(
      'mass_create_objects: Color [1,0,0] applied to entry B',
      propsB.properties?.Color?._type === 'Color3' && Math.abs((propsB.properties?.Color?.R ?? 0) - 1) < 0.001,
      { Color: propsB.properties?.Color },
    );
  }

  // ─── Q12/Q13 — mass_set_property with Vector3 array (was bug, now fixed) ───
  {
    const created = await call('mass_create_objects', {
      objects: [
        { className: 'Part', parent: PARENT, name: PREFIX + 'MassSet_A' },
        { className: 'Part', parent: PARENT, name: PREFIX + 'MassSet_B' },
      ],
    });
    const paths = created.results.map(e => e.instancePath);

    const r = await call('mass_set_property', {
      paths,
      propertyName: 'Position',
      propertyValue: [42, 17, -3], // array form — used to fail
    });

    expectNoKey(r.summary, 'total', 'mass_set_property: summary.total dropped');
    expectKey(r.summary, 'succeeded', 'mass_set_property: summary.succeeded present');
    expectNoKey(r.results[0], 'propertyName', 'mass_set_property: entry.propertyName echo dropped');
    expectNoKey(r.results[0], 'propertyValue', 'mass_set_property: entry.propertyValue echo dropped');
    expectKey(r.results[0], 'path', 'mass_set_property: entry.path kept');

    check('mass_set_property: both entries succeeded', r.summary.succeeded === 2, r.summary);

    const verify = await call('get_instance_properties', { instancePath: paths[0], mode: 'full' });
    check(
      'mass_set_property: Vector3 array coerced to Position',
      verify.properties?.Position?._type === 'Vector3' && Math.abs((verify.properties?.Position?.X ?? 0) - 42) < 0.001,
      { Position: verify.properties?.Position },
    );
  }

  // ─── Q16 — set_property success has no echoes ───
  {
    const created = await call('create_object', {
      className: 'Part', parent: PARENT, name: PREFIX + 'SetProp',
    });
    expectNoKey(created, 'className', 'create_object: className echo dropped');
    expectNoKey(created, 'parent', 'create_object: parent echo dropped');
    expectKey(created, 'instancePath', 'create_object: instancePath kept');

    const r = await call('set_property', {
      instancePath: created.instancePath,
      propertyName: 'Anchored',
      propertyValue: true,
    });
    expectNoKey(r, 'instancePath', 'set_property: instancePath echo dropped');
    expectNoKey(r, 'propertyName', 'set_property: propertyName echo dropped');
    expectNoKey(r, 'propertyValue', 'set_property: propertyValue echo dropped');
    check('set_property: success=true', r.success === true, r);
  }

  // ─── Parent path-string resolve (set_property Parent) ───
  {
    const a = await call('create_object', { className: 'Folder', parent: PARENT, name: PREFIX + 'NewParent' });
    const b = await call('create_object', { className: 'Part',   parent: PARENT, name: PREFIX + 'Movable' });
    const r = await call('set_property', {
      instancePath: b.instancePath,
      propertyName: 'Parent',
      propertyValue: a.instancePath, // path string → resolved server-side
    });
    check('set_property: Parent path-string resolved', r.success === true, r);

    const verify = await call('get_instance_properties', { instancePath: a.instancePath + '.' + PREFIX + 'Movable', mode: 'full' });
    check('Parent reparent verified by re-read', verify.className === 'Part', { got: verify.className, error: verify.error });
  }

  // ─── Q16 — delete_object has no echo ───
  {
    const created = await call('create_object', { className: 'Part', parent: PARENT, name: PREFIX + 'ToDelete' });
    const r = await call('delete_object', { instancePath: created.instancePath });
    expectNoKey(r, 'instancePath', 'delete_object: instancePath echo dropped');
    check('delete_object: success=true', r.success === true, r);
  }

  // ─── knownHash chain (edit returns hash usable on next get) ───
  {
    const folder = await call('create_object', { className: 'Folder', parent: PARENT, name: PREFIX + 'ScriptHost' });
    const script = await call('create_object', {
      className: 'ModuleScript', parent: folder.instancePath, name: PREFIX + 'Script',
    });
    await call('set_script_source', {
      instancePath: script.instancePath,
      source: 'local M = {}\nM.foo = 1\nreturn M\n',
    });

    const edit = await call('edit_script_lines', {
      instancePath: script.instancePath,
      old_string: 'M.foo = 1',
      new_string: 'M.foo = 2',
    });
    expectKey(edit, 'knownHash', 'edit_script_lines: returns new knownHash');
    expectKey(edit, 'replacedAtLine', 'edit_script_lines: replacedAtLine present');

    const read3 = await call('get_script_source', {
      instancePath: script.instancePath,
      knownHash: edit.knownHash,
    });
    check(
      'edit_script_lines knownHash chains to get_script_source full-read',
      read3.unchanged === true,
      read3,
    );
  }

  // ─── Final cleanup ───
  await cleanup();

  console.log();
  console.log(`\x1b[1m${pass} passed, ${fail} failed\x1b[0m`);
  if (fail > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log('  - ' + f));
    process.exit(1);
  }
}

main().catch(err => {
  console.error('\x1b[31mFATAL\x1b[0m', err);
  process.exit(1);
});
