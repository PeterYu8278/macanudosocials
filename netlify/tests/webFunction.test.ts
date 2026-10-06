// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import { toWebFunction, type EventHandler } from '../functions/_shared/webFunction'

describe('modern Netlify request/response boundary', () => {
  it('preserves JSON, authorization, URL and repeated query parameters', async () => {
    const handler = vi.fn<EventHandler>().mockResolvedValue({ statusCode: 201, body: '{"success":true}', headers: { 'Content-Type': 'application/json' } })
    const response = await toWebFunction(handler)(new Request('https://example.com/.netlify/functions/create-member?tag=a&tag=b', {
      method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: '{"email":"member@example.com"}',
    }))
    const event = handler.mock.calls[0][0]
    expect(event).toMatchObject({ httpMethod: 'POST', path: '/.netlify/functions/create-member',
      body: '{"email":"member@example.com"}', isBase64Encoded: false,
      headers: { authorization: 'Bearer test-token' }, queryStringParameters: { tag: 'b' },
      multiValueQueryStringParameters: { tag: ['a', 'b'] } })
    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(await response.json()).toEqual({ success: true })
  })

  it('keeps payment callback form bytes unchanged and uses the platform client IP', async () => {
    const handler = vi.fn<EventHandler>().mockResolvedValue({ statusCode: 200 })
    const body = 'billplz%5Bid%5D=123&billplz%5Bx_signature%5D=a%2Bb%3D'
    await toWebFunction(handler)(new Request('https://example.com/.netlify/functions/billplz-callback', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-nf-client-connection-ip': 'spoofed' }, body,
    }), { ip: '203.0.113.10' })
    expect(handler.mock.calls[0][0].body).toBe(body)
    expect(handler.mock.calls[0][0].headers['x-nf-client-connection-ip']).toBe('203.0.113.10')
  })

  it('preserves CORS preflight and empty request bodies', async () => {
    const handler = vi.fn<EventHandler>().mockResolvedValue({ statusCode: 204, body: '', headers: { 'Access-Control-Allow-Origin': '*' } })
    const response = await toWebFunction(handler)(new Request('https://example.com/api', { method: 'OPTIONS' }))
    expect(handler.mock.calls[0][0]).toMatchObject({ body: null, queryStringParameters: null, httpMethod: 'OPTIONS' })
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('preserves redirect, multiple cookies and encoded binary responses', async () => {
    const handler: EventHandler = async () => ({ statusCode: 302, headers: { Location: '/profile' },
      multiValueHeaders: { 'Set-Cookie': ['a=1; Path=/', 'b=2; Path=/'] }, body: 'AAECAw==', isBase64Encoded: true })
    const response = await toWebFunction(handler)(new Request('https://example.com/api'))
    expect(response.headers.get('location')).toBe('/profile')
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 1, 2, 3])
  })

  it('propagates job failures rather than falsely reporting success', async () => {
    await expect(toWebFunction(async () => { throw new Error('job failed') })(new Request('https://example.com/job'))).rejects.toThrow('job failed')
  })
})

describe('deployed function entry points', () => {
  const directory = resolve('netlify/functions')
  const files = readdirSync(directory).filter(name => name.endsWith('.ts'))
  it.each(files)('%s exposes the modern default export without a Lambda handler export', name => {
    const source = readFileSync(resolve(directory, name), 'utf8')
    const ast = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true)
    expect(ast.statements.some(statement => ts.isExportAssignment(statement) && !statement.isExportEquals)).toBe(true)
    expect(source).not.toMatch(/export\s+(?:const|function)\s+handler\b/)
    expect(source).not.toMatch(/\bschedule\(/)
  })
  it('preserves the three UTC schedules in modern function configuration', () => {
    const schedules = { 'process-membership-renewals.ts': '5 16 * * *',
      'process-pending-visit-checkouts.ts': '* * * * *', 'scheduled-push-reminders.ts': '0 4 * * *' }
    for (const [name, cron] of Object.entries(schedules)) {
      expect(readFileSync(resolve(directory, name), 'utf8')).toContain(`export const config = { schedule: '${cron}' }`)
    }
  })
})
