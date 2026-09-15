import http from 'node:http'
import { createInProcessBus } from '../../../packages/contracts/src/index.js'
import { attachWelcomeHandler } from './handler.js'
import { createMailTransport, IdempotentMailer } from './mailer.js'

const port = Number(process.env.PORT ?? 4101)
const bus = createInProcessBus()
const mailer = new IdempotentMailer(createMailTransport())
const log = {
  info(message: string, fields?: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'info', message, ...fields }))
  },
  error(message: string, fields?: Record<string, unknown>) {
    console.error(JSON.stringify({ level: 'error', message, ...fields }))
  },
}

attachWelcomeHandler(bus, mailer, log)

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, sent: mailer.sentCount() }))
    return
  }
  res.writeHead(404)
  res.end()
})

server.listen(port, () => {
  log.info('email-service listening', { port })
})
