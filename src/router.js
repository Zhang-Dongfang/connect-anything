// Layered routing: prefer the most reliable integration that exists for an app,
// fall back to computer use only when nothing better is available.
export const LAYERS = [
  { id: 'official-api', rank: 1, note: 'Official API / CLI / existing MCP server' },
  { id: 'scripting', rank: 2, note: 'OS scripting: COM, AppleScript, D-Bus, URL schemes' },
  { id: 'private-api', rank: 3, note: 'Reverse-engineered private HTTP/WebSocket API (generated from traffic)' },
  { id: 'accessibility', rank: 4, note: 'Accessibility tree: Windows UIA, macOS AX, AT-SPI' },
  { id: 'computer-use', rank: 5, note: 'Screenshot + mouse/keyboard (fallback)' },
];

export function route(app, connectors, health = {}) {
  const key = String(app).toLowerCase();
  const candidates = connectors
    .filter(c => c.name.toLowerCase() === key)
    .map(c => ({ connector: c.name, layer: c.layer ?? 'private-api', healthy: health[c.name] !== false }))
    .filter(c => c.healthy)
    .sort((a, b) => rank(a.layer) - rank(b.layer));
  if (candidates.length) return { app, use: candidates[0], fallbacks: [...candidates.slice(1), { layer: 'computer-use' }] };
  return {
    app,
    use: { layer: 'computer-use' },
    fallbacks: [],
    hint: 'No connector yet. Capture traffic (HAR) while using the app, then run: cxa har <file> --name ' + key,
  };
}

function rank(layer) { return LAYERS.find(l => l.id === layer)?.rank ?? 99; }