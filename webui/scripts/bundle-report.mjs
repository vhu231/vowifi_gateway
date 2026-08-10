#!/usr/bin/env node
import { readdir, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const assetsDir = join(process.cwd(), 'dist', 'assets')
let files
try {
  files = await readdir(assetsDir)
} catch {
  console.error('dist/assets missing — run npm run build first')
  process.exit(1)
}

const rows = []
for (const name of files) {
  const buf = await import('node:fs').then((fs) => fs.promises.readFile(join(assetsDir, name)))
  const gz = gzipSync(buf).length
  rows.push({ name, raw: buf.length, gzip: gz })
}
rows.sort((a, b) => b.raw - a.raw)
const totalRaw = rows.reduce((s, r) => s + r.raw, 0)
const totalGz = rows.reduce((s, r) => s + r.gzip, 0)
const report = {
  generatedAt: new Date().toISOString(),
  totalRaw,
  totalGzip: totalGz,
  files: rows,
}
const out = join(process.cwd(), 'dist', 'bundle-report.json')
await writeFile(out, JSON.stringify(report, null, 2))
console.log('Bundle report →', out)
for (const r of rows) {
  console.log(`${(r.raw / 1024).toFixed(1)} kB raw / ${(r.gzip / 1024).toFixed(1)} kB gz  ${r.name}`)
}
console.log(`TOTAL ${(totalRaw / 1024).toFixed(1)} kB raw / ${(totalGz / 1024).toFixed(1)} kB gz`)
