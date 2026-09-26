// client/start — how a thread at the root begins (ADR-0021).
//
// Two ways, because at the root there is no context yet: a person declares a
// purpose. Start Chat opens a conversation; the agent answers only `@agent`.
// Start Agent opens a column whose messages ask the agent unless they name
// someone, so its first message creates the thread's lane. Either one only
// opens a column: nothing is written until the first send.

export function Start({ onStart }: { onStart: (asksAgent: boolean) => void }) {
  return (
    <div className="start">
      <button
        className="start-chat"
        onClick={() => onStart(false)}
        title="a conversation: the agent answers only when @agent is mentioned"
        type="button"
      >
        Start Chat
      </button>
      <button
        className="start-agent"
        onClick={() => onStart(true)}
        title="work with the agent: it answers every message that names no one"
        type="button"
      >
        Start Agent
      </button>
    </div>
  )
}
