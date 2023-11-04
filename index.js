'use strict'

const { createServer } = require('http')
const { createProxy } = require('http-proxy')

const connect = require('connect')

const helmet = require('helmet')
const cors = require('cors')
const compression = require('compression')
const responseTime = require('response-time')
const rateLimit = require('express-rate-limit')
const morgan = require('morgan')

const PROXY_APP_PORT = process.env.PORT || '3300'

const app = connect()

const proxyServer = createProxy({
  prependPath: false,
  ignorePath: false,
  changeOrigin: false,
  xfwd: true,
  secure: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0',
  timeout: 5000,
  proxyTimeout: 5000,
})

// Middlewares
app.use(responseTime())
app.use(
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60 * 10, // Limit each IP to 600 requests per `window` (here, per 1 minute)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    keyGenerator: (request, response) =>
      request.headers['x-forwarded-for'] ||
      request.ip ||
      request.socket.remoteAddress ||
      request.connection.remoteAddress ||
      request.headers.origin,
  })
)
// app.use(helmet.contentSecurityPolicy());
// app.use(helmet.crossOriginEmbedderPolicy());
// app.use(helmet.crossOriginOpenerPolicy());
// app.use(helmet.crossOriginResourcePolicy());
app.use(helmet.dnsPrefetchControl())
// app.use(helmet.expectCt())
app.use(helmet.frameguard())
app.use(helmet.hidePoweredBy())
app.use(helmet.hsts())
app.use(helmet.ieNoOpen())
app.use(helmet.noSniff())
app.use(helmet.originAgentCluster())
app.use(helmet.permittedCrossDomainPolicies())
app.use(helmet.referrerPolicy())
app.use(helmet.xssFilter())
app.use(cors())
app.use(compression())
app.use(morgan('tiny'))

// Setup Proxy Info
app.use((req, res, next) => {
  try {
    const relativePath = decodeURIComponent(
      String(req.originalUrl).replace(/^\//, '')
    )
    const { href: proxyTarget, host: proxyHost } = new URL(relativePath)
    // Needed by http-proxy
    req.url = proxyTarget
    res.locals = res.locals || {}
    res.locals.proxyTarget = proxyTarget
    res.locals.proxyHeaders = {
      host: proxyHost,
      // origin: proxyOrigin
    }
    next()
  } catch (err) {
    next(err)
  }
})

// Validate Proxy Info
app.use((req, res, next) => {
  // Absense of Origin (reserved header) means that no CORS handling is required
  if (!req.headers.origin) {
    res.writeHead(302, {
      Location: res.locals.proxyTarget,
    })
    res.end()
    return
  }
  next()
  return
})

// Setup Proxy
app.use((req, res, next) => {
  try {
    const { proxyTarget, proxyHeaders } = res.locals || {}
    proxyServer.web(
      req,
      res,
      {
        target: proxyTarget,
        headers: proxyHeaders,
      },
      next
    )
  } catch (err) {
    next(err)
  }
})

// Error Handler
app.use((err, req, res, next) => {
  res.statusCode = 500
  res.end('Error: ' + err.message)
})

// Start Server
createServer(app).listen(PROXY_APP_PORT)
