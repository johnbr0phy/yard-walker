# Yard Walker — Game Plan

First-person game combining the three yards. You spawn on foot in a procedurally
generated moonbase, walk its districts, climb into a mech in the garage and
drive it, climb into a starship on the pad and fly off the Moon to other bases.
Everything generated from a seed at load. One self-contained HTML file, hosted
on GitHub Pages like the yards.

## Why this is very buildable

A key finding from reading all three codebases: **the yards are already 3D
generators.** The 2D blueprint look is just the final render pass. Internally
each one:

- Builds a `parts` list of typed solids, and all three share the **identical
  7-solid vocabulary**: `box`, `capsule`, `disc`, `lathe`, `panel`, `sphere`, `tube`
- Tessellates those parts into a `Float32Array` of triangles (`shipMesh()` in
  all three, same code) before rasterizing to the hidden-line depth buffer
- Is fully seed-driven (`mulberry32`), with designations that are a bijection
  of the seed

So the game does NOT re-invent generation. It imports the three generators
nearly verbatim (`buildMech`, `buildShip`, the moonbase `builder` + `terrain` +
`services`) and swaps the 2D renderer for Three.js: **one mesh adapter** turns
any yard's part list into BufferGeometry. The slot contracts, proportion
guards, rigging passes, berm rules, road graph — all of it carries over free.

## Decisions (locked)

- **Art style: blueprint world.** Dark ground/sky, white-cyan line-work.
  Solid geometry rendered near-black with emissive edge lines on top (depth
  test keeps hidden-line correctness for free — the same effect the yards
  compute by hand). Cheap, distinctive, scales to long draw distances.
- **Space scope: fly to other bases.** The world is one seed; base sites are
  derived seeds scattered on the lunar surface. Land anywhere, every base has
  its own mechs and ships. Infinite loop.
- **Gameplay: pure sandbox v1.** Walk / drive / fly. The generators are the
  content. Objectives can come later.
- **Packaging: single index.html.** Three.js inlined or pinned CDN. New repo
  (suggested name: `yard-walker`), GitHub Pages.

## World and seeding model

- One 32-bit **world seed** in the URL hash (`#seed`), shareable like the yards.
- `baseSeed = hash(worldSeed, siteIndex)` — each base is deterministic and
  regenerable on approach, nothing is stored.
- Each base's garage district seeds its mechs (`hash(baseSeed, "mech", i)`),
  each pad seeds its parked ships. The base you spawn at always rolls at least
  one mech in the garage and one ship on the pad, fueled and ready.
- Designation plates carry over: the base name on the HUD when you arrive, the
  mech/ship plate when you board. All read off seeds, same as today.

## Scale (the one thing the yards never had to decide)

The yards are unitless drawings; a shared world forces real units. Proposal:

- 1 world unit = 1 m. Player eye height 1.7 m, walk 2.5 m/s, run 6 m/s
  (lunar-flavored jump, low gravity: g = 1.62 m/s²).
- Mech height ~12–16 m (scale the mech-yard output so standing height lands
  in that band). Garage/mech-bay doors must clear the tallest mech — add a
  clearance check when scaling.
- Ships ~20–60 m long, scaled to fit the pad apron inside the berm horseshoe.
- Base footprint ~600–1200 m across (masterplan extents mapped to meters).
  A walk from hab to pad should feel like the "long walk out" the moonbase
  README promises — about 2–4 minutes on foot, under a minute in the mech.

## The three control modes

One state machine: `FOOT → MECH → FOOT → SHIP → SPACE → LANDED → FOOT`.
Press `E` near a boarding point to enter, `E` to exit. Boarding points are
emitted by the generators (mech: cockpit hatch on the chest socket — it's
already in the slot contract; ship: cockpit socket; both get a glowing marker
and a short camera lerp instead of an animation for v1).

1. **Foot.** Pointer-lock FPS. Capsule collider vs. terrain heightfield +
   per-building collision proxies (each district exports its parts' OBBs —
   collide against boxes, not triangles). Low-gravity jump.
2. **Mech.** First-person from the head/cockpit, camera bobs with gait.
   Tank-style controls: WASD drive/turn, mouse turns torso above the girdle
   (the torso/drive split already exists in the generator). Walk cycle v1 is
   procedural leg IK-lite on the existing leg chain; if that fights us, v1.0
   ships with a hover/stride fake and honest sound. Crushing speed ~8–12 m/s.
3. **Ship.** Arcade 6DOF: throttle, pitch/yaw/roll on mouse+keys, vertical
   thrusters for landing. No atmosphere on the Moon, so no aero — thrust and
   gravity only, which is the easy flight model. Land anywhere flat; landing
   on a pad gets you a designation callout and marks the base visited.
