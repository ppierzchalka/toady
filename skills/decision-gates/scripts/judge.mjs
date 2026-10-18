#!/usr/bin/env node
/**
 * Advisory Jev System One evaluation. No chat models, no silent provider
 * fallback, no global opt-in. Node 22+; no additional dependencies.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROVIDERS = Object.freeze({
  zen: { endpoint: 'https://opencode.ai/zen/v1/systemone', model: 'jev-1.13', keyEnv: 'OPENCODE_API_KEY' },
  typesafe: { endpoint: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest', keyEnv: 'TYPESAFE_API_KEY' },
  openrouter: { endpoint: 'https://openrouter.ai/api/v1/systemone', model: 'typesafe/jev-1.13', keyEnv: 'OPENROUTER_API_KEY' },
});
const GATES = new Set(['readiness', 'plan', 'outcome']);
const CHOICES = {
  pass: 'Direct supplied evidence supports every accepted criterion and the intended outcome.',
  rework: 'A criterion or important aspect of the stated outcome is not satisfied.',
  escalate: 'A consequential contradiction or authorization decision needs human input.',
  unknown: 'Provided evidence cannot establish the outcome; do not assume it is done.',
};
const reasons = {
  pass: 'Jev classified the evidence as aligned; required checks still apply.',
  rework: 'Jev flagged an outcome or criteria mismatch for independent review.',
  escalate: 'Jev flagged a consequential conflict requiring review.',
  unknown: 'Jev could not establish alignment from the supplied evidence.',
};
const gate = process.argv[2];
const output = (status, reason, details = {}) => process.stdout.write(
  JSON.stringify({ status, reason, gate, ...details }) + '\n',
);
const validConfig = cfg => {
  if (!cfg || typeof cfg !== 'object' || cfg.version !== 2 ||
      cfg.enabled !== true || cfg.scope !== 'personal' ||
      typeof cfg.provider !== 'string' || !Object.hasOwn(PROVIDERS, cfg.provider)) return false;
  return cfg.model === PROVIDERS[cfg.provider].model;
};
function projectConfigPath() {
  const root = process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
  const id = createHash('sha256').update(realpathSync(process.cwd())).digest('hex');
  return join(root, 'toady', 'decision-gates', id + '.json');
}
async function callJev(cfg, input) {
  const provider = PROVIDERS[cfg.provider];
  const key = process.env[provider.keyEnv];
  if (!key) return null;
  const request = {
    model: cfg.model,
    state: input,
    questions: {
      verdict: {
        type: 'choice',
        instructions: 'Classify alignment ONLY from accepted criteria and supplied verifiable evidence. Do not infer missing evidence, acceptance or authorization. Select unknown when insufficient.',
        criteria: CHOICES,
      },
    },
  };
  try {
    const response = await fetch(provider.endpoint, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(12000),
      redirect: 'error',
    });
    if (!response.ok) return null;
    const raw = await response.text();
    if (raw.length > 65536) return null;
    const data = JSON.parse(raw);
    const answer = data?.answers?.verdict;
    if (answer?.type !== 'choice' || !Object.hasOwn(CHOICES, answer.choice)) return null;
    const confidence = answer.confidence;
    if (typeof confidence !== 'number' || confidence < 0 || confidence > 1) return null;
    return { status: confidence < 0.6 ? 'unknown' : answer.choice, confidence };
  } catch { return null; }
}
async function main() {
  if (process.env.TOADY_JEV_DISABLE === '1') return output('skipped', 'Disabled by environment');
  // Probe supplied explicit provider configuration, not the project. Only run
  // it from installer after the user has opted in as a personal project.
  if (gate === '--probe') {
    let cfg;
    try { cfg = JSON.parse(readFileSync(0, 'utf8')); }
    catch { return output('unavailable', 'Invalid probe input'); }
    if (!validConfig(cfg)) return output('unavailable', 'Invalid provider configuration');
    const response = await callJev(cfg, {
      goal: 'Classify this harmless capability check.',
      criteria: ['System One response supports choice answers'],
      evidence: ['Capability probe executed'],
      proposedDecision: 'Capability is available',
    });
    return output(response ? 'ready' : 'unavailable',
      response ? 'Provider returned a valid System One choice' : 'Provider unavailable');
  }
  if (!GATES.has(gate)) return output('skipped', 'Unsupported gate');
  let cfg;
  try {
    const path = projectConfigPath();
    if (!existsSync(path)) return output('skipped', 'No consent for this project');
    cfg = JSON.parse(readFileSync(path, 'utf8'));
  } catch { return output('skipped', 'No readable project consent'); }
  if (!validConfig(cfg)) return output('skipped', 'Jev is disabled for this project');
  let raw;
  try { raw = readFileSync(0, 'utf8'); }
  catch { return output('unknown', 'Cannot read evidence'); }
  if (Buffer.byteLength(raw) > 12288) return output('unknown', 'Evidence exceeds 12 KiB');
  let input;
  try { input = JSON.parse(raw); }
  catch { return output('unknown', 'Invalid JSON evidence'); }
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      typeof input.goal !== 'string' || !input.goal.trim() ||
      typeof input.proposedDecision !== 'string' || !input.proposedDecision.trim() ||
      !Array.isArray(input.criteria) || input.criteria.length === 0 ||
      !Array.isArray(input.evidence) || input.evidence.length === 0 ||
      !input.criteria.every(x => typeof x === 'string') ||
      !input.evidence.every(x => typeof x === 'string')) {
    return output('unknown', 'Incomplete evaluation contract');
  }
  const decision = await callJev(cfg, { gate, ...input });
  if (!decision) return output('skipped', 'Provider unavailable or invalid System One response');
  output(decision.status, reasons[decision.status], { provider: cfg.provider, confidence: decision.confidence });
}
await main().catch(() => output('skipped', 'Evaluation unavailable'));
