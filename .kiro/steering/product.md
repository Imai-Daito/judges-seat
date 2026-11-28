---
inclusion: always
---

# Product invariants — 審査員席 (Judges Seat)

These are the non-negotiable product rules for the watch-party scoring app.
Any spec or implementation MUST NOT contradict them. When in doubt, ask the
user instead of silently changing a rule.

## How people play

- Friends gather in the same place and score from each individual phone.
- No login. Join via QR code / invite link with a nickname only.
- Each act is scored 0–100 in 1-point steps; ranking is by the **sum** of all
  judges' scores.
- When every judge has submitted, the host publishes and all scores are
  revealed at once, automatically, one judge after another — a single press
  on the reveal button, no per-judge tapping.
- Scores and final votes can be edited by their owner only **before**
  publication. After publication nothing changes — not even for the host.
- The judging panel is fixed when scoring starts; new joins are locked out
  afterwards. Reconnection of the same participant is via the same browser's
  HttpOnly cookie only (no nickname-based recovery).

## Scoring & reveal choreography

- Score input is an on-screen digit pad plus ± buttons; the field starts
  empty and submitting an empty value is blocked.
- Reveal: a large score card per judge is hurled from the front and lands in
  its fixed slot **with one vertical rotation**, front to back, one judge at
  a time (1600 ms per judge; 420 ms when reduced motion is requested). Then the
  grand total appears as a big bold number with a thin red frame and gold
  interior, followed by the rank. 90+ = gold, 80+ = silver, below = bronze.
- The reveal heading is an italic "JUDGE"; per-judge score is huge with the
  judge's name in italics below it. Totals are upright ultra-bold gothic,
  not italic.
- Skipping the reveal jumps straight to the settled results state.

## Final vote (最終決戦)

- Each judge votes for exactly one finalist.
- The finalists are the actual on-show finalists, chosen and fixed by the
  host (2 or more), independent of the first-round ranking.
- On publish, each judge's plaque (vertical name card) turns one by one to
  reveal the voted finalist's card. The first three candidates are red, blue,
  yellow; the same candidate always keeps the same color, including across a
  runoff. Unpublished votes are never rendered — not even on the card backs.
- Vote counts and the result are shown only after every plaque has turned.
- Tie handling: equal total scores share a rank (1st, 1st, 3rd). If the top
  final vote is tied, exactly **one** runoff is held among the tied acts; if
  the runoff ties again, co-champions. Never invent extra rounds.

## Results & sharing

- After watching: overall ranking, champion + vote breakdown (including any
  runoff), everyone's scorecards, and my own rank vs. the overall rank.
- Results can be saved as an image and shared via a read-only public link.
  The link is separate from the invitation and is explicitly enabled/disabled
  by the organizer. The token lives in the URL fragment (`#results=…`) and is
  never sent to the server in a request path or logged.
- Rooms and results are retained for **30 days** from creation, then expire.

## Look & feel (base layer)

- "Judges' seat" atmosphere on a phone screen: black background, vivid gold
  and red; no muddy brown/brass. Headings, scores and action labels are bold
  italic (forward-slanted) gothic; body text prioritizes readability. Never
  revert to a serif-dominant theme.
- Phone-first vertical layout; the TV projection is not the primary target.
- No cheesy copywriting — only screen names, action names and necessary rule
  explanations.

## Privacy invariants

- Never send another participant's unpublished score or vote to anyone,
  **including the organizer**. SSE payloads contain revision numbers only.
- Public result APIs are strictly allowlisted and no-store; they never expose
  participant fields or credentials.
