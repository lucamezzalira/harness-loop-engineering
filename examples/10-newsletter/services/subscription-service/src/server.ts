import http from 'node:http'
import type { EventBus } from '../../../packages/contracts/src/index.js'
import type { SubscriberStore } from './store.js'
import { subscribe, type Logger } from './subscribe.js'

export function createSubscriptionServer(
  store: SubscriberStore,
  bus: EventBus,
  log: Logger,
): http.Server {
  return http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/subscribe') {
      const body = await readJson(req)
      const result = await subscribe(store, bus, log, body)
      if (!result.ok) {
        res.writeHead(result.statusCode, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: result.error }))
        return
      }
      res.writeHead(201, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ subscriberId: result.subscriberId }))
      return
    }
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true }))
      return
    }
    res.writeHead(404)
    res.end()
  })
}

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}
