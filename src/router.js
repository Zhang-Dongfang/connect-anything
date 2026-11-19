// Layered routing: prefer the most reliable integration that exists for an app,
// fall back to computer use only when nothing better is available.
// Rank = automation strength, not detection order.
export const LAYERS = [
  { id: 'official-api', rank: 1, note: 'Official API / CLI / existing MCP server' },
  { id: 'private-api', rank: 3, note: 'Reversed private HTTP/WebSocket API (generated from traffic)' },
  { id: 'devTools', rank: 3.5, note: 'Chrome DevTools Protocol (browser or Electron/Chromium app)' },
  { id: 'accessibility', rank: 4, note: 'Accessibility tree: Windows UIA/MSAA, macOS AX, AT-SPI' },
  { id: 'scripting', rank: 6, note: 'OS entry points: COM, AppleScript, D-Bus, URL schemes (coarse)' },
  { id: 'computer-use', rank: 9, note: 'Screenshot + mouse/keyboard (fallback)' },
];

export function rankOf(layer) { return LAYERS.find(l => l.id === layer)?.rank ?? 99; }

// `verdict` is an optional probe result (src/probe.js) describing which layers the
// app actually supports, so the agent does not fall back to pixels unnecessarily.
export function route(app, connectors, health = {}, verdict = null) {
  const key = String(app).toLowerCase();
  const installed = connectors
    .filter(c => c.name.toLowerCase() === key)
    .filter(c => health[c.name] !== false)
    .map(c => ({ connector: c.name, layer: c.layer ?? 'private-api', source: 'connector' }))
    .sort((a, b) => rankOf(a.layer) - rankOf(b.layer));

  const probed = (verdict?.layers ?? [])
    .filter(l => l.status === 'available' && l.id !== 'computer-use')
    .map(l => ({ layer: l.id, source: 'probe', evidence: l.evidence }))
    .sort((a, b) => rankOf(a.layer) - rankOf(b.layer));

  const candidates = [...installed, ...probed];
  const out = {
    app,
    running: verdict?.running,
    blocked: verdict?.blocked ?? [],
    use: candidates[0] ?? { layer: 'computer-use', source: 'fallback' },
    fallbacks: candidates.slice(1),
    layers: verdict?.layers,
  };
  out.blockedReasons = (verdict?.layers ?? []).filter(l => l.status === 'blocked').map(l => l.id + ': ' + l.note);
  if (!candidates.length) {
    out.hint = verdict?.running
      ? 'No automatable layer found. Use Computer Use, which needs explicit takeover approval before any input.'
      : 'App is not running. Start it, then probe again. To build a better layer: capture a HAR while using the app, then run: cxa har <file> --name ' + key;
  } else if (out.use.layer === 'computer-use') {
    out.note = 'Only Computer Use is available; it needs explicit takeover approval.';
  }
  return out;
}