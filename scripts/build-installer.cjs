const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto')
const { spawnSync, execFileSync } = require('node:child_process')
const { build, Platform } = require('electron-builder'), { Arch } = require('builder-util')
const asar = require('@electron/asar')
const {delivery,sourceInputs,frontendInputs}=require('./delivery/pipeline.cjs')
const {outputPath,claim,buildArguments,upgradeFixtures}=require('./delivery/build-state.cjs')
const root = path.resolve(__dirname, '..'), hash = data => crypto.createHash('sha256').update(data).digest('hex')
function filesIn(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error('Build inventory contains a symbolic link')
    return entry.isDirectory() ? filesIn(file) : [file]
  })
}
function identity(file, base = root) { const data = fs.readFileSync(file); return { path: path.relative(base, file).replaceAll('\\', '/'), bytes: data.length, sha256: hash(data) } }
function write(file, data) { fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n') }
function archiveFiles(directory, prefix = '') {
  return Object.entries(directory.files).flatMap(([name, entry]) => {
    const member = prefix + name
    if (entry.link) throw new Error('Packaged ASAR contains a symbolic link')
    return entry.files ? archiveFiles(entry, member + '/') : [member]
  })
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Installer builds require Node.js 24 or newer')
  process.env.PATH = path.dirname(process.execPath) + path.delimiter + process.env.PATH
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const options=buildArguments(process.argv.slice(2)),upgrades=upgradeFixtures(root,options['--upgrade-fixtures'])
  const output = outputPath(root,options['--out']||null,pkg.version)
  const state=claim(root)
  let completed,primaryFailure
  try{
  const result = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], { cwd: root, stdio: 'inherit', windowsHide: true })
  if (result.error || result.status !== 0) throw new Error('Frontend build failed')
  const inputs = sourceInputs(root)
  const frontend = frontendInputs(root)
  const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root }).toString().trim()
  const dirty = !!execFileSync('git', ['status', '--porcelain'], { cwd: root }).toString().trim()
  const artifacts = await build({ targets: Platform.WINDOWS.createTarget(['nsis'], Arch.x64), publish: 'never', config: {
    directories: { output }, electronDist: path.join(root, 'node_modules/electron/dist'),
    afterPack: async context => {
      const resources = path.join(context.appOutDir, 'resources'), archive = path.join(resources, 'app.asar')
      const members = archiveFiles(asar.getRawHeader(archive).header)
      const components = [], notice = [], seen = new Set(), unknownLicenses = []
      for (const member of members) {
        if (/\.map$/i.test(member)) throw new Error('Packaged source map must be excluded')
        if (/(?:^|\/)package\.json$/.test(member) && member.includes('node_modules/')) {
          const dependency = JSON.parse(asar.extractFile(archive, path.normalize(member)).toString('utf8'))
          if (!dependency.name || !dependency.version) continue
          const key = dependency.name + '@' + dependency.version
          if (seen.has(key)) continue
          seen.add(key)
          const license = typeof dependency.license === 'string' ? dependency.license : dependency.license?.type
          if (!license) unknownLicenses.push(key)
          components.push({ type: 'library', name: dependency.name, version: dependency.version,
            purl: 'pkg:npm/' + dependency.name.replace(/^@/, '%40') + '@' + dependency.version,
            licenses: license ? [{ license: { name: license } }] : [] })
        }
        if (/(?:^|\/)(?:LICEN[CS]E|COPYING|NOTICE|COPYRIGHT)(?:\.[^/]*)?$/i.test(member)) {
          const data = asar.extractFile(archive, path.normalize(member))
          if (data.length > 1024 * 1024) throw new Error('Unexpectedly large packaged license')
          notice.push('===== ' + member + ' =====\n' + data.toString('utf8'))
        }
      }
      if (unknownLicenses.length) throw new Error('Review undeclared package licenses: ' + unknownLicenses.join(', '))
      components.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version))
      write(path.join(resources, 'sbom.cdx.json'), { bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
        metadata: { component: { type: 'application', name: pkg.name, version: pkg.version, licenses: [{ license: { id: 'MIT' } }] } }, components })
      fs.writeFileSync(path.join(resources, 'THIRD_PARTY_NOTICES.txt'), notice.join('\n\n') + '\n\nElectron and Chromium notices are also supplied as LICENSE.electron.txt and LICENSES.chromium.html beside the application.\n')
      const packagedOutputs = [identity(archive, context.appOutDir), ...filesIn(archive + '.unpacked').map(file => identity(file, context.appOutDir))]
      write(path.join(resources, 'build-receipt.json'), { schemaVersion: 1, product: 'POS Pro', version: pkg.version,
        sourceRevision, sourceDirty: dirty, nodeVersion: process.version, electronVersion: context.packager.config.electronVersion || require('electron/package.json').version,
        sourceManifestSha256: hash(Buffer.from(JSON.stringify(inputs))), inputs, frontendOutputs: frontend,
        outputs: packagedOutputs, signing: 'unsigned', updatePolicy: 'manual; no trusted automatic update channel' })
    },
  } })
  const installers=artifacts.filter(file=>file.toLowerCase().endsWith('.exe'));if(installers.length!==1)throw Error('Exactly one installer envelope is required')
  const verification=await delivery({root,output,installer:installers[0],inputs,frontend,sourceRevision,version:pkg.version,electronVersion:require('electron/package.json').version,automatic:true,upgradeFixtures:upgrades})
  const receipt={ schemaVersion: 1, inputs,
    outputs: filesIn(output).sort().map(file => identity(file)),
    artifacts: artifacts.map(file => identity(file)), nodeExecutable: identity(process.execPath, path.dirname(process.execPath)),
    sourceRevision, sourceDirty: dirty, version: pkg.version, completedAt: new Date().toISOString(),delivery:{status:'PASS',automatic:true,run:verification.run,contract:verification.contractPath,deliveredTests:verification.report.runtime.tests,negativeControls:verification.report.calibration.negativeControls.length} }
  write(path.join(state.invocation,'installer-build-receipt.json'),receipt)
  const latest=path.join(root,'.rd/build/installer-build-receipt.json'),staged=path.join(state.invocation,'latest-receipt.json');write(staged,receipt);fs.renameSync(staged,latest)
  completed={ success: true, marker: 'POS_INSTALLER_BUILT', version: pkg.version, artifacts: artifacts.map(file => path.relative(root, file)),delivery:receipt.delivery }
  }catch(error){primaryFailure=error;try{write(path.join(state.invocation,'failure.json'),{schemaVersion:1,status:'FAIL',error:error.stack,output,completedAt:new Date().toISOString()})}catch(secondary){console.error('Failure receipt unavailable:',secondary.message)}throw error}
  finally{try{state.release()}catch(secondary){if(primaryFailure)console.error('Build lock cleanup failed:',secondary.message);else throw secondary}}
  process.stdout.write(JSON.stringify(completed)+'\n')
}
main().catch(error => { fs.writeSync(2, error.stack + '\n'); process.exit(1) })
