import { test, expect } from 'vitest'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import net from 'node:net'
const require = createRequire(import.meta.url)
const transportPath = path.resolve('electron/printerTransport.cjs')
function withChild(execFile) {
  const module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(transportPath, 'utf8'), { module, Buffer, process,
    require: name => name === 'node:child_process' ? { execFile } : require(name),
  }, { filename: transportPath })
  return module.exports
}

test('Windows destinations remain literal data, with fixed hidden bounded child and complete byte inventory', async () => {
  const calls = [], temporary = [], payload = Buffer.from('receipt\x00\xff', 'latin1')
  const transport = withChild((executable, args, options, reply) => {
    calls.push({ executable, args, options }); temporary.push(path.dirname(options.env.POS_RAW_FILE))
    expect(fs.readFileSync(options.env.POS_RAW_FILE)).toEqual(payload)
    reply(null, 'POS_RAW_OK\r\n')
  })
  const names = ['店家 USB (80mm)', '\\\\localhost\\POS_PRINTER', 'name" & echo injected > owned.txt %PATH%']
  for (const name of names) expect(await transport.sendToPrinter({ printerType: 'windows', printerName: name }, [payload])).toEqual({ success: true })
  expect(calls.every(call => call.args.join(' ') === calls[0].args.join(' '))).toBe(true)
  expect(calls.map(call => call.options.env.POS_RAW_PRINTER)).toEqual(names)
  const program = Buffer.from(calls[0].args.at(-1), 'base64').toString('utf16le')
  expect(program).toContain('OpenPrinterW'); expect(program).toContain('$env:POS_RAW_PRINTER')
  expect(program).not.toContain(names[2]); expect(program).not.toContain('Invoke-Expression')
  for (const { options } of calls) expect(options).toMatchObject({ windowsHide: true, timeout: 15000 })
  expect(new Set(temporary).size).toBe(3); expect(temporary.every(name => !fs.existsSync(name))).toBe(true)
})

test.each(['child-error', 'missing-ack'])('Windows %s never reports success and removes its owned temporary files', async kind => {
  let directory
  const transport = withChild((_executable, _args, options, reply) => {
    directory = path.dirname(options.env.POS_RAW_FILE)
    reply(kind === 'child-error' ? new Error('failed') : null, 'other output')
  })
  expect((await transport.sendToPrinter({ printerType: 'windows' }, [Buffer.from('job')])).success).toBe(false)
  expect(fs.existsSync(directory)).toBe(false)
})

test('invalid destination, port and raw payload fail before starting a child', async () => {
  const transport = withChild(() => { throw new Error('must not run') })
  expect((await transport.sendToPrinter({ printerType: 'windows', printerName: 'bad\nname' }, [])).success).toBe(false)
  for (const settings of [{ printerPort: '9100&cmd' }, { printerPort: 0.2 }, { printerIP: 'http://host/path' }, { printerType: 'unknown' }]) {
    expect((await transport.sendToPrinter(settings, [])).success).toBe(false)
  }
  expect((await transport.sendToPrinter({ printerType: 'windows' }, [Buffer.alloc(4 * 1024 * 1024 + 1)])).success).toBe(false)
})

test('the real TCP transport sends receipt bytes to an isolated loopback receiver', async () => {
  let complete
  const received = new Promise(resolve => { complete = resolve })
  const server = net.createServer(socket => {
    const chunks = []; socket.on('data', bytes => chunks.push(bytes)); socket.on('end', () => complete(Buffer.concat(chunks)))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const result = await require('../../electron/printerTransport.cjs').sendToPrinter({ printerIP: '127.0.0.1', printerPort: server.address().port }, [Buffer.from('actual receipt')])
    expect(result.success).toBe(true); expect((await received).toString()).toBe('actual receipt')
  } finally { await new Promise(resolve => server.close(resolve)) }
})

test('label printing propagates transport failure and rejects unbounded jobs and printer control bytes', async () => {
  const labels = require('../../electron/barcode.js'), product = { id: 'p1', barcode: 'ABC', name: '商品', price: 10 }
  const result = await labels.printLabels([product], 1, { printerPort: 'invalid' })
  expect(result.success).toBe(false); expect(result.results[0].success).toBe(false)
  expect((await labels.printLabels([product], Infinity)).success).toBe(false)
  expect((await labels.printLabels([{ ...product, barcode: 'A\x1bB' }])).success).toBe(false)
})
