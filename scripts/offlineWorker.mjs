// Bind the generated cache declaration to the list that the build reports.
// Git on Windows can supply CRLF even when the developer's file used LF.
export function renderOfflineWorker(template, version, core) {
  if (typeof template !== 'string' || template.split("'__BUILD_VERSION__'").length !== 2)
    throw new Error('Offline worker requires exactly one build version marker')
  const declaration = /^const CORE = [^\r\n]*(\r?\n|$)/gm
  if ([...template.matchAll(declaration)].length !== 1)
    throw new Error('Offline worker requires exactly one cache declaration')
  if (!/^pos-pro-[0-9a-f]{64}$/.test(version) || !Array.isArray(core) || !core.length ||
      core.some(file => typeof file !== 'string' || !file.startsWith('./')) || new Set(core).size !== core.length)
    throw new Error('Offline worker version or cache files are invalid')
  const source = template
    .replace("'__BUILD_VERSION__'", JSON.stringify(version))
    .replace(declaration, (_line, newline) => 'const CORE = ' + JSON.stringify(core) + newline)
  const rendered = /^const CORE = (\[[^\r\n]*\])\r?$/m.exec(source)
  const files = rendered && JSON.parse(rendered[1])
  if (!files || JSON.stringify(files) !== JSON.stringify(core))
    throw new Error('Offline worker cache declaration differs from the build manifest')
  return { source, files }
}
