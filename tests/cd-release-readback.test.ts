import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const workflow = readFileSync(".github/workflows/cd.yml", "utf8");
const sha = "0123456789abcdef0123456789abcdef01234567";
const deploymentId = "dpl_123";
const token = "SyntheticTokenOnly123";

// Synthetic boundary, not a live Vercel client. Verified against npm vercel@59.19.0
// (tarball SHA-1 f67e7c25fc14a072cf90e89b7c2536f6f252c68f):
// dist/index.js uses VERCEL_TOKEN as explicit auth, skipWrite=true, without
// changing client.argv. dist/commands-bulk.js parseCurlLikeArgs only consumes
// --deployment/--protection-bypass, --scope/--team and boolean command flags;
// --token is forwarded. runCurl adds protection bypass and propagates curl exit.
const vercelStub = `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const tokenArg = args.find(arg => arg.startsWith('--token='));
const auth = tokenArg ? tokenArg.slice(8) : process.env.VERCEL_TOKEN;
if (!auth || process.env.SCENARIO === 'cli-failure') {
  console.error('synthetic CLI authentication failure'); process.exit(1);
}
let target, deployment;
const flags = [];
const input = args[0] === 'curl' ? args.slice(1) : args;
for (let i = 0; i < input.length; i++) {
  const arg = input[i];
  if (arg === '--') { flags.push(...input.slice(i + 1)); break; }
  if (arg === '--deployment') { deployment = input[++i]; continue; }
  if (!target && !arg.startsWith('-')) target = arg;
  else flags.push(arg);
}
if (target !== '/api/release' || deployment !== process.env.DEPLOYMENT_URL) {
  console.error('synthetic CLI target mismatch'); process.exit(1);
}
writeFileSync(process.env.RUNNER_TEMP + '/cli-proof.json', JSON.stringify({
  envAuth: auth === process.env.VERCEL_TOKEN,
  tokenInArgv: args.some(arg => arg.includes(auth)), target, deployment
}));
const result = spawnSync('curl', ['--url', deployment + target,
  '--header', 'x-vercel-protection-bypass: SyntheticBypassOnly', ...flags], { stdio: 'inherit' });
process.exit(result.status ?? 1);
`;

const curlStub = `#!/usr/bin/env node
const { writeFileSync } = require('node:fs');
const args = process.argv.slice(2);
const api = args.some(arg => arg.startsWith('https://api.vercel.com/'));
if (api) {
  if (process.env.SCENARIO === 'api-failure') { console.error('synthetic API failure'); process.exit(22); }
  const deployment = { id: 'dpl_123', url: 'synthetic-candidate.vercel.app',
    readyState: 'READY', target: 'production', projectId: 'prj_synthetic',
    meta: { githubCommitSha: process.env.RELEASE_SHA, githubDeployment: '1' } };
  writeFileSync(args[args.indexOf('-o') + 1], JSON.stringify(deployment));
  process.exit(0);
}
if (args.some(arg => arg.startsWith('--token'))) {
  console.error("curl: option --token: is unknown"); process.exit(2);
}
if (!args.includes('--header') || !args.includes('x-vercel-protection-bypass: SyntheticBypassOnly')) {
  console.error('synthetic protection missing'); process.exit(1);
}
writeFileSync(process.env.RUNNER_TEMP + '/curl-proof.json', JSON.stringify(args));
if (process.env.SCENARIO === 'http-failure') {
  if (args.includes('--fail')) { console.error('synthetic HTTP 503'); process.exit(22); }
  // A 503 can have a valid-looking body: HTTP status must still fail closed.
}
console.log(JSON.stringify({
  sha: process.env.SCENARIO === 'wrong-sha' ? 'f'.repeat(40) : process.env.RELEASE_SHA,
  deployment_id: process.env.SCENARIO === 'wrong-id' ? 'dpl_other' : 'dpl_123'
}));
`;

function stepScript(name: string) {
  const step = workflow.split(`name: ${name}\n`)[1]?.split(/\n      - /)[0];
  assert.ok(step, `workflow step ${name} exists`);
  const script = step.split("        run: |\n")[1];
  assert.ok(script, `workflow step ${name} has a bash script`);
  return script.replace(/^          /gm, "");
}

for (const [name, readback] of [
  ["Read staged deployment proof", "readback.json"],
  ["Verify exact staged deployment", "readback-before.json"],
]) {
  for (const scenario of [
    "success",
    "http-failure",
    "cli-failure",
    "api-failure",
    "wrong-sha",
    "wrong-id",
    "missing-token",
  ]) {
    test(`CD ${name}: ${scenario} (offline workflow bash)`, () => {
      const dir = mkdtempSync(join(tmpdir(), "cd-readback-"));
      try {
        writeFileSync(join(dir, "vercel"), vercelStub, { mode: 0o755 });
        writeFileSync(join(dir, "curl"), curlStub, { mode: 0o755 });
        const result = spawnSync(
          "bash",
          ["--noprofile", "--norc", "-euo", "pipefail", "-c", stepScript(name)],
          {
            encoding: "utf8",
            env: {
              NODE_ENV: "test",
              PATH: `${dir}:${process.env.PATH}`,
              HOME: dir,
              RUNNER_TEMP: dir,
              GITHUB_OUTPUT: join(dir, "github-output"),
              DEPLOYMENT_URL: "https://synthetic-candidate.vercel.app",
              VERCEL_ORG_ID: "team_synthetic",
              VERCEL_PROJECT_ID: "prj_synthetic",
              VERCEL_TOKEN: scenario === "missing-token" ? "" : token,
              RELEASE_SHA: sha,
              SCENARIO: scenario,
            },
            cwd: resolve("."),
          },
        );
        assert.equal(result.error, undefined);
        assert.equal(result.stdout.includes(token), false);
        assert.equal(result.stderr.includes(token), false);
        if (scenario === "success") {
          assert.equal(result.status, 0, result.stderr);
          assert.deepEqual(
            JSON.parse(readFileSync(join(dir, readback), "utf8")),
            {
              sha,
              deployment_id: deploymentId,
            },
          );
          assert.deepEqual(JSON.parse(result.stdout), {
            deploymentId,
            verified: true,
          });
          const cli = JSON.parse(
            readFileSync(join(dir, "cli-proof.json"), "utf8"),
          );
          assert.equal(cli.envAuth, true);
          assert.equal(cli.tokenInArgv, false);
          const curlArgs = JSON.parse(
            readFileSync(join(dir, "curl-proof.json"), "utf8"),
          ) as string[];
          assert.equal(
            curlArgs.some((arg) => arg.includes(token)),
            false,
          );
          for (const flag of ["--fail", "--silent", "--show-error"])
            assert.ok(curlArgs.includes(flag), `${flag} reaches curl`);
          if (readback === "readback-before.json")
            assert.equal(
              readFileSync(join(dir, "github-output"), "utf8"),
              `deployment_id=${deploymentId}\n`,
            );
        } else {
          assert.notEqual(result.status, 0, `${scenario} must stop the step`);
          assert.equal(
            result.stdout,
            "",
            "no verification proof after failure",
          );
          if (["http-failure", "api-failure"].includes(scenario))
            assert.equal(result.status, 22, result.stderr);
          if (["wrong-sha", "wrong-id"].includes(scenario))
            assert.match(result.stderr, /release_readback_mismatch/);
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}
