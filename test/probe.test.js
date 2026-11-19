import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classify, hasRealControls, STATUS } from '../src/probe.js';
import { route, rankOf } from '../src/router.js';

// Captured from a real machine. weixin = Qt self-drawn UI; regedit = classic Win32 via MSAA.
const weixin = JSON.parse(fs.readFileSync(new URL('./fixtures/weixin-probe.json', import.meta.url), 'utf8'));
const regedit = JSON.parse(fs.readFileSync(new URL('./fixtures/regedit-probe.json', import.meta.url), 'utf8'));
const pick = (v, id) => v.layers.find(l => l.id === id);

test('Weixin: accessibility is blocked (self-drawn Qt UI exposes no operable controls)', () => {
  const v = classify(weixin);
  const a = pick(v, 'accessibility');
  assert.equal(a.status, STATUS.BLOCKED);
  assert.ok(a.evidence.includes('namedControls=4'), a.evidence.join('|'));
  assert.ok(a.evidence.includes('childClasses=Qt51514QWindowIcon,MMUIRenderSubWindowHW'), a.evidence.join('|'));
  assert.match(a.note, /Computer Use \(pixels\) is the only remaining layer/);
});

test('Weixin: private API blocked by policy with loopback evidence', () => {
  const v = classify(weixin);
  assert.equal(pick(v, 'private-api').status, STATUS.BLOCKED);
  assert.equal(pick(v, 'private-api').evidence.length, 5);
  assert.deepEqual(v.blocked, ['private-api', 'accessibility']);
});

test('Weixin: Chromium mini-program runtime detected, DevTools still closed', () => {
  const v = classify(weixin);
  assert.equal(pick(v, 'devTools').status, STATUS.UNAVAILABLE);
  assert.match(pick(v, 'devTools').note, /--remote-debugging-port/);
});

test('Weixin: only weixin:// is available, so scripting is the recommendation', () => {
  const v = classify(weixin);
  assert.equal(pick(v, 'scripting').status, STATUS.AVAILABLE);
  assert.deepEqual(pick(v, 'scripting').evidence, ['weixin:// (HKCU)']);
  assert.equal(v.recommended, 'scripting');
});

test('regedit: classic Win32 controls are detected through MSAA', () => {
  const v = classify(regedit);
  const a = pick(v, 'accessibility');
  assert.equal(a.status, STATUS.AVAILABLE);
  assert.match(a.note, /MSAA controls/);
  assert.ok(a.evidence.some(e => e.startsWith('childClasses=') && e.includes('SysTreeView32')), a.evidence.join('|'));
  assert.equal(v.recommended, 'accessibility');
});

test('hasRealControls ignores self-drawn toolkit window classes', () => {
  assert.equal(hasRealControls(['Qt51514QWindowIcon', 'MMUIRenderSubWindowHW']), false);
  assert.equal(hasRealControls(['Electron', 'Chrome_WidgetWin_1']), true);
  assert.equal(hasRealControls(['SysTreeView32']), true);
  assert.equal(hasRealControls([]), false);
});

test('a modern Win32 app with many named UIA controls is drivable without MSAA', () => {
  const v = classify({ processName: 'x', running: true, windows: [{ uiaDescendants: 900, uiaNamedControl: 120, uiaSamples: ['Save'], childClasses: [], msaaChildren: -1 }], schemes: [], listeners: [], cdpPorts: [], cdpProbe: [], instances: [] });
  assert.equal(v.recommended, 'accessibility');
});

test('route() consumes a verdict and explains blocked layers', () => {
  const v = classify(weixin);
  const r = route('weixin', [], {}, v);
  assert.equal(r.use.layer, 'scripting');
  assert.equal(r.use.source, 'probe');
  assert.equal(r.blockedReasons.length, 2);
  assert.match(r.blockedReasons[1], /^accessibility: Self-drawn UI/);
});

test('a reversed connector outranks every probed layer', () => {
  const v = classify(weixin);
  const r = route('weixin', [{ name: 'weixin', layer: 'private-api', tools: [] }], {}, v);
  assert.equal(r.use.layer, 'private-api');
  assert.equal(r.use.source, 'connector');
});

test('an app that is not running falls back to computer use with a hint', () => {
  const v = classify({ processName: 'x', running: false, windows: [], schemes: [], listeners: [], instances: [] });
  const r = route('x', [], {}, v);
  assert.equal(r.use.layer, 'computer-use');
  assert.match(r.hint, /App is not running/);
});

test('layer ranks keep the documented order', () => {
  const order = ['official-api', 'private-api', 'devTools', 'accessibility', 'scripting', 'computer-use'];
  const ranks = order.map(rankOf);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
});