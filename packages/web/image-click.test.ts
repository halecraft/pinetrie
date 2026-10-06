import { expect, test } from "vitest"
import { imageClick } from "./image-click.ts"

test("a plain click opens the image in the pane", () => {
  expect(imageClick({ metaKey: false, ctrlKey: false })).toBe("pane")
})

test("a Cmd- or Ctrl-click opens the image in a new tab", () => {
  expect(imageClick({ metaKey: true, ctrlKey: false })).toBe("tab")
  expect(imageClick({ metaKey: false, ctrlKey: true })).toBe("tab")
})
