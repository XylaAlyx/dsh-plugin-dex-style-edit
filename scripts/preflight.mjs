/**
 * Preflight for the installed profile.
 *
 * Verifies the three things DSH actually reads before it can mount this plugin:
 * the package resolves from the profile directory, the profile's own manifest
 * lists it as a bundle, and the manifest's patch can reach it. Run this before
 * restarting DSH; a failure here is much cheaper than a failed boot.
 *
 * Run: node scripts/preflight.mjs [profileDir]
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
const profileDir = process.argv[2]
  ?? path.join(home, '.dsh', 'profiles', 'desktop')

const failures = []
/**
 * Record one failed expectation.
 * @param label - what was checked.
 * @param detail - why it failed.
 */
function fail(label, detail) {
  failures.push(`${label}: ${detail}`)
}

/**
 * Assert one expectation.
 * @param label - what was checked.
 * @param condition - must be truthy.
 * @param detail - failure description.
 */
function check(label, condition, detail) {
  if (!condition) fail(label, detail)
}

check('profile', fs.existsSync(profileDir), `profile directory missing: ${profileDir}`)

// 1) the package resolves from the profile, like DSH's loader resolves it
const linked = path.join(profileDir, 'node_modules', pkg.name)
check('link', fs.existsSync(linked), `${linked} does not exist`)
check('link', fs.existsSync(path.join(linked, 'lib', 'client.js')), 'client bundle not reachable through the profile')
check('link', fs.existsSync(path.join(linked, 'lib', 'index.js')), 'host entry not reachable through the profile')

const stat = fs.existsSync(linked) ? fs.lstatSync(linked) : undefined
if (stat !== undefined) {
  console.log(`link: ${stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : 'other'}`)
  if (stat.isSymbolicLink()) console.log(`  -> ${fs.readlinkSync(linked)}`)
}

// 2) the profile manifest declares the bundle, which is what makes the patch readable
const manifestPath = path.join(profileDir, 'package.json')
check('manifest', fs.existsSync(manifestPath), `profile manifest missing: ${manifestPath}`)
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  const bundles = manifest.dsh?.profile?.bundles ?? []
  check('manifest', bundles.includes(pkg.name), `dsh.profile.bundles does not list ${pkg.name}`)
  check('manifest', manifest.dependencies?.[pkg.name] !== undefined, `dependencies does not declare ${pkg.name}`)
  console.log(`bundles: ${bundles.join(', ')}`)
}

// 3) the bundle's patch mounts the package, so the Loader gets an entry
const patchPath = path.resolve(ROOT, pkg.dsh.bundle.patch)
check('patch', fs.existsSync(patchPath), `patch missing: ${patchPath}`)
if (fs.existsSync(patchPath)) {
  const patch = fs.readFileSync(patchPath, 'utf8')
  check('patch', patch.includes(`name: ${pkg.name}`), `patch does not mount ${pkg.name}`)
}

if (failures.length > 0) {
  console.error(`preflight FAILED (${String(failures.length)}):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log('preflight OK — restart DSH to collect the client bundle into the boot graph')
