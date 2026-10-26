# Tejeshwar Vijayakumar — particle portfolio

A single-canvas personal portfolio built for the **DoTA Vibe Coding Competition**
(theme: personal portfolio website). No page scroll, no framework, no build step —
the entire site is one `<canvas>` of ~12,000 particles that morph between formations,
each one demonstrating a real function of **[lowk.in](https://lowk.in)**.

## The idea

The particles form a dot-matrix silhouette of me. At the chest sits one bright node —
the lowk.in mark — the only accent colour on the page and the visual centre. Seven
buttons ring the silhouette, each joined to the node by a hairline. Pressing one morphs
the whole field into a new formation:

| Key | Function | What the field becomes |
|-----|----------|------------------------|
| `1` | Discover | a map of India with event pins lighting up |
| `2` | Ticket   | a ticket with a perforated stub you can tear off |
| `3` | Network  | a graph whose nodes link as the cursor passes — people meeting at events |
| `4` | Organise | a tournament bracket for organisers |
| `5` | About    | returns to the portrait |
| `6` | Open lowk.in | opens the live product |
| `7` | Contact  | email |

Two utility toggles: **invert** the palette and show **fewer dots**.

## About lowk.in

A nationwide platform for event discovery, ticketing and real-world networking —
built for tournaments, MUNs, college fests and grassroots gatherings. First paying
client: **Revolution Clash**.

## How it was built (AI-assisted development)

Built with **Claude Code** (Anthropic's agentic CLI) driving the implementation, using
Anthropic's **`frontend-design` skill** to lock the aesthetic direction before a line of
code — a quiet, engineered, instrument-like look where all boldness is spent in exactly
one place: the particle morphs. Claude Code wrote the canvas engine, the formation
geometry, the accessibility layer, and handled the git history, GitHub repo and Vercel
deployment end to end.

### Engineering notes
- **One canvas, 60fps.** All particle state lives in pre-allocated `Float32Array`s;
  the render loop makes zero per-frame allocations. Spring physics drive the morphs and
  cursor repulsion.
- **Silhouette by alpha-sampling.** The portrait is built by sampling pixels wherever
  `alpha > threshold` from `me.png` (a generic transparent head-and-shoulders silhouette
  placeholder — drop in a real cutout to personalise). If the image is ever missing, the
  same pipeline falls back to a procedural silhouette path, so it never breaks.
- **Accessible.** Real buttons with `aria-label`s, visible keyboard focus, keyboard
  shortcuts `1–7`, an `aria-live` caption, readable contrast, and full `<title>`/OG tags.
- **`prefers-reduced-motion`.** Static dots and instant formation swaps instead of morphs.
- **No framework, no build, no external requests** except one web font (Geist Mono).
- **Responsive.** On mobile the silhouette sits upper-middle and the buttons become a
  bottom dock; touch interaction and tearing work.

## Run locally

```bash
# any static server works, e.g.
python3 -m http.server 8080
# then open http://localhost:8080
```

## Team Details

**Solo: Tejeshwar Vijayakumar, 7tejeshwar@gmail.com**
