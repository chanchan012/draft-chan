# Draft visual system

The Firecrawl design capture on 2026-11-19 included page text, branding, a full-page desktop screenshot and an image inventory. The screenshot shows a compact navigation bar, a split headline and drawing sheet, four toolkit cards and a ruled footer. The source uses Next.js, Tailwind and custom CSS. [Reference landing page](https://draft-chan.vercel.app/)

![Desktop landing page captured for the dashboard design](docs/design-reference.jpg)

The extracted palette uses paper #FAF9F6, ink #252720, terracotta #C24C29, and muted green #748866. Inter sets headings and body copy. app/globals.css supplies IBM Plex Mono for drawing labels and Georgia italic for editorial emphasis. Existing primary buttons have a 5px radius, white text and a terracotta fill. Subtle one-pixel borders divide the page.

The dashboard adaptation keeps the same margins, header, type families, card borders and primary controls. A grid-lined sheet shows each plan's generated geometry. The reference model is reserved for the illustrative Courtyard House sample. The library scrolls internally within a 100dvh shell and reflows to one column on phones. [Model asset](https://draft-chan.vercel.app/isometric.webp)
