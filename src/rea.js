// Bridge to upstream REA (https://github.com/morluto/rea, MIT, npm: rea-agents).
// We consume REA as a black-box CLI with --json and never fork it, so REA upgrades
// only affect this adapter. Pin the version: REA 6.2 changed every MCP result shape.
import { execFile } from 'node:child_process';

export const REA_PACKAGE = process.env.CXA_REA_PACKAGE ?? 'rea-agents@6';

function defaultRunner(args) {
  return new Promise((resolve, reject) => {
    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    execFile(npx, ['-y', REA_PACKAGE, ...args], { maxBuffer: 64 * 1024 * 1024, timeout: 10 * 60 * 1000, shell: process.platform === 'win32' },
      (err, stdout, stderr) => err ? reject(new Error(`REA failed: ${stderr || err.message}`)) : resolve(stdout));
  });
}

const URL_RE = /https?:\/\/[\w.-]+(?::\d+)?(?:\/[\w\-./{}:%]*)?/g;
const PATH_RE = /["'`](\/(?:api|v\d+|graphql|rpc)[\w\-./{}:]*)["'`]/g;

// Pull candidate endpoints out of REA's evidence, whatever its exact result shape.
export function extractEndpoints(text) {
  const urls = new Set(), paths = new Set();
  for (const m of text.matchAll(URL_RE)) urls.add(m[0]);
  for (const m of text.matchAll(PATH_RE)) paths.add(m[1]);
  return { urls: [...urls].slice(0, 200), paths: [...paths].slice(0, 200) };
}

export async function reaAnalyzeApp(appPath, { runner = defaultRunner } = {}) {
  const raw = await runner(['analyze-javascript-application', appPath, '--json']);
  let report; try { report = JSON.parse(raw); } catch { report = null; }
  return {
    source: `REA ${REA_PACKAGE}`,
    candidateEndpoints: extractEndpoints(raw),
    report: report ?? raw.slice(0, 20000),
    next: 'Use the app while recording a HAR, then call cxa_generate_from_har to turn confirmed endpoints into tools.',
  };
}