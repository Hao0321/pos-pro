import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

function offlineShell() {
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
  return {name:'pos-offline-shell',apply:'build',closeBundle(){
    const root=process.cwd(),output=path.join(root,'dist')
    const assets=fs.readdirSync(path.join(output,'assets')).filter(name=>/\.(js|css)$/.test(name)).sort()
    const version=hash(Buffer.concat(assets.map(name=>fs.readFileSync(path.join(output,'assets',name)))))
    const core=['./','./index.html','./manifest.webmanifest','./apple-touch-icon.png',...assets.map(name=>'./assets/'+name)]
    const worker=fs.readFileSync(path.join(root,'public/sw.js'),'utf8').replace("'__BUILD_VERSION__'",JSON.stringify('pos-pro-'+version)).replace(/const CORE = .*\n/, 'const CORE = '+JSON.stringify(core)+'\n')
    fs.writeFileSync(path.join(output,'sw.js'),worker)
    const evidence=path.join(root,'.rd/build');fs.mkdirSync(evidence,{recursive:true})
    fs.writeFileSync(path.join(evidence,'frontend-receipt.json'),JSON.stringify({schemaVersion:1,nodeVersion:process.version,
      executable:process.execPath,executableSha256:hash(fs.readFileSync(process.execPath)),offlineAssetCount:core.length,
      bundleSha256:version,workerSha256:hash(Buffer.from(worker)),completedAt:new Date().toISOString()},null,2))
  }}
}

export default defineConfig({
  plugins: [react(),offlineShell()],
  base: './',
  test: { exclude: ['**/node_modules/**','**/.git/**','**/.rd/**','**/dist/**','**/release/**','**/build/**'] },
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
            { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: 'supabase', test: /node_modules[\\/]@supabase[\\/]/ },
          ],
        },
      },
    },
  },
})
