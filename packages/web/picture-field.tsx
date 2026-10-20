// web/picture-field — your picture on your profile page: your circle, large,
// with "upload a picture" and, when you have one, "remove". An image chosen,
// dropped or pasted on the field is cropped first (`picture-crop.tsx`); nothing
// is uploaded before "use this picture".

import type { Sha256, WriterId } from "@pinetrie/core"
import {
  imageFiles,
  pictureProblem,
  pictureWords,
  uploadBlob,
} from "@pinetrie/interface"
import type { Outcome } from "@pinetrie/protocol/codec"
import { useContext, useRef, useState } from "react"
import { Button } from "./button.tsx"
import { pastedImages } from "./clipboard.ts"
import { fileDropProps } from "./file-drop.ts"
import { PictureCrop } from "./picture-crop.tsx"
import { Pictures } from "./pictures-context.ts"
import { Initial } from "./presence.tsx"

export function PictureField({
  writer,
  nameOf,
  colorOf,
  setPicture,
}: {
  readonly writer: WriterId
  readonly nameOf: ReadonlyMap<WriterId, string>
  readonly colorOf: (writer: WriterId) => string
  /** Ask the host to set your picture to a stored blob, or with null remove it. */
  readonly setPicture: (sha256: Sha256 | null) => Promise<Outcome>
}) {
  const has = useContext(Pictures).has(writer)
  const file = useRef<HTMLInputElement>(null)
  const [chosen, setChosen] = useState<ImageBitmap | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const choose = async (picked: Blob | undefined) => {
    if (picked === undefined || busy) return
    setProblem(null)
    // The browser decodes it: what it cannot read cannot be cropped either.
    const image = await createImageBitmap(picked).catch(() => null)
    if (image === null) setProblem(pictureWords.unreadable)
    else setChosen(image)
  }
  const send = async (sha256: Sha256 | null) => {
    const said = pictureProblem(await setPicture(sha256))
    setProblem(said)
    return said === null
  }

  return (
    <div
      className="picture-field"
      {...fileDropProps(files => {
        const [picked] = imageFiles({ files })
        void choose(picked)
      })}
      onPaste={e => {
        const [picked] = pastedImages(e)
        if (picked === undefined) return
        e.preventDefault()
        void choose(picked)
      }}
    >
      {chosen === null ? (
        <div className="picture-current">
          <Initial
            className="me picture-large"
            colorOf={colorOf}
            nameOf={nameOf}
            writer={writer}
          />
          <div className="picture-actions">
            <Button
              look="outline"
              className="picture-upload"
              onClick={() => file.current?.click()}
            >
              {has ? pictureWords.replace : pictureWords.upload}
            </Button>
            {has && (
              <Button
                look="outline"
                className="picture-remove"
                onClick={() => void send(null)}
              >
                {pictureWords.remove}
              </Button>
            )}
          </div>
          <input
            accept="image/*"
            className="picture-file"
            hidden
            onChange={e => {
              void choose(e.target.files?.[0])
              // The same file chosen again is a change too.
              e.target.value = ""
            }}
            ref={file}
            type="file"
          />
        </div>
      ) : (
        <PictureCrop
          busy={busy}
          image={chosen}
          onCancel={() => setChosen(null)}
          onUse={async picture => {
            setBusy(true)
            const upload = await uploadBlob(picture)
            if (!upload.ok) setProblem(upload.reason)
            const took = upload.ok && (await send(upload.ref.sha256))
            setBusy(false)
            if (took) setChosen(null)
          }}
        />
      )}
      {problem !== null && (
        <p className="picture-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  )
}
