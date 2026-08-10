#!/usr/bin/env node
// Optional lab Lighthouse harness. Requires preview on :4173 and lighthouse installed.
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'

const url = process.env.PERF_URL || 'http://127.0.0.1:4173/'
mkdirSync('dist/lighthouse', { recursive: true })
let failed = 0
for (let i = 1; i <= 5; i++) {
  const out = `dist/lighthouse/run-${i}.json`
  const r = spawnSync(
    'npx',
    ['--yes', 'lighthouse', url, '--output=json', `--output-path=${out}`,
      '--only-categories=performance', '--chrome-flags=--headless --no-sandbox'],
    { stdio: 'inherit', shell: true },
  )
  if (r.status !== 0) failed++
}
if (failed) {
  console.error(`${failed}/5 Lighthouse runs failed (is preview up? install may be blocked)`)
  process.exit(failed === 5 ? 1 : 0)
}
console.log('Wrote dist/lighthouse/run-1..5.json')
