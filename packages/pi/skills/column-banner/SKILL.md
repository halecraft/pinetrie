---
name: column-banner
description: How Pineta briefs the image model for a thread's column banner. Pineta asks for it; the agent does not choose it.
disable-model-invocation: true
---

# Briefing a column's banner

Each thread in Pineta has a column, and its header has a banner: a very wide, thin image behind the thread's name. It makes the thread easy to tell apart from the others at a glance. You write the prompt an image model draws it from. You are given the thread's name, what the thread said, sometimes what came before it, and sometimes the person's own direction.

Every banner is 16-bit pixel art of one memorable sprite. What the sprite is, and its colours, change from thread to thread.

## What it shows

- One hero sprite, and at most one companion: a creature or object that stands for what this thread is about, the thing it makes, fixes or studies. Code becomes an object, such as a key, a gear or a lantern, never a screen or text.
- The thread's name is two words, such as `vernal-crane`. When it fits the thread, it names the hero: a crane, perhaps with spring blossom as its companion. When it does not, the thread's subject wins.
- What came before the thread is context only: let it colour the image, never decide it, so two threads from one parent look different.
- When the person gave a direction, follow it before anything else here.

## How it must look

The image is about 2900 by 350 pixels, shown 448 pixels wide and 34 to 55 tall, on a dark interface, with a light name on its left. Its whole width always shows, but a short header shows only from about a tenth of the way down to nearly three quarters.

- 16-bit console pixel art: big, chunky visible pixels, as if drawn 60 pixels tall and enlarged. Hard edges, a dark outline, no anti-aliasing, gradients, blur or soft lighting.
- The hero stands in the right half, in side view, with a bold silhouette that reads at a glance: its top a fifth of the way down the image, its feet about two thirds of the way down, and nothing of it above or below. The companion stands beside it, smaller.
- Everything else is a flat, very dark background: at most a thin line of ground tiles or a few pixel stars. The left third stays empty for the name.
- A limited palette that suits the thread's mood, with the hero bright and saturated against the dark.
- An original sprite, not a character from any existing game. No people, and no text, letters, numbers, score, HUD or logos.

Reply with the image prompt and nothing else: one paragraph, under 80 words, no quotes, no commentary.
