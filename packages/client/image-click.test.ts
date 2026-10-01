import { expect, test } from "vitest"
import { imageClick } from "./image-click.ts"

test("a plain click shows the image over the page", () => {
  expect(imageClick({ metaKey: false, ctrlKey: false })).toBe("view")
})

test("a Cmd- or Ctrl-click opens the image in a new tab", () => {
  expect(imageClick({ metaKey: true, ctrlKey: false })).toBe("tab")
  expect(imageClick({ metaKey: false, ctrlKey: true })).toBe("tab")
})