4. **Space.** Above ~2 km altitude, gravity fades, star dome brightens, and
   distant base beacons render as marked points on the surface. Fly toward
   one, its terrain chunk + districts stream in on approach.

## Draw distance and performance (the explicit review item)

Budget target: **60 fps on an M-series MacBook Air**, WebGL2, ~1M triangles
and ~500k line segments max in frame. The blueprint style is the ace here:
edge lines + flat black fills are about the cheapest thing a GPU draws.

Concrete plan:

- **Merge aggressively.** One merged mesh + one merged LineSegments per
  district, one per mech, one per ship. Target well under ~200 draw calls in
  view. Never per-part meshes.
- **Edge extraction at generation time**, not per-frame: run
  `EdgesGeometry(threshold≈25°)` once per district/vehicle when it's built,
  cache by seed.
- **LOD tiers** (distances from camera, tuned in the harness below):
  - T0 `< 200 m`: full parts incl. rigging/conduit/greebles
  - T1 `200–800 m`: structural parts only — generators get a `detail` flag so
    rigging passes are skipped, mirroring the Greebling slider that already
    exists in mech-yard
  - T2 `800 m–2.5 km`: silhouette-only — hull solids, no edges thinner than
    the big masses; districts collapse to their 3–6 largest solids
  - T3 `> 2.5 km`: beacon point + name label. Note the real lunar horizon at
    eye height is ~2.4 km, so on foot T3 barely exists — curvature is our fog.
    From the air/space, T3 is everything, and it's just points.
- **Terrain chunking**: heightfield tiles ~256 m, ring of 5×5 around the
  camera on foot, coarser far rings when flying. Craters come from the same
  terrain function the moonbase yard uses, so the survey-model look survives.
- **Async generation**: base building runs in a worker (or time-sliced over
  frames) so approaching a new base never hitches; T3→T2 swap hides the
  pop-in behind distance.
- **Review harness (build this in M0, keep it forever)**: `~` opens a debug
  HUD — fps graph, tris/lines/draw-call counts, LOD tier boundaries as rings
  on the ground, and a scripted flythrough (foot → mech ride → takeoff →
  descent onto second base) that logs worst frame times. Every draw-distance
  decision gets reviewed against this, not against vibes.

## Milestones

- **M0 — Harness (small).** Three.js scene, pointer-lock walking on a flat
  seeded heightfield, blueprint material + edge-line stack proven on a test
  cube, debug HUD. *Accept: 60 fps, walking feels good.*
- **M1 — The base (big).** Port moonbase generator through the mesh adapter:
  terrain, districts, roads/cables, berms. Collision proxies. Walk the whole
  site. *Accept: any seed produces a walkable base at 60 fps.*
- **M2 — The mech.** Port mech-yard, spawn in garage, board, drive in first
  person, exit. *Accept: drive across the base and back, collide with
  buildings, 60 fps with base + mech at T0.*
- **M3 — The ship.** Port orbital-yard, spawn on pad, board, take off, reach
  space, land back on any flat ground. *Accept: full foot→mech→foot→ship→
  space→land loop on one base.*
- **M4 — Other bases.** Site scatter, beacons, streaming generation, landing
  at a fresh base with its own mechs/ships. *Accept: visit 3 bases in one
  session, no hitch > 50 ms.*
- **M5 — Draw-distance pass.** Tune LOD tiers against the harness flythrough
  on the actual MacBook Air; fix the top offenders. *Accept: worst frame
  < 16.6 ms on the scripted flythrough.*
- **M6 — Polish.** Designation HUD plates, boarding markers, audio (footsteps,
  servo whine, engine), seed sharing UI, title card.

Order matters: M1 before M2/M3 because the base sets the scale everything
else must fit.

## Risks and mitigations

- **Mech walk animation** is the hardest new code (yards never animated).
  Mitigation: fixed fake-stride fallback is acceptable for v1; leg IK is a
  post-v1 upgrade, and the articulation kit in the generator gives us joints.
- **File size**: three generators + Three.js in one HTML will be ~1 MB+.
  Fine for Pages; if it grows past taste, split to a small no-build multi-file
  repo later (decision already made to start single-file).
- **Scale mismatches** (mech won't fit its bay, ship overhangs the berm):
  add generation-time asserts that re-roll or re-scale offending variants —
  same philosophy as the yards' proportion guards.
- **Seed drift**: keep the yards' rule — game code must never consume
  generator randomness, so a base looks identical on every visit.

## Open items (assumptions until you say otherwise)

- New repo `yard-walker` rather than growing the moonbase repo — the yards
  stay pure drawing tools, the game imports them.
- Flat "big plane + curvature fade" world rather than a true sphere for v1;
  true spherical Moon is a v2 concern.
- Ship interiors are cockpit-view only for v1 (no walkable interiors).
