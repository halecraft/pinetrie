// web/text-box — whether focus is in a text box. There, the undo keys
// (`keyAct`), the board's `/` (`boardKeyAct`) and a card grid's keys but
// Escape (`gridKeyAct`) are the box's own.

/** Whether `el` is a text box: a `<textarea>` or any `<input>`, a checkbox included. */
export const isTextBox = (el: Element | null): boolean =>
  el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
