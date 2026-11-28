# Tasks — spooky-ui （幽霊劇場UI)

- [ ] 1. Audit current theme: snapshot `judges-theme.css` tokens and the
      reduced-motion blocks; list every `js-*` class used by Reveal/Finale.
- [ ] 2. Add `artifacts/judges-seat/src/spooky.css` with atmosphere layers
      (grain via inline SVG turbulence, drifting fog, vignette) and import it
      in `App.tsx` after `judges-theme.css`.
- [ ] 3. Add candle-flicker + glow keyframes for `.js-mark`, `.js-total-num`,
      plaque fronts; gate all new animations behind `prefers-reduced-motion`.
- [ ] 4. Reveal stage: darken backdrop, spotlight cone, dust motes; flying
      card launch flash + landing bounce on `.js-slot-score`; keep
      `rotateX: 360` and 1600/420 ms steps untouched in `Reveal.tsx`.
- [ ] 5. Plaque board: aged front texture, heavier flip easing, shadow under
      turning plaques in `FinalVoteBoard.css`; keep 660/240 ms steps and
      stable candidate colors untouched.
- [ ] 6. Results/share: apply grain+vignette to `Results.tsx` and the share
      image export (`ShareResults.tsx`, `share-export.ts`).
- [ ] 7. Reduced-motion pass: verify 420 ms reveal steps, 240 ms plaque
      steps, no rotation/grain/fog; all results reachable; skip works.
- [ ] 8. Mobile pass: 360 px portrait, thumb-reachable buttons, readable
      contrast on gold/silver/bronze at every animation frame.
- [ ] 9. Privacy invariant check: render unpublished state and assert no
      score/vote values appear in DOM (extend judges-seat tests if selectors
      changed).
- [ ] 10. Run `pnpm run typecheck`, `pnpm run build`,
       `test:judging-sync`, `test:sharing`, `judges-seat test:synchronization`;
       all must pass unchanged in behavior.
- [ ] 11. Record Kiro usage notes for the write-up (which spec/steering/hook
       drove which step) in the submission draft.
- [ ] 12. Capture demo-video footage of: join via QR, scoring, stepped
       reveal, plaque flip, runoff, results + share image (≤ 3 min, no
       copyrighted music).
