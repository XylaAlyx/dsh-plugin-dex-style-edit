/**
 * Static self-check for the plugin.
 *
 * Mirrors the marketplace preflight rules, because the two failure modes it
 * exists to catch are silent: a browser bundle whose registration id does not
 * match the package name never loads (and nothing reports it), and a patch that
 * names the wrong row leaves the plugin mounted but inert. Both are identity
 * mismatches that no runtime error surfaces.
 *
 * Run: node scripts/selfcheck.mjs
 * Optional env:
 *   DSH_PRIMITIVES_INDEX  path to @deepseek-ai/dsh-client-ui-primitives/lib/index.js
 *   DSH_SLOTS_JSON        path to the extracted slot catalog (slots.json)
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** The platform module table the web shell freezes for every plugin bundle. */
const PLATFORM_MODULES = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** Credential-ish basenames that must never ship to a public repository. */
const CREDENTIAL_PATTERNS = [
  /^\.env/u,
  /^\.npmrc$/u,
  /\.pem$/u,
  /\.key$/u,
  /^id_rsa/u,
  /^id_ed25519/u,
  /^credentials?\./u,
]

const failures = []
const warnings = []

/**
 * Record one failed expectation.
 * @param label - what was checked.
 * @param detail - why it failed.
 */
function fail(label, detail) {
  failures.push(`${label}: ${detail}`)
}

/**
 * Record one non-blocking problem.
 * @param label - what was checked.
 * @param detail - why it is worth fixing.
 */
