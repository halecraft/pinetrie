// client/app — browser entry. Bundled to client/app.bundle.js by esbuild.
import { connectSession } from "./session-view.mjs"

const $ = (id) => document.getElementById(id)
const wsUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`

function render(view) {
  $("lane").textContent = view.laneName ?? "(none)"
  $("count").textContent = String(view.entryCount)

  const rows = view.transcript.map(
    (m) => `<div class="msg ${m.role}"><span class="role">${m.role}</span><div class="text"></div></div>`,
  )
  $("transcript").innerHTML = rows.join("")
  // Set text via textContent so model output is never interpreted as HTML.
  view.transcript.forEach((m, i) => {
    $("transcript").children[i].querySelector(".text").textContent = m.text
  })

  if (view.streaming) {
    $("streaming").hidden = false
    $("streamText").textContent = view.streaming.text
  } else {
    $("streaming").hidden = true
  }
}

const session = await connectSession({ url: wsUrl, WebSocket, onChange: render })
$("status").textContent = "connected"
render(session.view())

$("form").addEventListener("submit", async (event) => {
  event.preventDefault()
  const text = $("input").value.trim()
  if (text === "") return
  $("input").value = ""
  $("status").textContent = "running…"
  const reply = await session.prompt(text)
  $("status").textContent = reply.accepted ? "connected" : `rejected: ${reply.errorCode} — ${reply.errorMessage}`
})
