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
    const assets=fs.readdirSync(path.join(output,'assets')).filter(name=>/\.(js|css)$/.test(name)).sort()
    const scenariosDir=path.join(output,'scenarios','donburi')
    const scenarioFiles=fs.existsSync(scenariosDir)?fs.readdirSync(scenariosDir).filter(name=>/\.(html|css|mjs)$/.test(name)).sort().map(name=>'scenarios/donburi/'+name):[]
    const agentFiles=['agent/manifest.json','agent/document-draft-v1.schema.json','agent/business-document-v1.schema.json','llms.txt']
    const languageFiles=fs.readdirSync(path.join(output,'i18n'),{recursive:true}).filter(name=>name.endsWith('.mjs')).sort().map(name=>'i18n/'+name.replaceAll('\\','/'))
    const bundleFiles=[...assets.map(name=>'assets/'+name),...scenarioFiles,...agentFiles,...languageFiles]
    const cachedFiles=['index.html','manifest.webmanifest','apple-touch-icon.png','icon-192.png','icon-512.png',...bundleFiles]
    const version=hash(Buffer.concat(cachedFiles.flatMap(name=>[Buffer.from(name),fs.readFileSync(path.join(output,name))])))
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
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
          ],
        },
      },
    },
  },
})
