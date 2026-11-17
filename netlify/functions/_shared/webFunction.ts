import type { Context, HandlerEvent, HandlerResponse } from '@netlify/functions'
import { withFirestoreMonitoring } from './firestoreMonitoring'

export type EventHandler = (event: HandlerEvent) => Promise<HandlerResponse>

// Keep business handlers unchanged while exposing the modern Request/Response API.
export function toWebFunction(handler: EventHandler) {
  return async (request: Request, context?: Pick<Context, 'ip'>): Promise<Response> => {
    const url = new URL(request.url)
    const headers = Object.fromEntries(request.headers.entries())
    if (context?.ip) headers['x-nf-client-connection-ip'] = context.ip
    const query: Record<string, string> = {}
    const multiQuery: Record<string, string[]> = {}
    url.searchParams.forEach((value, key) => {
      query[key] = value
      const values = multiQuery[key] ||= []
      values.push(value)
    })
    const result = await withFirestoreMonitoring(url.pathname.split('/').pop() || 'unknown', async () => handler({
      rawUrl: request.url, rawQuery: url.search.slice(1), path: url.pathname,
      httpMethod: request.method, headers,
      multiValueHeaders: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key, [value]])),
      queryStringParameters: url.search ? query : null,
      multiValueQueryStringParameters: url.search ? multiQuery : null,
      body: request.body === null ? null : await request.text(), isBase64Encoded: false,
    }))
    const responseHeaders = new Headers()
    for (const [key, value] of Object.entries(result.headers || {})) responseHeaders.set(key, String(value))
    for (const [key, values] of Object.entries(result.multiValueHeaders || {})) {
      responseHeaders.delete(key)
      for (const value of values) responseHeaders.append(key, String(value))
    }
    const body = result.isBase64Encoded ? Buffer.from(result.body || '', 'base64') : result.body
    return new Response([204, 205, 304].includes(result.statusCode) ? null : body ?? null, {
      status: result.statusCode, headers: responseHeaders,
    })
  }
}
