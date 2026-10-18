import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { renderOfflineWorker } from './scripts/offlineWorker.mjs'

function offlineShell() {
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
  return {name:'pos-offline-shell',apply:'build',closeBundle(){
    const root=process.cwd(),output=path.join(root,'dist')
    // JsBarcode publishes MIT-LICENSE.txt, which Vite's standard name lookup misses.
    const noticesFile=path.join(output,'THIRD_PARTY_LICENSES.txt')
    let notices=fs.readFileSync(noticesFile,'utf8')
    const barcodeLicense=fs.readFileSync(path.join(root,'node_modules/jsbarcode/MIT-LICENSE.txt'),'utf8').trim()
    if(/^## jsbarcode - /m.test(notices)&&!notices.includes(barcodeLicense)){
      const empty=/^(## jsbarcode - [^\r\n]+\r?\n)(?:\r?\n)*(?=## |$)/m
      if(!empty.test(notices))throw Error('JsBarcode license text differs; review bundled notices')
      notices=notices.replace(empty,(_section,heading)=>heading+'\n'+barcodeLicense+'\n\n')
      fs.writeFileSync(noticesFile,notices)
    }
    if(notices.split(/^## /m).slice(1).some(section=>!section.slice(section.indexOf('\n')+1).trim()))
      throw Error('Bundled dependency license text is missing')

    const assets=fs.readdirSync(path.join(output,'assets')).filter(name=>/\.(js|css)$/.test(name)).sort()
    const scenariosDir=path.join(output,'scenarios','donburi')
    const scenarioFiles=fs.existsSync(scenariosDir)?fs.readdirSync(scenariosDir).filter(name=>/\.(html|css|mjs)$/.test(name)).sort().map(name=>'scenarios/donburi/'+name):[]
    // The canonical task documents work on ordinary static hosts. The hidden
    // discovery alias is online metadata; a host hiding dotfiles must not
    // prevent the entire trading shell from installing its offline cache.
    const agentFiles=[...fs.readdirSync(path.join(output,'agent'),{recursive:true}).filter(name=>/\.(json|txt)$/.test(name)).sort().map(name=>'agent/'+name.replaceAll('\\','/')),'llms.txt','THIRD_PARTY_LICENSES.txt']
    const languageFiles=fs.readdirSync(path.join(output,'i18n'),{recursive:true}).filter(name=>name.endsWith('.mjs')).sort().map(name=>'i18n/'+name.replaceAll('\\','/'))
    const bundleFiles=[...assets.map(name=>'assets/'+name),...scenarioFiles,...agentFiles,...languageFiles]
    const cachedFiles=['index.html','manifest.webmanifest','apple-touch-icon.png','icon-192.png','icon-512.png',...bundleFiles]
    const version=hash(Buffer.concat([...cachedFiles,'.well-known/pos-agent.json'].flatMap(name=>[Buffer.from(name),fs.readFileSync(path.join(output,name))])))
    const core=['./',...cachedFiles.map(name=>'./'+name)]
    const {source:worker,files:workerFiles}=renderOfflineWorker(fs.readFileSync(path.join(root,'public/sw.js'),'utf8'),'pos-pro-'+version,core)
    fs.writeFileSync(path.join(output,'sw.js'),worker)
    const evidence=path.join(root,'.rd/build');fs.mkdirSync(evidence,{recursive:true})
    fs.writeFileSync(path.join(evidence,'frontend-receipt.json'),JSON.stringify({schemaVersion:1,nodeVersion:process.version,
      executable:process.execPath,executableSha256:hash(fs.readFileSync(process.execPath)),offlineAssetCount:workerFiles.length,
      bundleSha256:version,workerSha256:hash(Buffer.from(worker)),completedAt:new Date().toISOString()},null,2))
  }}
}

export default defineConfig({
  plugins: [react(),offlineShell()],
  base: './',
  test: { setupFiles:['./tests/setup-locale.js'], exclude: ['**/node_modules/**','**/.git/**','**/.rd/**','**/dist/**','**/release/**','**/build/**'] },
  server: { host: '127.0.0.1' },
  build: {
    license: { fileName: 'THIRD_PARTY_LICENSES.txt' },
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // 把大型第三方拆成獨立 chunk：長期快取 + 縮小主 app chunk
        codeSplitting: {
          groups: [
            { name: 'translations', test: /public[\\/]i18n[\\/](?:messages\.mjs|catalogue[\\/])/ },
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
          ],
        },
      },
    },
  },
})
