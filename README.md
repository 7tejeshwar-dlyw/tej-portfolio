# Tejeshwar Vijayakumar — particle portrait portfolio

A single-canvas personal portfolio built for the **DoTA Vibe Coding Competition**
(theme: personal portfolio website). No page scroll, no framework, no build step —
the entire site is one `<canvas>` of ~16,000 particles that render a **tonal portrait**
and morph between formations, each one demonstrating a real function of
**[lowk.in](https://lowk.in)**.

## The idea

The particles assemble into a portrait. At the base of the bust sits one bright node —
the lowk.in mark — the only accent colour on the page and the visual centre. A numbered
index rings the portrait, each entry joined to the node by a hairline. Pressing one morphs
the whole field into a new formation (keys `1–7` work too):

| Key | Function | What the field becomes |
|-----|----------|------------------------|
| `1` | Discover | a map of India with event pins lighting up |
| `2` | Ticket   | a ticket with a perforated stub you can tear off |
| `3` | Network  | a graph whose nodes link as the cursor passes — people meeting at events |
| `4` | Organise | a tournament bracket for organisers |
| `5` | About    | returns to the portrait |
| `6` | Open lowk.in | opens the live product |
| `7` | Contact  | email |

Two utility toggles: **invert** the palette (dark ⇄ light) and show **fewer dots**.

## About lowk.in

A nationwide platform for event discovery, ticketing and real-world networking —
built for tournaments, MUNs, college fests and grassroots gatherings. The sample
reveals throughout the site use a real lowk event — **Nocturne** (Chennai).

## How it was built (AI-assisted development)

Built with **Claude Code** (Anthropic's agentic CLI) driving the implementation, using
Anthropic's **`frontend-design` skill** to set the art direction before a line of code:
a quiet, engineered, editorial look where all boldness is spent on the portrait and its
morphs. Claude Code wrote the canvas engine, the image-sampling pipeline, the layout and
motion system, and handled the git history, GitHub repo and Vercel deployment end to end.

### Engineering notes
- **Tonal particle portrait.** The portrait image is background-removed and alpha-sampled
  into two populations: **edge** particles (near a transparency boundary → the bright,
  dense outline) and **interior** particles placed with probability proportional to local
  darkness, so hair and features carry more particles than skin. Points are shuffled so
  subsampling stays spatially uniform, and placement is bounding-box + aspect-correct so
  the face never stretches. Swap the image at `me.png` to use any portrait.
- **60fps.** All particle state lives in pre-allocated `Float32Array`s; the render loop
  makes no per-frame allocations in the particle passes. Spring physics drive the morphs,
  cursor repulsion, and a gentle idle shimmer. Three tonal shades + size variation give
  the figure depth; the lowk node has a soft pulsing glow.
- **Design.** Instrument Serif (display) paired with Geist Mono (interface); seven
  function nodes scattered around the portrait, each tethered to the lowk node by a
  hairline — a live constellation that re-anchors for every formation. An ambient drifting
  field and a light HUD frame fill the negative space; film grain + a subtle vignette add
  atmosphere; a staggered entrance reveal. A single accent colour throughout.
- **Product, not just dots.** The Ticket formation resolves into a real lowk sample ticket
  (Nocturne) — hover to tilt it in 3D, tear the stub to book; the particle field
  tears in sync. The lowk node at the portrait's core is labelled and clickable → lowk.in.
- **Accessible.** Real buttons/links with `aria-label`s, visible keyboard focus, keyboard
  shortcuts `1–7`, an `aria-live` caption, readable contrast, and full `<title>`/OG tags.
- **`prefers-reduced-motion`.** Static dots, instant formation swaps, no entrance animation.
- **No framework, no build, no external requests** except one Google Fonts request
  (Instrument Serif + Geist Mono).
- **Responsive.** On mobile the portrait sits upper-middle and the index becomes a bottom
  dock; touch interaction and the ticket tear both work.

> The portrait is sampled from a real photo of Tejeshwar (cut out with `rembg`, then
> rendered as a luminous "emerge-from-shadow" tonal field). Swap `me.png` to use any portrait.

## Run locally

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```

## Team Details

**Solo: Tejeshwar Vijayakumar, 7tejeshwar@gmail.com**
