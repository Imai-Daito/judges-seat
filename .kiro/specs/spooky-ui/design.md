# Design — spooky-ui （幽霊劇場UI)

## Goals

Turn the existing gold-on-black "judges' seat" into a ghost theater: the
room feels like a dark stage where score cards are hurled out of the dark and
plaques turn by themselves. Presentation-only — zero behavior change.

## Current state (what exists today)

- `artifacts/judges-seat/src/App.tsx` — room shell, `js-grain` overlay div,
  auto-triggers `Reveal` when a round was published within
  `members*1600+2000 ms` of server time.
- `artifacts/judges-seat/src/Reveal.tsx` — stepped reveal engine: 40 ms clock,
  `stepMs = 1600` (420 reduced), flying card (`js-flying-card`) with
  `rotateX: 360`, slot targets (`js-score-slots`), metals gold/silver/bronze,
  grand total (`js-total-card`) + rank. Skip button.
- `artifacts/judges-seat/src/FinalVoteBoard.tsx` + `.css` — plaque flip board:
  660 ms steps (240 reduced), stable per-candidate colors
  (`#d72e35`/`#326cbd`/`#d9a928`, extras), counts only after all turned,
  auto-start on publish, skip.
- `artifacts/judges-seat/src/judges-theme.css` — theme tokens, `js-*` classes,
  `@media (prefers-reduced-motion: reduce)` block (~line 424).
- `artifacts/judges-seat/src/production.css` — global reduced-motion kill
  switch. `judges-overrides.css` — small overrides.
- Motion: framer-motion (`motion.div`, `useReducedMotion`);
  `FinalVoteBoard` additionally checks `matchMedia` directly.

## Proposed changes (all inside `artifacts/judges-seat/`)

1. **Atmosphere layers** (new, additive):
   - `src/spooky.css` imported after `judges-theme.css`.
   - Film grain: fixed full-screen pseudo-element using an inline SVG
     `feTurbulence` data-URI, animated via CSS steps; opacity ~0.06.
   - Fog: two large radial-gradient layers drifting on slow keyframes
     (translate only, `transform` animations disabled under reduced motion).
   - Vignette: radial dark edges on `.js-app`.
   - Candle flicker: subtle opacity/scale keyframes on `.js-mark`,
     `.js-total-num`, plaque fronts — flicker only when motion is allowed.
2. **Reveal stage** (`Reveal.tsx` + CSS):
   - Darken stage backdrop, add spotlight cone behind the mast, dust motes
     (few absolutely-positioned dots with float animation).
   - Flying card: keep `rotateX: 360`; add a brief shadow/glow trail via
     `box-shadow` keyframe and a dark "whoosh" backdrop flash on launch.
   - Landing: tiny scale bounce on slot fill (CSS animation on
     `.js-slot-score` when its value appears).
   - Total card: red thin frame + gold interior (unchanged semantics), add
     flicker-in appearance.
3. **Plaque board** (`FinalVoteBoard.css`):
   - Plaque fronts get aged-paper texture (CSS gradients only), back face
     keeps candidate color; flip easing slightly more "heavy"
     (`cubic-bezier(.3,.7,.4,1)`), plus a soft shadow under turning plaques.
   - Unpublished votes still never rendered (invariant #4).
4. **Typography/palette**: keep existing tokens; horror layer only deepens
   blacks (`#050505`-ish backgrounds), strengthens gold glow
   (`text-shadow`), and keeps italic gothic for JUDGE/labels.
5. **Reduced motion**: extend the existing media queries in
   `spooky.css`/`judges-theme.css`: kill grain/fog/flicker/bounce/rotation;
   keep stepped timing already implemented. No JS changes needed beyond
   reusing `useReducedMotion()`/`matchMedia` checks that exist.
6. **Results & share image** (`Results.tsx`, `ShareResults.tsx`,
   `share-export.ts`): apply the same grain/vignette to the exported image so
   shared results look like a still from the show.

## Invariants (must not change)

- Reveal timings, order, skip behavior; plaque step timings, colors, counts
  gating; single-runoff rule; privacy rules (no unpublished data anywhere);
  API/DB/SSE contracts; rate limits; all existing tests pass unchanged.

## Files to touch

- NEW `artifacts/judges-seat/src/spooky.css`
- `artifacts/judges-seat/src/App.tsx` (import spooky.css; maybe mount fog layers)
- `artifacts/judges-seat/src/Reveal.tsx` (class hooks only; no logic change)
- `artifacts/judges-seat/src/FinalVoteBoard.css` (plaque styling)
- `artifacts/judges-seat/src/judges-theme.css` (token additions, reduced-motion block)
- `artifacts/judges-seat/src/Results.tsx`, `ShareResults.tsx` (export styling hooks)
- Tests: extend `artifacts/judges-seat/tests/synchronization.test.mjs`-style
  checks only if selectors change; add a render check that unpublished votes
  never appear in DOM.

## Verification

- `pnpm run typecheck && pnpm run build`
- `pnpm --filter @workspace/scripts run test:judging-sync`
- `pnpm --filter @workspace/judges-seat test:synchronization`
- Manual: run web preview on a phone-sized viewport, publish a round with 3+
  judges, confirm stepped reveal + skip; publish final vote, confirm plaque
  sequence; toggle OS reduced-motion and re-run both; export share image.
