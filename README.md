# Slingo

Retro plunger pinball, playable on mobile and desktop as an installable PWA.
Nine hand-built machines line the floor, from a $1 diner table to a $100
Vegas cabinet. Pick one, pull the spring plunger, release, and the ball shoots
up the launch lane, around the top curve and into the field, where it bounces,
rolls and drops through bumpers, kickers, magnets, gates and spinners until an
exit swallows it — racking up its prize along the way.

## Play it

Any static file server works (no bundler, zero dependencies):

```sh
python3 -m http.server 8080
# or: npx serve .
```

Open `http://localhost:8080`. On a phone, "Add to Home Screen" installs it as a
standalone app (works offline after first load). `./build.sh` produces a clean
`dist/` folder with only the runtime files, for uploading elsewhere.

## The floor

The game opens in the **lobby**: an overlay on the live machine, which runs
in attract mode underneath (free demo balls roll the table so you can watch
the layout in action before you bet). The lobby shows the machine's name,
stars, risk profile, ball range and buy-in; **‹ ›** arrows (or the keyboard
arrows) step through the nine machines, **☰ ALL MACHINES** opens a horizontal
strip of playfield thumbnails, and **tapping anywhere lifts the overlay** and
puts the machine in play. In play, the ☰ button in the bottom bar brings the
strip back once the field is empty. A machine's buy-in is twenty of its
minimum ball; the lobby says so if your balance doesn't cover it.

The UI is deliberately clean and modern — glass pills, one accent colour —
while the machines themselves are the vintage part: wood rails, chrome and
rubber, printed plates and ribbons, sunburst backglasses, halftone motifs.

| # | Machine | ★ | Profile | Balls | Buy-in | Signature features |
| - | --- | - | --- | --- | --- | --- |
| 1 | **ROOKIE ROAD** — 50s diner | 1 | SAFE | $1–$5 | $20 | ROUTE 66 twin lanes down the left curve, JUKEBOX pin field, BLUE PLATE reactor, DRIVE-THRU kickout |
| 2 | **SURF'S UP** — endless summer | 2 | MARATHON | $1–$10 | $20 | BIG WAVE wireform ramp, THE BARREL spinner maze, RIP TIDE kickout, THE REEF, UNDERTOW magnet |
| 3 | **ROADHOUSE** — rock & roll | 2 | MODERATE | $1–$10 | $20 | AMP STACK bumper triangle, VOLUME drop targets, MOSH PIT spinners, FEEDBACK danger zone, ENCORE reactor |
| 4 | **CIRCUIT BREAKER** — high voltage | 3 | BONUS | $5–$25 | $100 | THE JOLT: a one-way gate into a U-turn with a kicker at the bottom, TESLA magnet pair, FUSES targets, SURGE danger zone |
| 5 | **GRAND PRIX** — full throttle | 3 | MODERATE | $5–$25 | $100 | PIT LANES down both sides, a three-rail CHICANE, PACE CAR moving bumper, TUNNEL warp, PODIUM reactor |
| 6 | **DEEP SPACE** — beyond the stars | 3 | VOLATILE | $10–$25 | $200 | BLACK HOLE intersection (four spokes into a hole), WORMHOLE warp pair, GRAVITY WELL magnets, SATELLITE mover |
| 7 | **CASTLE SIEGE** — storm the keep | 4 | VOLATILE | $10–$100 | $200 | PORTCULLIS targets, THE MOAT (a band of − pins), DRAWBRIDGE one-way, ARROW SLIT − rails, TRAP DOOR danger zone above the outhole |
| 8 | **INFERNO PEAK** — into the volcano | 5 | EXTREME | $25–$100 | $500 | LAVA FLOW spinner maze, MAGMA (three − bumpers) danger zone, CALDERA hole, ERUPTION kickout that fires straight up |
| 9 | **VEGAS ROYALE** — lucky sevens | 5 | LUCKY 7 | $25–$100 | $500 | JACKPOT reactor under a sunburst, 777 bumpers, BAR BAR BAR targets, ROULETTE intersection, DEALER mover |

Layouts follow "ordered chaos": components come in pockets — a field of pins, a
spinner maze, twin lanes down a curve, a one-way gate into a U-turn kicker, an
intersection with a hole in the middle — arranged so lanes, pathways and
intersections run between them. The pockets are built by `js/layout.js` and
composed per machine in `js/machines.js`.

