import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runAct, actArgs, pickTarget, patternFor, describeTarget, rejectPixelArgs, normalizeName } from '../src/act.js';

const elements = [
  { controlType: 'Button', name: '关闭标签页', autoId: 'CloseButton', actions: ['invoke'], offscreen: false },
  { controlType: 'Button', name: '新建标签页', autoId: 'NewTabButton', actions: ['invoke', 'expand'], offscreen: false },
  { controlType: 'Text', name: '显示为 0', autoId: 'CalculatorResults', actions: [], offscreen: false },
  { controlType: 'Button', name: '关闭标签页', autoId: 'CloseButton2', actions: ['invoke'], offscreen: true },
  { controlType: 'Document', name: '', autoId: 'Editor', actions: ['set'], offscreen: false },
];

test('coordinate and raw-input flags are refused, semantic ones are not', () => {
  for (const bad of ['--x', '--y', '--click', '--mouse', '--screenshot', '--key', '--type', '--coord']) {
    assert.equal(rejectPixelArgs(['--name', 'ok', bad]), bad);
  }
  assert.equal(rejectPixelArgs(['--name', '关闭', '--autoId', 'CloseButton', '--invoke', '--confirm']), null);
  assert.equal(rejectPixelArgs([]), null);
});

test('pickTarget resolves by AutomationId first, then exact name, then substring', () => {
  assert.equal(pickTarget(elements, { autoId: 'NewTabButton' }).target.name, '新建标签页');
  assert.equal(pickTarget(elements, { name: '显示为' }).target.autoId, 'CalculatorResults');
  assert.equal(pickTarget(elements, { name: '标签页' }).candidates.length, 2);
  assert.equal(pickTarget(elements, { name: '关闭' }).target.autoId, 'CloseButton');
});

test('pickTarget normalises whitespace so a hand-typed name still matches', () => {
  const spacey = [{ controlType: 'Button', name: ' 关闭  标签页 ', autoId: '', actions: ['invoke'], offscreen: false }];
  assert.equal(normalizeName('  关闭  标签页 '), '关闭 标签页');
  assert.equal(pickTarget(spacey, { name: '关闭 标签页' }).target.name, ' 关闭  标签页 ');
});

test('pickTarget skips offscreen duplicates and reports a clear reason when nothing matches', () => {
  const hit = pickTarget(elements, { autoId: 'CloseButton' });
  assert.equal(hit.target.autoId, 'CloseButton');
  assert.equal(hit.candidates.length, 1);
  const miss = pickTarget(elements, { name: '不存在的按钮' });
  assert.equal(miss.target, null);
  assert.match(miss.reason, /no element matched name/);
  assert.match(pickTarget(elements, {}).reason, /no selector given/);
});

test('pickTarget honours the index and refuses one that is out of range', () => {
  const dup = [...elements, { controlType: 'Button', name: '关闭标签页', autoId: 'Other', actions: ['invoke'], offscreen: false }];
  assert.equal(pickTarget(dup, { name: '关闭标签页', index: 1 }).target.autoId, 'Other');
  const bad = pickTarget(dup, { name: '关闭标签页', index: 5 });
  assert.equal(bad.target, null);
  assert.match(bad.reason, /out of range/);
});
test('patternFor says which pattern will be used, and stays null on a self-drawn surface', () => {
  assert.equal(patternFor({ actions: ['invoke'] }, 'invoke'), 'Invoke');
  assert.equal(patternFor({ actions: ['toggle'] }, 'invoke'), 'Toggle');
  assert.equal(patternFor({ actions: ['select'] }, 'invoke'), 'SelectionItem');
  assert.equal(patternFor({ actions: [] }, 'invoke'), null);
  assert.equal(patternFor({ actions: ['set'] }, 'set'), 'Value');
  assert.equal(patternFor({ actions: ['invoke'] }, 'set'), null);
});

test('describeTarget prints type, name and AutomationId for an auditable plan', () => {
  assert.equal(describeTarget(elements[0]), 'Button "关闭标签页" autoId=CloseButton');
  assert.equal(describeTarget({ controlType: 'Text', name: '显示为 0' }), 'Text "显示为 0"');
  assert.equal(describeTarget(null), '(none)');
});

test('actArgs maps options to the probe script flags', () => {
  const args = actArgs({ processName: 'notepad', mode: 'set', name: '文本编辑器', value: 'hi', window: 'Notepad', limit: 50 });
  assert.deepEqual(args, ['-ProcessName', 'notepad', '-Mode', 'set', '-Name', '文本编辑器', '-Value', 'hi', '-Window', 'Notepad', '-Limit', '50']);
  assert.deepEqual(actArgs({ processName: 'calc' }), ['-ProcessName', 'calc', '-Mode', 'list', '-Limit', '300']);
});

test('runAct refuses unknown modes and a missing process, and passes through otherwise', async () => {
  await assert.rejects(() => runAct({ processName: 'x', mode: 'click' }), /unknown action/);
  await assert.rejects(() => runAct({ mode: 'list' }), /process name is required/);
  let seen = null;
  const out = await runAct({ processName: 'notepad', mode: 'list', runner: async (args) => { seen = args; return { ok: true, mode: 'list', elements: [] }; } });
  assert.equal(out.ok, true);
  assert.ok(seen.includes('-ProcessName'));
});

test('the driver script contains no coordinate or synthetic-input API', () => {
  const src = fs.readFileSync(new URL('../scripts/uia-act.ps1', import.meta.url), 'utf8');
  for (const forbidden of ['SendInput', 'SetCursorPos', 'mouse_event', 'keybd_event', 'CopyFromScreen', 'SendKeys']) {
    assert.equal(src.includes(forbidden), false, forbidden + ' must not appear in the semantic driver');
  }
  for (const required of ['InvokePattern', 'TogglePattern', 'ValuePattern']) {
    assert.ok(src.includes(required), required + ' should be the only way this driver acts');
  }
});