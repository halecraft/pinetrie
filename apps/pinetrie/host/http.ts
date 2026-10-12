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
import {
  type BlobStore,
  errorText,
  type Sha256,
  storedText,
  TEXT_MIME,
} from "@pinetrie/core"
import { prepareImage } from "@pinetrie/pi"
import type { OfferAsk } from "@pinetrie/rules"
import { createServer as createViteServer } from "vite"
import { WebSocketServer } from "ws"
import { KEY_COOKIE, planInvites, requestFacts, urlHost } from "./admission.ts"
import { MAX_UPLOAD_BYTES, planUploadHeaders } from "./blobs.ts"
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
  /**
   * Stop accepting, close Vite and every socket and request still open, then
   * wait for the HTTP server to close.
   */
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
  readonly blobs: BlobStore
  /** Your repo, whose offers a review reads; null for a host without tools. */
  readonly repo: LaneWork["repo"]
  readonly log: (message: string) => void
}): Promise<RunningHttp> {
  const { port, bind, key, serverTransport, blobs, repo } = input

  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", ws => {
    const { start } = serverTransport.handleConnection({
      socket: wrapNodeWebsocket(ws),
    })
    start()
  })

  const httpServer = http.createServer()
  // Vite's HMR listener sits on this stand-in, which never binds, so an upgrade
  // reaches it only through the `"vite"` route below, admitted. Without one,
  // Vite opens port 24678 and its client connects there.
  const viteUpgrades = http.createServer()

  // Vite serves the client: index.html, module transforms, wasm, HMR. One
  // node:http server is shared, so there is a single port and a single origin.
  // Locate the client through module RESOLUTION, not a relative path: it is a
  // package this app depends on, and where it sits on disk is its business.
  const clientDir = path.dirname(
    createRequire(import.meta.url).resolve("@pinetrie/web/package.json"),
  )
  const vite = await createViteServer({
    root: clientDir,
    configFile: path.join(clientDir, "vite.config.ts"),
    server: {
      middlewareMode: true,
      hmr: { server: viteUpgrades },
      // Admission decides which `Host` gets in (admission.ts): off loopback,
      // any name with the key, such as a tunnel's.
      allowedHosts: true,
    },
  })
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
   * host without tools has no offers.
   */
  async function serveOfferRead(ask: OfferAsk, res: ServerResponse) {
    const answer =
      repo === null
        ? ({ kind: "refused", status: 404, reason: "no offers here" } as const)
        : await repo.offers.read(ask)
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
    const bytes = Buffer.concat(chunks)
    // A reference's quote is kept as it is; an image is judged and fitted
    // first.
    const prepared =
      headers.mime === TEXT_MIME
        ? ({ ok: true, image: storedText(bytes.toString("utf8")) } as const)
        : await prepareImage(bytes)
    if (!prepared.ok) {
      send(res, uploadRefusal(415, prepared.reason))
      return
    }
    try {
      send(res, uploaded(blobs.put(prepared.image)))
    } catch (error) {
      // The store closes with the host: an upload can outlive it.
      send(res, uploadRefusal(503, errorText(error)))
    }
  }

  // ROUTE the upgrade: the Exchange's socket is `/ws`, and any other admitted
  // upgrade goes on to Vite's HMR listener, on `viteUpgrades`.
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
        // After `vite.close()` nothing answers, so `close()` stops accepting
        // first.
        viteUpgrades.emit("upgrade", req, socket, head)
        return
    }
  })

  // A stale host holding the port is the most likely startup failure, and the
  // raw EADDRINUSE stack says nothing about how to recover. Fail with an
  // instruction instead; `PINETRIE_PORT=0` asks the OS for any free port.
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", (err: NodeJS.ErrnoException) => {
      if (err?.code === "EADDRINUSE") {
        reject(
          new Error(
            `port ${port} is already in use — most likely a host left running.\n` +
              `  find it : lsof -ti :${port}\n` +
              `  stop it : lsof -ti :${port} | xargs kill\n` +
              `  or pick another port: PINETRIE_PORT=7392 npm run host  (PINETRIE_PORT=0 = any free port)`,
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
      // `close` stops accepting at once, but calls back only when every socket
      // has ended, upgraded ones too, which `closeAllConnections` does not
      // reach. Accepting stops before Vite closes: a page retries Vite's
      // socket, and once Vite's listener is gone that upgrade would be left
      // open.
      const closed = new Promise<void>(resolve => {
        httpServer.close(() => resolve())
      })
      await vite.close()
      try {
        wss.close()
      } catch {}
      // The exchange's transport accepts again once stopped, so a client
      // that reconnected after `exchange.shutdown()` has a socket here.
      for (const ws of wss.clients) ws.terminate()
      httpServer.closeAllConnections()
      await closed
    },
  }
}
