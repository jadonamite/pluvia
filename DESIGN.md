# Interface foundations

Pluvia has two surfaces that share one set of foundations in `public/tokens.css`.

- **The front page (`/`)** is a scroll-driven story in one painted world: a field station beside
  a maize field in south-west Nigeria, one dry-season evening, a storm that arrives, breaks and
  passes. The images carry the colour; the interface stays quiet over them.
- **The claims desk (`/desk`)** is the working tool: inbox, daily rainfall evidence, the
  code-gated decision. The chart is the main visual. Motion there is feedback only.

Structure, input behaviour and accessibility follow the Apple Human Interface Guidelines web
translation. Visual identity comes from the painted world and palette A, not from the HIG.

## Type

IBM Plex Sans (variable, weight 100 to 700) for headlines and text, IBM Plex Mono (400, 500)
for figures, dates, IDs, amounts, labels and the loader readings. Both are self-hosted from
`public/fonts`; no font request leaves the site. No third family is used anywhere.

| Role | Size | Line height | Use |
|---|---|---|---|
| Display | clamp(3.5rem, 14vw, 12rem) | 0.85 | the front-page wordmark only |
| Hero | clamp(2.25rem, 5.2vw, 4.5rem) | 1.02 | front-page scene headlines |
| Large title | 2.25rem | 1.07 | |
| Title 1 | 2.125rem | 1.07 | |
| Title 2 | 1.75rem | 1.09 | desk decision, amounts |
| Title 3 | 1.1875rem | 1.13 | section headings |
| Body | 1rem | 1.16 for labels, 1.5 to 1.6 for reading | |
| Caption | 0.875rem | 1.18 | |
| Footnote | 0.75rem | 1.21 | 12px is the floor for anything a person must read |

Figures use tabular numerals. Hierarchy comes from weight and colour before size.

## Spacing

One 4px-based scale: 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 96, 128. No arbitrary values.
16px is the phone gutter; safe-area insets are added at the edges.

## Colour

Palette A: ink `#14120E`, paper `#F2EDE3`, sand `#B9AE8E`, terracotta `#C2573A`, sage `#8D9C7A`,
amber `#E3A33B`, rain blue `#5B8DB8`, grass green `#5E8C3A`.

Semantic roles, both themes, are defined once in `tokens.css`: label, secondary, background,
surface, card, separator, control border, action, accent, station, satellite, and one colour per
verdict. Measured contrast on the light background: label 16.0, secondary 6.5, accent 5.3,
verdicts 5.1 to 6.5; on the dark background: secondary 8.2, accent 6.6. Station amber bars on
light paper are 3.2, above the 3:1 rule for graphics. White on terracotta (4.45) and paper on
grass green (3.4) are used for large text only.

Verdicts always appear as words as well as colour: Pay (sage), Pay anyway (amber), Inspect
(terracotta), Do not pay (ink outline on sand).

## Targets, shape and depth

Every interactive element has a 44px hit region in both dimensions, with at least 8px between
neighbours. Radius steps: 4px labels, 8px controls, 12px panels, 16px cards, pill for the
floating navigation. Desk content has no elevation; the legal dialog and the front-page
navigation float.

The floating navigation is the one glass surface (backdrop blur over the images). It falls back
to a solid surface when blur is unsupported, under reduced transparency and under increased
contrast.

## Motion

Durations: 120ms for control feedback, 240ms for transitions, 320ms for larger reveals; ease out
on arrival, ease in on departure. On the front page, scroll position drives the scenes through
GSAP ScrollTrigger with Lenis smooth scrolling; every movement is made of the world's own
material (cloud, rain, light). Reduced motion turns off the loader, pinning, smooth scrolling
and particles: each scene renders as its final frame with its text. Without JavaScript the page
renders the same static sequence.

## Imagery

Painterly cinematic illustration for a mature Nigerian and African professional audience.
Scene images are generated, then upscaled, colour-graded toward the world key and exported as
AVIF and WebP in `public/images/scenes`. No icon grids; no text inside images.

## Data honesty

Policies, claims, farmer groups and amounts in the desk are synthetic and labelled so. Rainfall
records are real. Runtime mode is reported from the health endpoint. Decisions and amounts come
from the API, never from chart calculations. Feedback stores a memory assessment and never
changes a decision.

## Privacy

No analytics, no cookies, no third-party requests. Fonts, Chart.js, GSAP and Lenis are served
from the site itself. The desk keeps its appearance and notice preferences in session storage
for the current tab only.
