// host/http — the host's one HTTP server: the Exchange's websocket, the page
// (Vite, or its build), the blobs and proposed changes' reads. It carries out
// `planRequest`, `planUpgrade` and `planPageRequest` (routes.ts), which
// admit first.

import { readFile } from "node:fs/promises"
import http, { type IncomingMessage, type ServerResponse } from "node:http"
import { networkInterfaces } from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
  type WebsocketServerTransport,
  wrapNodeWebsocket,
} from "@kyneta/websocket-transport/server"
import {
  type BlobStore,
  errorText,
  type MachineFacts,
  type Sha256,
} from "@pinetrie/core"
import type { ReviewAsk } from "@pinetrie/rules"
import { WebSocketServer } from "ws"
import { KEY_COOKIE, planInvites, requestFacts, urlHost } from "./admission.ts"
import { classifyUpload, MAX_UPLOAD_BYTES, planUploadHeaders } from "./blobs.ts"
import {
  type HostMeasurements,
  type MeasuredOn,
  measurementsHeading,
} from "./machine/measurements.ts"
import type { PageSource } from "./page.ts"
import {
  blobResponse,
  type HttpAnswer,
  machineResponse,
  reviewResponse,
  uploaded,
  uploadRefusal,
} from "./responses.ts"
import { planPageRequest, planRequest, planUpgrade } from "./routes.ts"
import type { LaneWork } from "./work/index.ts"

interface RunningHttp {
  readonly port: number
  readonly httpUrl: string
  readonly wsUrl: string
  readonly invites: readonly string[]
  /**
   * Stop accepting, close Vite (where it serves the page) and every socket
   * and request still open, then wait for the HTTP server to close.
   */
  close(): Promise<void>
}

/**
 * An answer written. A body that comes as a stream is piped; one that fails
 * part way ends the connection, so a truncated file is never taken whole.
 */
const send = (res: ServerResponse, answer: HttpAnswer): void => {
  const { body } = answer
  res.writeHead(answer.status, answer.headers)
  if (typeof body === "string" || body instanceof Uint8Array) {
    res.end(body)
    return
  }
  void pipeline(Readable.from(body), res).catch(() => res.destroy())
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
  /** Your repo, whose proposed changes a review reads; null for a host without tools. */
  readonly destination: LaneWork["destination"]
  /** Where the page comes from: Vite, or the built page in `dist/`. */
  readonly page: PageSource
  /** The machine's measurements, and what they were measured on: their export's first line. */
  readonly measurements: {
    readonly store: Pick<HostMeasurements, "exportRows">
    /** Read at each export: the containment it names is the latest sample's. */
    readonly measuredOn: () => MeasuredOn
  }
  /** The Health page's reads: its facts, null where the host reads no machine; and its diagnostics' text. */
  readonly machine: {
    readonly facts: () => MachineFacts | null
    readonly diagnostics: () => Promise<string>
  }
  readonly log: (message: string) => void
}): Promise<RunningHttp> {
  const { port, bind, key, serverTransport, blobs, destination, page } = input

  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", ws => {
    const { start } = serverTransport.handleConnection({
      socket: wrapNodeWebsocket(ws),
    })
    start()
  })

  const httpServer = http.createServer()
  // Vite's HMR listener sits on this stand-in, which never binds, so an upgrade
  // reaches it only through the `"vite"` route below, admitted.
  const viteUpgrades = http.createServer()

  // Vite serves the page under `pnpm dev` (`page-build.ts`), on this one
  // server. A built page has no Vite.
  const vite = page.kind === "vite" ? await page.open(viteUpgrades) : null

  /** A file of the built page, or a 404 (`planPageRequest`). */
  async function serveBuilt(
    built: Extract<PageSource, { kind: "built" }>,
    req: IncomingMessage,
    res: ServerResponse,
  ) {
    const answer = planPageRequest(
      new URL(req.url ?? "/", "http://host").pathname,
      built.files,
    )
    if (answer.kind === "missing") {
      res.writeHead(404).end()
      return
    }
    const body = await readFile(path.join(built.dir, answer.file)).catch(
      () => null,
    )
    if (body === null) res.writeHead(404).end()
    else res.writeHead(200, answer.headers).end(body)
  }
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
      case "review":
        return void serveReviewRead(to.ask, res)
      case "measurements": {
        const { store, measuredOn } = input.measurements
        const lines = [
          measurementsHeading(measuredOn(), to.days),
          ...store.exportRows(to.days),
        ]
        send(res, machineResponse("measurements", `${lines.join("\n")}\n`))
        return
      }
      case "machine":
        send(
          res,
          machineResponse("facts", JSON.stringify(input.machine.facts())),
        )
        return
      case "machine-diagnostics":
        void input.machine.diagnostics().then(
          text => send(res, machineResponse("diagnostics", text)),
          () => res.writeHead(500).end(),
        )
        return
      case "bad":
        res.writeHead(400).end()
        return
      case "other":
        if (vite !== null) vite.middlewares(req, res)
        else if (page.kind === "built") void serveBuilt(page, req, res)
    }
  })

  /**
   * `GET /review/…`: a review or a diff of a commit open proposed changes hold,
   * or of an ask's range. A host without tools has nothing to review.
   */
  async function serveReviewRead(ask: ReviewAsk, res: ServerResponse) {
    const answer =
      destination === null
        ? ({
            kind: "refused",
            status: 404,
            reason: "nothing to review here",
          } as const)
        : await destination.proposed.read(ask)
    send(res, reviewResponse(answer))
  }

  function serveBlob(sha: Sha256 | null, res: ServerResponse): void {
    send(res, blobResponse(sha === null ? undefined : blobs.get(sha)))
  }

  /**
   * `POST /blob`: the declared length decides whether to read; the body is
   * read up to `MAX_UPLOAD_BYTES`; its bytes say what it is
   * (`classifyUpload`); the store keeps it, and an image's fitted copy.
   * Answers the blob's ref as it came, or a status with the reason as text.
   */
  async function receiveBlob(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const headers = planUploadHeaders({
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
    const upload = await classifyUpload(new Uint8Array(Buffer.concat(chunks)))
    try {
      send(res, uploaded(blobs.put(upload.blob, upload.fitted)))
    } catch (error) {
      // The store closes with the host: an upload can outlive it.
      send(res, uploadRefusal(503, errorText(error)))
    }
  }

  // ROUTE the upgrade: the Exchange's socket is `/ws`, and any other admitted
  // upgrade goes on to Vite's HMR listener, on `viteUpgrades`, where Vite
  // serves the page.
  httpServer.on("upgrade", (req, socket, head) => {
    switch (planUpgrade(requestFacts(req), key, vite !== null)) {
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
              `  or pick another port: PINETRIE_PORT=7392 pinetrie serve  (PINETRIE_PORT=0 = any free port)`,
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
      // reach. Accepting stops before Vite (where there is one) closes: a
      // page retries Vite's socket, and once Vite's listener is gone that
      // upgrade would be left open.
      const closed = new Promise<void>(resolve => {
        httpServer.close(() => resolve())
      })
      await vite?.close()
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
