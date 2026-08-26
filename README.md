# YARD WALKER

First-person sandbox over the three yard generators. You spawn on foot in a
procedurally generated moonbase, walk its districts, board a mech in the
garage and drive it, board a starship on the pad and fly off across the Moon
to other bases. One world seed generates everything; every base, mech and
ship carries the same designation plates the yards print.

**Play:** `python3 -m http.server 8642` in this directory, then open
`http://localhost:8642/#<seed>` (any 32-bit seed; omit for a random one).
Needs network access once for the pinned Three.js CDN module.

## Controls

| Mode | Keys |
|---|---|
| Foot | WASD move · Shift run · Space jump (lunar g) · E board |
| Mech | W/S drive · A/D turn · mouse looks from the cockpit · E dismount |
| Ship | W/S throttle · mouse pitch/yaw · A/D roll · Space lift / vertical thruster · Shift descend · X brake · E exit when landed |
| Any | ` debug HUD (fps, tris, draw calls, streaming state) |

Above ~2 km gravity fades out, the stars come up full, and other bases show
as beacon pillars with nav callouts. Land near a base and it streams in with
its own mechs and ships, deterministically from `hash(worldSeed, site)` — a
base looks identical on every visit.

## How it's built

The yards stay pure drawing tools. `build.js` slices the generation code out
of `../starships`, `../moonbase` and `../mech-yard` **verbatim** (everything
in each file's `<script>` up to its UI boot line) and wraps each in a
namespaced IIFE; `src/game.js` + `src/template.html` supply the game. Output
is a single `index.html`.

The key porting move, exactly as GAME-PLAN.md predicted: all three yards
already tessellate their shared 7-solid part vocabulary into a triangle
`Float32Array` (`shipMesh`). The adapter is one function — that array into a
`BufferGeometry`, plus `EdgesGeometry(30°)` for the blueprint line-work.
Dark fill + emissive edges gives the hidden-line look for free. Scales:
moonbase and ships read as metres; mechs use the yard's own 0.155 m/unit.

Rebuild after editing `src/` or the yards:

```
node build.js
```

## v1 status vs the plan

- **M0 harness** ✓ walking, blueprint stack, debug HUD (`` ` ``)
- **M1 base** ✓ any seed walkable; collision from per-part AABBs + road/pad
  floor polys; graded flat apron blends into seeded noise-and-crater terrain
- **M2 mech** ✓ board/drive/dismount, first-person gait bob (the plan's
  sanctioned stride fake — no leg IK yet)
- **M3 ship** ✓ full foot→mech→foot→ship→space→land loop
- **M4 other bases** ✓ site scatter, beacons, nav markers, streamed
  generation, fresh vehicles per base (~150 draw calls / ~400k tris in frame)
- **M5/M6** (LOD tuning pass, audio, polish) — not started

Known v1 gaps: distant bases build as full meshes (no T1/T2 LOD tiers — the
staged builder hides most of it, but a mech build can hitch ~100 ms on
approach); ships don't collide with buildings in flight; vehicles you moved
persist for the session only; the mech turns as one piece (no torso/drive
split yet); no audio.