function warn(label, detail) {
  warnings.push(`${label}: ${detail}`)
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

/**
 * The browser bundle's registered module id.
 * @param source - client bundle source.
 * @returns the id, or undefined.
 */
function bundleIdOf(source) {
  return /__ModuleLoader__\s*\.\s*load\s*\(\s*\{[\s\S]{0,300}?\bid\s*:\s*["']([^"']+)["']/u.exec(source)?.[1]
}

/**
 * The id of the first row a cordis patch inserts, scoped to the insert list.
 * @param source - patch YAML.
 * @returns the id, or undefined.
 */
function patchRowIdOf(source) {
  const insert = /-\s*insert:([\s\S]*)/u.exec(source)?.[1] ?? source
  return /^\s*-\s*id:\s*["']?([^\s"']+)["']?/mu.exec(insert)?.[1]
}

/**
 * The package name a patch row mounts.
 * @param source - patch YAML.
 * @returns the name, or undefined.
 */
function patchRowNameOf(source) {
  const insert = /-\s*insert:([\s\S]*)/u.exec(source)?.[1] ?? source
  return /^\s*name:\s*["']?([^\s"']+)["']?/mu.exec(insert)?.[1]
}

// ---------------------------------------------------------------- manifest
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
check('manifest', typeof pkg.name === 'string' && pkg.name.length > 0, 'package.json needs a name')
check('manifest', pkg.name === pkg.name.toLowerCase(), 'npm rejects new packages with uppercase names')
check('manifest', /^\d+\.\d+\.\d+/u.test(String(pkg.version)), `version ${String(pkg.version)} is not semver`)
check('manifest', pkg.type === 'module', 'must be an ES module package')
check(
  'manifest',
  typeof pkg.dsh?.bundle?.patch === 'string',
  'dsh.bundle.patch is required; without it the plugin is not installable',
)
check('manifest', pkg.dsh?.client?.platform === 'web', 'needs dsh.client.platform = "web"')
check('manifest', pkg.exports?.['./client'] !== undefined, 'needs an exports["./client"] entry')
check('manifest', typeof pkg.license === 'string' && pkg.license.length > 0, 'declare a license')
check('manifest', pkg.keywords?.includes('dsh-plugin') === true, 'keywords should include "dsh-plugin" for npm search')

if (!String(pkg.description ?? '').endsWith('.')) {
  warn('manifest', 'the description should end with a period (marketplace listing requirement)')
}
if (/\b(amazing|awesome|best|revolutionary|powerful|ultimate|seamless|blazing)\b/iu.test(String(pkg.description ?? ''))) {
  warn('manifest', 'the description contains a marketing word; listings want a plain statement')
}
if (typeof pkg.repository?.url !== 'string' || pkg.repository.url.includes('OWNER/')) {
  warn('manifest', 'repository.url still carries the OWNER placeholder (run scripts/init-repo.mjs <owner>)')
}

const entry = typeof pkg.main === 'string' ? pkg.main : 'lib/index.js'
check('manifest', fs.existsSync(path.join(ROOT, entry)), `the entry file ${entry} does not exist`)

// The gate that actually blocks a plugin install: the loader evaluates only
// @deepseek-ai/dsh peers, so a cordis-only peer list is an unguarded plugin.
check(
  'manifest',
  pkg.peerDependencies?.['@deepseek-ai/dsh'] !== undefined,
  'declare an @deepseek-ai/dsh peer, or the runtime performs no compatibility check at all',
)

// ------------------------------------------------------------------- patch
const patchPath = path.join(ROOT, String(pkg.dsh?.bundle?.patch ?? ''))
check('patch', pkg.dsh?.bundle?.patch !== undefined && fs.existsSync(patchPath), `patch missing at ${patchPath}`)

if (fs.existsSync(patchPath)) {
  const patch = fs.readFileSync(patchPath, 'utf8')
  check('patch', patch.includes('- insert:'), 'the patch should mount the plugin with a top-level insert list')
  const rowId = patchRowIdOf(patch)
  const rowName = patchRowNameOf(patch)
  check('patch', rowId !== undefined, 'the insert row needs an id')
  check('patch', rowName === pkg.name, `the insert row mounts "${String(rowName)}" but the package is "${pkg.name}"`)
  if (rowId !== pkg.name) {
    warn('patch', `the insert id "${String(rowId)}" differs from the package name; the loader keys rows by id`)
  }
}

// ------------------------------------------------------------- browser half
const clientEntry = path.resolve(ROOT, String(pkg.exports?.['./client'] ?? ''))
check('client', fs.existsSync(clientEntry), `client bundle missing at ${clientEntry}`)

if (fs.existsSync(clientEntry)) {
  const clientSource = fs.readFileSync(clientEntry, 'utf8')
  const bundleId = bundleIdOf(clientSource)
  check('client', bundleId !== undefined, 'the bundle must call __ModuleLoader__.load({ id })')
  // The highest-value check here: a mismatched bundle id never activates and
  // reports nothing, so the plugin looks installed and does nothing.
  check(
    'client',
    bundleId === pkg.name,
    `the bundle registers "${String(bundleId)}" but the package is "${pkg.name}" — the browser half would never load`,
  )

  // Every require() must name a platform module; anything else needs dsh.client.external.
  const declared = new Set(pkg.dsh?.client?.external ?? [])
  for (const match of clientSource.matchAll(/require\((['"])([^'"]+)\1\)/gu)) {
    const request = match[2]
    if (PLATFORM_MODULES.has(request) || declared.has(request) || request.startsWith('.')) continue
    fail('client', `require('${request}') is neither in the platform table nor declared in dsh.client.external`)
  }

  check(
    'client',
    /binding\.session\.prompt\(\[\{ type: 'text', text \}\], 'queue'\)/u.test(clientSource),
    'the fork must be prompted directly with the edited text',
  )
  check('client', !/setDraft/u.test(clientSource), 'the bundle must not restore a composer draft')
  check(
    'client',
    /archiveSession\(sessionId, \{ stopActivity: false \}\)/u.test(clientSource),
    'the replaced session must be archived with stopActivity: false',
  )

  // Sending from the composer's model. The ordering is the whole point: an Agent
  // resolves its model once per request, so a write that lands after the prompt
  // silently applies to the *next* turn instead of the edited message.
  check(
    'client',
    /'remote',\s*'remote\.session'/u.test(clientSource),
    'the model-selection endpoint lives on remote.session, which must be injected',
  )
  check(
    'client',
    /remote\.session\.selectModel\(\{/u.test(clientSource),
    'the composer\'s pending model must be applied to the fork',
  )
  check(
    'client',
    /projections[\s\S]{0,80}\.get\?\.\('modelSelection'\)/u.test(clientSource),
    'the pending choice must be read from the modelSelection projection',
  )
  const readAt = clientSource.indexOf('pendingModelChoice(ctx, sessionId)')
  const writeAt = clientSource.indexOf('applyModelChoice(ctx, childId, modelChoice)')
  const sendAt = clientSource.indexOf('await sendToFork(binding, nextText)')
  check('client', readAt !== -1 && writeAt !== -1 && sendAt !== -1, 'the model handoff is not wired into the edit flow')
  check(
    'client',
    readAt !== -1 && writeAt !== -1 && sendAt !== -1 && readAt < writeAt && writeAt < sendAt,
    'the model must be read before the fork and applied before the prompt, or it misses the edited message',
  )
  check(
    'client',
    /state\.byId\[sessionId\]\?\.parentId/u.test(clientSource),
    'the fork badge must read the Session lineage from the client list snapshot',
  )
  check('client', /origin === 'subagent'/u.test(clientSource), 'the fork badge must exclude spawned subagent children')
  check(
    'client',
    /name: 'sidebar\.session\.row\.leading'/u.test(clientSource),
    'the fork badge must register in the shipped row-leading seat',
  )
  check('client', /priority:\s*-1/u.test(clientSource), 'shadowing needs an explicit priority below the shipped 0')

  // Borrowed primitives symbols must exist in the shipped export list.
  const primitivesIndex = process.env.DSH_PRIMITIVES_INDEX
  if (primitivesIndex !== undefined && fs.existsSync(primitivesIndex)) {
    const primitives = fs.readFileSync(primitivesIndex, 'utf8')
    const exportBlock = primitives.slice(primitives.lastIndexOf('export {'))
    const exported = new Set([...exportBlock.matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/gu)].map((m) => m[0]))
    const destructured = /const\s*\{([\s\S]*?)\}\s*=\s*primitives/u.exec(clientSource)
    if (destructured === null) {
      fail('primitives', 'could not find the primitives destructuring block')
    } else {
      for (const raw of destructured[1].split(',')) {
        const name = raw.trim()
        if (name === '') continue
        check('primitives', exported.has(name), `@deepseek-ai/dsh-client-ui-primitives does not export ${name}`)
      }
    }
  } else {
    console.log('note: set DSH_PRIMITIVES_INDEX to verify borrowed primitives symbols')
  }

  // The shadowed slot must exist and be a keyed slot; the badge seat additive.
  const slotsCatalog = process.env.DSH_SLOTS_JSON
  if (slotsCatalog !== undefined && fs.existsSync(slotsCatalog)) {
    const catalog = JSON.parse(fs.readFileSync(slotsCatalog, 'utf8'))
    const slot = catalog.find((candidate) => candidate.key === 'conversation.chat.node')
    if (slot === undefined) {
      fail('slots', 'conversation.chat.node is not in the slot catalog')
    } else {
      check('slots', slot.kind === 'keyed', `expected a keyed slot, catalog says ${String(slot.kind)}`)
      check('slots', slot.replaceRisk === 'shadows-shipped-ui', 'unexpected replaceRisk for the shadowed slot')
    }
    const badgeSlot = catalog.find((candidate) => candidate.key === 'sidebar.session.row.leading')
    check('slots', badgeSlot !== undefined, 'sidebar.session.row.leading is not in the slot catalog')
    check('slots', badgeSlot?.replaceRisk === 'none', 'the fork badge seat should be additive')
  } else {
    console.log('note: set DSH_SLOTS_JSON to verify the shadowed and badge slots')
  }
}

// ------------------------------------------------------------------ secrets
for (const name of fs.readdirSync(ROOT)) {
  for (const pattern of CREDENTIAL_PATTERNS) {
    if (pattern.test(name)) fail('secrets', `"${name}" looks like a credential file and must not be published`)
  }
}
if (!fs.existsSync(path.join(ROOT, '.gitignore'))) {
  warn('repo', 'no .gitignore; build output and archives are easy to commit by accident')
}
if (!fs.existsSync(path.join(ROOT, 'LICENSE')) && !fs.existsSync(path.join(ROOT, 'LICENSE.md'))) {
  warn('repo', `the license is "${String(pkg.license)}" but no LICENSE file ships`)
}

// ------------------------------------------------------------------- report
for (const message of warnings) console.log(`warn  ${message}`)
if (failures.length > 0) {
  console.error(`selfcheck FAILED (${String(failures.length)}):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`selfcheck OK${warnings.length === 0 ? '' : ` (${String(warnings.length)} warning(s))`}`)