## Controls

- **Mobile**: touch anywhere in the plunger strip below the cabinet, drag down
  to compress the spring, release to launch. The device buzzes at full pull.
- **Desktop**: identical, with click-and-drag.
- A segmented charge ladder inside the launch lane lights from the plunger up,
  with a notch at the 25% mark, and an amber `CHARGE` readout below the
  cabinet. Launch speed is a pure function of the charge, so **any charge of
  25% or more always reaches the field** and anything below it always drops
  back into the slot.
- **The bet is only placed when the ball reaches the field.** A weak charge
  costs nothing: the ball re-seats and can simply be launched again.
- **Ball type** (bottom button) cycles the bet within the machine's range:
  Bronze $1, Silver $5, Gold $10, Platinum $25, Diamond $100.
- Launch as fast as you can pull; multiple balls play out at once, each with
  its own floating running total. Balls bounce off each other too.
- **☰** (bottom bar) opens the machine strip once the field is empty. A machine
  never changes under you — no random layouts, no auto-switching.

## Components

| Component | Indicator | What it does |
| --- | --- | --- |
| **Reactor** (each machine's big-name cap) | `+++` | Big pop bumper with a marquee bulb ring; 50% of the bet per hit. |
| **Bonus discs** | `+++` | Extra big-pop caps. |
| **Pop bumpers** | `++` / `−−` | Classic caps printed with the machine's motif; kick the ball away. |
| **Moving bumper** | `++` / `−−` | A pop bumper sliding back and forth on a chrome rail. |
| **Magnets** | `++` / `−−` | Bend nearby ball paths toward them; score on contact. |
| **Slingshots / kicker triangles** | `−` (the pair above the flippers) / `++` | Rubber-banded plastics that kick off every edge. |
| **Signed rails** | `++` / `−−` | Rubber bands between posts. |
| **Kicker pins** | `+` / `−` | Posts with green/red rubber rings. |
| **Drop-target bank** | `+ · BANK +++` | Three targets that fold down when hit; clearing all three pays `+++` and the bank resets. |
| **Gates** | `+` | Chrome-guided channels that score, then **boost**, **brake** or **warp** to their twin. |
| **One-way gates** | `+` | A wire flap: balls pass one way (scoring) and can't come back. |
| **Spinners** | `+` | A plate on an axle; a passing ball spins it, each revolution scores, up to five. |
| **Kickout scoop** | `++` | Swallows the ball, scores, then ejects it from a nozzle elsewhere. |
| **U-turn kicker** | `+` | The ball drops down the entry arm, swings round the U and a kicker fires it back up the exit arm. |
| **Intersection** | `?` | Four spokes with a hole in the middle; the upper paths lead in, the lower ones out. |
| **Holes / baskets** | `?` | Swallow the ball and settle the bet. |
| **Danger zones** | hazard stripes | A − bumper flanked by − pins. |
| **Auto-flippers** | pips under the ball | React automatically when a ball drops onto them, 1–3 charges per ball by profile; once spent, the ball drains. |
| **OUTHOLE** | `?` | The well between the flippers; settles the bet. |

The number of glyphs is the **tier**, a fixed fraction of the bet: `+` 10%,
`++` 20%, `+++` 50% (a cleared bank 50%); `−` 5%, `−−` 10%, `−−−` 20%.

## Risk profiles

| Profile | Machines | ≥ ×1 | Max | Physics |
| --- | --- | --- | --- | --- |
| **SAFE** | Rookie Road | 88% | ×5 | gentle gravity |
| **MARATHON** | Surf's Up | 77% | ×5 | low gravity, 3 flipper charges |
| **MODERATE** | Roadhouse, Grand Prix | 62% | ×25 | standard |
| **BONUS** | Circuit Breaker | 56% | ×20 | 2 flipper charges |
| **VOLATILE** | Deep Space, Castle Siege | 41% | ×100 | heavier |
| **EXTREME** | Inferno Peak | 16% | ×500 | heaviest |
| **LUCKY 7** | Vegas Royale | 30% | ×777 | heavy; ×7, ×77, ×777 pay |

Every table has EV = 96% of stake and a ×0.2 consolation floor instead of
zero; the stars only describe variance.

## How the outcome works

Every ball is an isolated bet at the ball's bet value, decided the moment it is
created: a multiplier is drawn from the machine's prize table, fixing the
ball's **prize**. Nothing the player does afterwards can change it — and the
table is built so that what you watch is honest and the ending never takes
anything away:

- **Component values are fixed.** `+` is 10% of the bet, `++` 20%, `+++` 50%,
  a cleared drop-target bank 50%; `−` takes 5%, `−−` 10%, `−−−` 20%. What a
  component says is what it pays, on every hit, for every ball.
- **The physics is deterministic.** Everything random inside the engine comes
  from the ball's own seeded generator, time is a fixed-step clock, and the
  same engine runs headless in a worker. A ball launched with the same power
  and seed follows exactly the same path.
- **The launch is planned.** While you look at a machine, the planner
  simulates 64 launch powers × 4 seeds and records the hits each path
  collects. When you release the plunger, the game picks the candidate
  **nearest your pull** whose fixed hits add up to the drawn prize — first
  looking within ±6% of your pull for a path that lands within ×1.5 of the
  prize, then widening the power window (±12%, ±25%, any) and loosening the
  bonus (×3, ×8, ×25) — and fires the ball at that power with that seed. The
  charge you see is yours; the launch is the closest path that tells the
  truth.
- **No ball ends at zero.** Every table's lowest outcome is a consolation of
  ×0.2 the bet; the winning outcomes are rescaled so EV stays at 96%.
- **Every ball starts the same**, carrying 10% of its bet as credit, below the
  consolation floor. Nothing at launch tells a consolation ball from a jackpot.
- **The total can never pass the prize.** A + hit on a ball that has reached
  its prize reads `MAX` (its running total turns gold) and − hits still take a
  little. The total also never drops below one step.
- **Every exit is a bonus, never a cut.** Outhole, holes and baskets reveal
  the multiplier that lifts the running total to the prize (`$6.50 × 2`), a
  small `+ $0.40` nudge, or `MAX`. On a planned path this is usually ×1 to
  ×1.5; it is exact wherever the ball lands, and it is all that changes if
  another ball's spinner or targets nudge a path off its plan.
- Balls rattling on one component are kicked loose; gravity ramps at 12 s and
  a ball is force-settled at 22 s.

## Layout safety

`js/field.js` audits every machine: components inside the cabinet, clear of
walls and each other, and a **trap scan** that checks every resting position a
ball could occupy for a V-shaped pocket, at each field aspect the app can show
(1.5–1.72). Moving bumpers scan as the capsule they sweep, drop-target banks as
one bar (a resting ball drops them), and sealed islands like the U-turn's
middle are exempt.

```sh
node tools/verify-rtp.js   # 7 tables at 96% EV with no zero; fixed hits never cut at the exit; engine deterministic; 9 machines audited + trap-scanned
node tools/gen-icons.js    # regenerate PWA icons (dependency-free PNG encoder)
```

## Project layout

```
index.html            app shell + HUD
style.css             layout, DMD readouts, chrome buttons, safe-area handling
js/config.js          RTP target, risk profiles (prize tables + physics), ball types, buy-ins
js/layout.js          the layout kit: cabinet, primitives, pockets (pin field, spinner maze, twin lanes, U-turn, intersection…)
js/machines.js        the nine machines: style, palette, stakes, signature features
js/field.js           outcomes + fixed hit values, layout audit + trap scan, spec → pixels
js/physics.js         the deterministic pinball engine (shared by the table and the planner)
js/planner.js         module worker: simulates launch powers × seeds, streams candidate paths
js/render.js          retro renderer (wood, chrome, rubber, caps, inserts, printed art) + machine floor
js/font.js            5x7 dot-matrix font + screen-print/chrome lettering (no webfont)
js/main.js            plunger, launch planning, scoring hooks, HUD/lobby, frame loop
js/audio.js           tiny WebAudio synth (no assets)
sw.js                 service worker (offline cache)
manifest.json         PWA manifest
build.sh              writes dist/ (runtime files only)
tools/                icon generator + RTP/steering/machine verifier
```
