import { createInProcessBus } from '../../../packages/contracts/src/index.js'
import { createSubscriptionServer } from './server.js'
import { SubscriberStore } from './store.js'

const port = Number(process.env.PORT ?? 4100)
const store = new SubscriberStore()
const bus = createInProcessBus()
const log = {
  info(message: string, fields?: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'info', message, ...fields }))
  },
  error(message: string, fields?: Record<string, unknown>) {
    console.error(JSON.stringify({ level: 'error', message, ...fields }))
  },
}

const server = createSubscriptionServer(store, bus, log)
server.listen(port, () => {
  log.info('subscription-service listening', { port })
})
