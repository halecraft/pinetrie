// web/setup-page — what the host read of its config, and what it loaded: the
// model or why there is none, who is signed in and who shapes a
// subscription's requests, each config file and what it refused, every
// setting, the commands and the context files. A page of its
// own, opened from the menu your avatar opens (`account-menu.tsx`). Every
// label is `setupView`'s (`@pinetrie/interface`).

import { type SetupView, setupPageWords as W } from "@pinetrie/interface"

export function SetupPage({ view }: { readonly view: SetupView | null }) {
  if (view === null) return <p className="setup-wait">{W.notYet}</p>
  return (
    <div className="setup-page">
      <section aria-label={W.model}>
        <h2>{W.model}</h2>
        <p className="setup-model" data-none={view.model.none}>
          {view.model.line}
        </p>
      </section>
      <section aria-label={W.signIn}>
        <h2>{W.signIn}</h2>
        {view.credentials.length === 0 ? (
          <p>{W.noCredential}</p>
        ) : (
          <ul>
            {view.credentials.map(c => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
        {view.subscription !== null && (
          <>
            <h3>{W.subscription}</h3>
            <p>{view.subscription.line}</p>
            {view.subscription.warning !== null && (
              <ul className="setup-refusals">
                <li>{view.subscription.warning}</li>
              </ul>
            )}
          </>
        )}
        <p className="setup-hint">{W.signInHint}</p>
      </section>
      <section aria-label={W.files}>
        <h2>{W.files}</h2>
        <dl className="setup-files">
          {view.files.map(f => (
            <div key={`${f.layer} ${f.file}`}>
              <dt>{f.layer}</dt>
              <dd>
                <code>{f.file}</code>
              </dd>
            </div>
          ))}
        </dl>
        {view.refusals.length > 0 && (
          <>
            <h3>{W.refusals}</h3>
            <ul className="setup-refusals">
              {view.refusals.map(r => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section aria-label={W.settings}>
        <h2>{W.settings}</h2>
        <dl className="setup-settings">
          {view.settings.map(s => (
            <div key={s.key} title={s.describe}>
              <dt>
                <code>{s.key}</code>
              </dt>
              <dd>
                <code>{s.value}</code> <span>{s.origin}</span>
              </dd>
            </div>
          ))}
        </dl>
      </section>
      <section aria-label={W.packages}>
        <h2>{W.packages}</h2>
        {view.refusedPackages.length > 0 && (
          <ul className="setup-refusals">
            {view.refusedPackages.map(p => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <ul className="setup-commands">
          {view.commands.map(c => (
            <li key={c}>
              <code>{c}</code>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label={W.contextFiles}>
        <h2>{W.contextFiles}</h2>
        {view.contextFiles.length === 0 ? (
          <p>{W.noContextFile}</p>
        ) : (
          <ul>
            {view.contextFiles.map(f => (
              <li key={f}>
                <code>{f}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
