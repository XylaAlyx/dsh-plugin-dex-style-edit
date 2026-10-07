/**
 * Fill the repository URL in after the GitHub repository exists.
 *
 * `npm publish` wants a real `repository.url`, and the marketplace preflight
 * warns until the placeholder is gone. The owner is the one thing this package
 * cannot infer, so it is a parameter rather than something to hand-edit.
 *
 * Run: node scripts/init-repo.mjs <github-owner>
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const manifestPath = path.join(ROOT, 'package.json')

const owner = process.argv[2]?.trim()
if (owner === undefined || owner === '') {
  console.error('usage: node scripts/init-repo.mjs <github-owner>')
  console.error('  e.g. node scripts/init-repo.mjs xyla')
  process.exit(1)
}
if (!/^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9]))*$/.test(owner)) {
  console.error(`"${owner}" is not a valid GitHub account name`)
  process.exit(1)
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
const repo = manifest.name
const base = `https://github.com/${owner}/${repo}`

manifest.repository = { type: 'git', url: `git+${base}.git` }
manifest.homepage = `${base}#readme`
manifest.bugs = { url: `${base}/issues` }

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
console.log(`repository -> ${manifest.repository.url}`)
console.log(`homepage   -> ${manifest.homepage}`)
console.log('now commit and push, then set the dsh-plugin topic on the repository')
