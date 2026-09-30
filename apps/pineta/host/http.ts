// host/http — the host's one HTTP server: the Exchange's websocket, Vite, the
// blobs and an offer's reads. It carries out `planRequest` and `planUpgrade`
// (routes.ts), which admit first.

import http, { type IncomingMessage, type ServerResponse } from "node:http"
import { createRequire } from "node:module"
import { networkInterfaces } from "node:os"
import path from "node:path"
import {
  type WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import type { BlobStore, Sha256 } from "@pineta/core"
import type { OfferAsk } from "@pineta/marginalia"
import { prepareImage } from "@pineta/pi"
import { createServer as createViteServer } from "vite"
import { WebSocketServer } from "ws"
import { KEY_COOKIE, planInvites, requestFacts, urlHost } from "./admission.ts"
import { messageOf } from "./basics.ts"
import { MAX_UPLOAD_BYTES, planUploadHeaders } from "./blobs.ts"
import type { HotReload } from "./hot-reload.ts"
import {
  blobResponse,
  type HttpAnswer,
  offerResponse,
  uploaded,
  uploadRefusal,
} from "./responses.ts"
import { planRequest, planUpgrade } from "./routes.ts"
import type { LaneWork } from "./work/index.ts"

export interface RunningHttp {
  readonly port: number
  readonly httpUrl: string
  readonly wsUrl: string
  readonly invites: readonly string[]
  /** Close the websocket server, then the HTTP server. */
  close(): Promise<void>
}

const send = (res: ServerResponse, answer: HttpAnswer): void => {
  res.writeHead(answer.status, answer.headers).end(answer.body)
}

export async function startHttp(input: {
  readonly port: number
  readonly bind: string
  /** The invite key, or null on loopback. */
  readonly key: string | null
  /** Whether the agent has tools: off loopback, the log warns what a link grants. */
  readonly tools: boolean
  readonly serverTransport: WebsocketServerTransport
  readonly hotReload: HotReload
  readonly blobs: BlobStore
  readonly offers: LaneWork["offers"]
  readonly log: (message: string) => void
}): Promise<RunningHttp> {
  const { port, bind, key, serverTransport, hotReload, blobs, offers } = input

  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", ws => {
    const { start } = serverTransport.handleConnection({
      socket: wrapNodeWebsocket(ws),
    })
    start()
  })

  const httpServer = http.createServer()

  // Vite serves the client: index.html, module transforms, wasm, HMR. One
  // node:http server is shared, so there is a single port and a single origin.
  // Locate the client through module RESOLUTION, not a relative path: it is a
  // package this app depends on, and where it sits on disk is its business.
  const clientDir = path.dirname(
    createRequire(import.meta.url).resolve("@pineta/client/package.json"),
  )
  const vite = await createViteServer({
    root: clientDir,
    configFile: path.join(clientDir, "vite.config.ts"),
    plugins: [hotReload.plugin],
    server: {
      middlewareMode: true,
      // Vite attaches its own upgrade listener, ahead of the one below, so its
      // socket would bypass admission: hot reload runs on loopback only.
      hmr: key === null ? { server: httpServer } : false,
    },
  })
  hotReload.attach(() => vite.ws.send({ type: "full-reload" }))
  // Each request carries out its plan (`planRequest`), which admits first.
  httpServer.on("request", (req, res) => {
    const to = planRequest(requestFacts(req), key, req.method)
    switch (to.kind) {
      case "refuse":
        res.writeHead(403).end()
        return
      case "redirect":
        res
          .writeHead(302, {
            location: to.location,
            "set-cookie": `${KEY_COOKIE}=${encodeURIComponent(key ?? "")}; HttpOnly; SameSite=Strict; Path=/`,
          })
          .end()
        return
      case "blob-get":
        return serveBlob(to.sha, res)
      case "blob-post":
        return void receiveBlob(req, res)
      case "offer":
        return void serveOfferRead(to.ask, res)
      case "bad":
        res.writeHead(400).end()
        return
      case "other":
        vite.middlewares(req, res)
    }
  })

  /**
   * `GET /offer/…`: a review or a diff of a commit an open offer holds. A
   * project whose lanes work directly has no offers.
   */
  async function serveOfferRead(ask: OfferAsk, res: ServerResponse) {
    const answer =
      offers === null
        ? ({ kind: "refused", status: 404, reason: "no offers here" } as const)
        : await offers.read(ask)
    send(res, offerResponse(answer))
  }

  function serveBlob(sha: Sha256 | null, res: ServerResponse): void {
    send(res, blobResponse(sha === null ? undefined : blobs.get(sha)))
  }

  /**
   * `POST /blob`: the headers decide whether to read; the body is read up to
   * `MAX_UPLOAD_BYTES`; pi judges and fits the bytes; the store keeps them.
   * Answers the `ImageRef`, or a status with the reason as text.
   */
  async function receiveBlob(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const headers = planUploadHeaders({
      contentType: req.headers["content-type"],
      contentLength: req.headers["content-length"],
    })
    if (headers.kind === "refuse") {
      send(res, uploadRefusal(headers.status, headers.reason, true))
      req.destroy()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    try {
      for await (const chunk of req as AsyncIterable<Buffer>) {
        size += chunk.byteLength
        if (size > MAX_UPLOAD_BYTES) {
          send(res, uploadRefusal(413, "too large", true))
          req.destroy()
          return
        }
        chunks.push(chunk)
      }
    } catch {
      return
    }
    const prepared = await prepareImage(Buffer.concat(chunks))
    if (!prepared.ok) {
      send(res, uploadRefusal(415, prepared.reason))
      return
    }
    try {
      send(res, uploaded(blobs.put(prepared.image)))
    } catch (error) {
      // The store closes with the host: an upload can outlive it.
      send(res, uploadRefusal(503, messageOf(error)))
    }
  }

  // ROUTE the upgrade. `noServer` + an explicit /ws test is what lets our sync
  // socket and Vite's HMR socket share a port: anything that is not /ws falls
  // through to Vite's own upgrade listener (attached via hmr.server above).
  // Handling every upgrade here — which is what this did before Vite — would
  // swallow HMR silently.
  httpServer.on("upgrade", (req, socket, head) => {
    switch (planUpgrade(requestFacts(req), key)) {
      case "refuse":
        socket.end("HTTP/1.1 403 Forbidden\r\n\r\n")
        return
      case "exchange":
        wss.handleUpgrade(req, socket, head, ws =>
          wss.emit("connection", ws, req),
        )
        return
      case "vite":
        return
    }
  })

  // A stale host holding the port is the most likely startup failure, and the
  // raw EADDRINUSE stack says nothing about how to recover. Fail with an
  // instruction instead; `PINETA_PORT=0` asks the OS for any free port.
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err?.code === "EADDRINUSE") {
        reject(
          new Error(
            `port ${port} is already in use — most likely a host left running.\n` +
              `  find it : lsof -ti :${port}\n` +
              `  stop it : lsof -ti :${port} | xargs kill\n` +
              `  or pick another port: PINETA_PORT=7392 npm run host  (PINETA_PORT=0 = any free port)`,
          ),
        )
        return
      }
      reject(err)
    })
    httpServer.listen(port, bind, resolve)
  })
  const address = httpServer.address()
  if (address === null || typeof address === "string") {
    throw new Error("http server did not bind to a TCP port")
  }
  const actualPort = address.port

  const local = urlHost(bind)
  const invites = planInvites({
    bind,
    key,
    port: actualPort,
    interfaces: Object.values(networkInterfaces()).flat(),
  })
  if (key !== null && input.tools)
    input.log(
      "[host] WARNING: anyone with the invite link can run commands on this machine as you.",
    )

  return {
    port: actualPort,
    httpUrl: `http://${local}:${actualPort}/`,
    wsUrl: `ws://${local}:${actualPort}/ws`,
    invites,
    async close() {
      try {
        wss.close()
      } catch {}
      await new Promise<void>(resolve => {
        httpServer.close(() => resolve())
      })
    },
  }
}
