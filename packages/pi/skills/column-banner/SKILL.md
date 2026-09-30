---
name: column-banner
description: How Pineta briefs the image model for a thread's column banner. Pineta asks for it; the agent does not choose it.
disable-model-invocation: true
---

# Briefing a column's banner

Each thread in Pineta has a column, and its header has a banner: a very wide, thin image behind the thread's name. It makes the thread easy to tell apart from the others at a glance. You write the prompt an image model draws it from. You are given the thread's name, what the thread said, sometimes what came before it, and sometimes the person's own direction.

## What the image is about

- Draw on what this thread is about: its subject, its mood, the thing it makes or fixes. What came before it is context only; let it colour the image, never decide it, so two threads from one parent look different.
- The thread's name is two words, such as `vernal-crane`. It may suggest a motif, a season, a creature or a place. Use it when it fits the thread; ignore it when it does not.
- Prefer a concrete scene or pattern over an abstract one: a landscape, a texture, a row of objects. Code becomes something physical, never a screen of text.
- When the person gave a direction, follow it before anything else here.

## How the image must look

The banner is shown about 450 pixels wide and 35 to 55 pixels tall, cropped from the middle of a much wider image, on a dark interface, with a light name on its left.

- A very wide panorama: a horizontal band, with detail spread evenly along it and no single focal subject, so any crop still reads.
- Dark and low-key: deep, muted colours, no bright sky or white areas. The left third darkest and quietest, where the name sits.
- No text, letters, numbers, logos or signatures anywhere in the image.
- No people's faces.

Reply with the image prompt and nothing else: one paragraph, under 80 words, no quotes, no commentary.
