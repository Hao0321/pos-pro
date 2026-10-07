const net = require('node:net')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { execFile } = require('node:child_process')

// Fixed program: destination and filename are data in the child environment.
// OpenPrinter supports installed names and shared printers without cmd.exe COPY.
const RAW_PROGRAM = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class PosRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
  public class DocInfo { public string name="POS receipt"; public string output=null; public string type="RAW"; }
  [DllImport("winspool.drv", EntryPoint="OpenPrinterW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", EntryPoint="StartDocPrinterW", CharSet=CharSet.Unicode, SetLastError=true)]
  static extern uint StartDocPrinter(IntPtr handle, int level, [In] DocInfo info);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr handle);
  static void Check(bool ok) { if (!ok) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  public static void Run(string name, byte[] bytes) {
    IntPtr handle; Check(OpenPrinter(name, out handle, IntPtr.Zero));
    bool document=false, page=false;
    try {
      if (bytes==null) return;
      Check(StartDocPrinter(handle, 1, new DocInfo())!=0); document=true;
      Check(StartPagePrinter(handle)); page=true;
      int written; Check(WritePrinter(handle, bytes, bytes.Length, out written));
      if (written!=bytes.Length) throw new Exception("Incomplete printer write");
      Check(EndPagePrinter(handle)); page=false;
      Check(EndDocPrinter(handle)); document=false;
    } finally { if(page) EndPagePrinter(handle); if(document) EndDocPrinter(handle); ClosePrinter(handle); }
  }
}
'@
$bytes = $null
if ($env:POS_RAW_FILE) { $bytes = [IO.File]::ReadAllBytes($env:POS_RAW_FILE) }
[PosRawPrinter]::Run($env:POS_RAW_PRINTER, $bytes)
Write-Output 'POS_RAW_OK'
`
const ENCODED_PROGRAM = Buffer.from(RAW_PROGRAM, 'utf16le').toString('base64')

function destination(settings = {}) {
  const type = settings.printerType || 'network'
  if (type === 'windows') {
    const name = settings.printerName || '\\\\localhost\\POS_PRINTER'
    if (typeof name !== 'string' || name.length > 256 || !name.trim() || /[\x00-\x1f\x7f]/.test(name)) throw new Error('印表機名稱無效')
    return { type, name }
  }
  if (type !== 'network') throw new Error('不支援的印表機類型')
  const ip = settings.printerIP || '192.168.1.100', port = Number(settings.printerPort || 9100)
  if (typeof ip !== 'string' || ip.length > 253 || !(net.isIP(ip) || /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(ip))) throw new Error('印表機位址無效')
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('印表機連接埠無效')
  return { type, ip, port }
}

async function windowsPrinter(name, bytes) {
  const directory = bytes ? fs.mkdtempSync(path.join(os.tmpdir(), 'pos-raw-')) : null
  const filename = directory ? path.join(directory, 'job.bin') : ''
  try {
    if (bytes) fs.writeFileSync(filename, bytes, { flag: 'wx' })
    await new Promise((resolve, reject) => {
      const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      execFile(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', ENCODED_PROGRAM], {
        windowsHide: true, timeout: 15000, maxBuffer: 64 * 1024,
        env: { ...process.env, POS_RAW_PRINTER: name, POS_RAW_FILE: filename },
      }, (error, stdout) => {
        if (error) reject(new Error('Windows 列印失敗，請確認印表機與列印佇列'))
        else if (!String(stdout).includes('POS_RAW_OK')) reject(new Error('印表機未確認列印結果'))
        else resolve()
      })
    })
  } finally {
    if (directory) fs.rmSync(directory, { recursive: true, force: true })
  }
}

function networkPrinter(target, bytes) {
  return new Promise((resolve, reject) => {
    const client = new net.Socket()
    const finish = error => { client.destroy(); error ? reject(error) : resolve() }
    client.setTimeout(5000)
    client.once('error', finish)
    client.once('timeout', () => finish(new Error('印表機連線逾時')))
    client.connect(target.port, target.ip, () => {
      if (bytes) client.write(bytes, error => error ? finish(error) : client.end(() => finish()))
      else finish()
    })
  })
}

async function sendToPrinter(settings, data) {
  try {
    const target = destination(settings), bytes = Buffer.concat(data)
    if (bytes.length > 4 * 1024 * 1024) throw new Error('列印資料超過上限')
    if (target.type === 'windows') await windowsPrinter(target.name, bytes)
    else await networkPrinter(target, bytes)
    return { success: true }
  } catch (error) { return { success: false, error: error.message } }
}

async function getStatus(settings) {
  try {
    const target = destination(settings)
    if (target.type === 'windows') await windowsPrinter(target.name, null)
    else await networkPrinter(target, null)
    return { connected: true, ...target }
  } catch (error) { return { connected: false, error: error.message } }
}

module.exports = { sendToPrinter, getStatus }
