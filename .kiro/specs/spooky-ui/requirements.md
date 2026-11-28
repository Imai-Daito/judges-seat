# Requirements — spooky-ui （幽霊劇場UI / ghost-theater horror layer)

A presentation-only horror polish pass over the existing Judges Seat app for
the Kiroween Costume Contest ("an unforgettable, hand-polished horror UI").
The ghost-theater layer MAY change how screens look and move; it MUST NOT
change any behavior listed in `.kiro/steering/product.md`.

## Functional requirements

1. WHEN a score round is published, THE 幽霊劇場UI SHALL run the stepped
   reveal exactly as today: one judge at a time (1600 ms per judge, 420 ms
   under reduced motion), the flying score card performing one vertical
   rotation before landing in its slot, then the grand total card and rank.
2. WHEN the user presses skip during a reveal, THE 幽霊劇場UI SHALL jump to
   the settled state (all slots filled, total + rank visible) with no extra
   taps.
3. WHEN final votes are published, THE 幽霊劇場UI SHALL flip judge plaques one
   by one (660 ms per plaque, 240 ms under reduced motion) to the voted
   candidate's stable color (red/blue/yellow for the first three candidates),
   and SHALL show vote counts only after every plaque has turned.
4. THE 幽霊劇場UI SHALL NEVER render unpublished scores or votes anywhere,
   including plaque card backs, placeholders, debug overlays or share images.
5. WHEN the top final vote ties, THE 幽霊劇場UI SHALL support exactly one
   runoff and then co-champions; it MUST NOT add extra rounds or extra UI
   states for additional revotes.

## Horror-UI requirements

6. THE 幽霊劇場UI SHALL layer a ghost-theater atmosphere over every room
   screen: animated film grain, drifting fog, candle-style flicker on key
   light elements, and a vignette — all pure CSS/framer-motion, GPU-cheap.
7. THE 幽霊劇場UI SHALL keep the base palette: black background, vivid gold
   and red accents, bold italic gothic for headings/scores/labels. The horror
   layer adds atmosphere (grain, fog, flicker, deep shadows) but MUST NOT
   shift the palette to muddy brown/brass or serif type.
8. WHEN `prefers-reduced-motion: reduce` is set, THE 幽霊劇場UI SHALL disable
   grain/fog/flicker animation and the card rotation, and SHALL fall back to
   the existing reduced-motion timings (420 ms reveal steps, 240 ms plaque
   steps, no transform animations). All results must still be reachable.
9. THE 幽霊劇場UI SHALL be mobile-first: fully usable at 360 px width in
   portrait, thumb-reachable primary actions.
10. THE 幽霊劇場UI SHALL add no network calls, no new dependencies that break
    the pnpm catalog, and no changes to the OpenAPI spec, DB schema, judging
    logic, rate limits or SSE protocol.

## Non-functional requirements

11. ALL existing tests (`pnpm run typecheck`, `pnpm run build`, and every
    `test:*` suite listed in `.kiro/steering/tech.md`) MUST pass unchanged
    after the spooky-ui pass.
12. THE 幽霊劇場UI SHALL keep the reveal legible: scores and names remain
    readable at every animation frame (contrast on gold/silver/bronze cards).
13. Demo video and SNS assets produced for this spec MUST NOT include
    third-party copyrighted music or trademarks.
