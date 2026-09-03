# Slingo

Plunger pinball on procedurally generated boards, playable on mobile and
desktop as an installable PWA. Pull the spring plunger, release, and the ball
shoots up the launch lane, around the top curve and into the field, where it
bounces, rolls and drops through bumpers, kickers, magnets, gates and spinners
until an exit swallows it — racking up its prize along the way. Every five balls
the board regenerates with a new layout and a new risk theme.

## Play it

Any static file server works (no bundler, zero dependencies):

```sh
python3 -m http.server 8080
# or: npx serve .
```

Open `http://localhost:8080`. On a phone, "Add to Home Screen" installs it as a
standalone app (works offline after first load). `./build.sh` produces a clean
`dist/` folder with only the runtime files, for uploading elsewhere.

## Controls

- **Mobile**: touch anywhere in the plunger strip below the cabinet, drag down
  to compress the spring, release to launch. The device buzzes at full pull and
  the camera kicks on release proportionally to strength.
- **Desktop**: identical, with click-and-drag.
- A gauge along the launch lane shows pull strength and the tick that clears
  the lane flap. Launch speed is a pure function of pull, so the same pull on
  the same board always enters the field the same way. Too weak, and the ball
  drops back onto the plunger — pull again, it's still the same bet.
- **Ball type** (bottom button) cycles the bet: Bronze $1, Silver $5, Gold $10,
  Platinum $25, Diamond $100. The ball waiting on the plunger takes that colour.
- Launch as fast as you can pull; multiple balls play out at once, each with its
  own floating running total. Balls bounce off each other too.
- **⟳** rolls a new board whenever the field is empty.

## The board formula

Each board is generated from a recipe: a chamfered cabinet with a notch on the
left, a launch lane down the right ending in a quarter-arc that curves plunged
balls into the field (with a one-way flap so launched balls can't fall back down
the lane), an orbit rail and an optional swoosh ramp kept well clear of the
walls, then components placed by rejection sampling with clearances above a ball
diameter. A **trap scan** then checks every resting position a ball could occupy
for a V-shaped pocket and regenerates the board if one exists — no dead ends by
construction.

| Component | Indicator | What it does |
| --- | --- | --- |
| **CORE reactor** | `+++` | Big central pop bumper; takes a large share of the remaining gap. |
| **BONUS discs** (Nebula) | `+++` | Extra big-pop bumpers. |
| **Pop bumpers** | `++` / `−−` | Kick the ball away; medium share. |
| **Moving bumper** | `++` / `−−` | A pop bumper sliding back and forth on a rail. |
| **Magnets** | `MAGNET ++` / `−−` | Bend nearby ball paths toward them (dashed field rings); score on contact. |
| **Triangle kickers** | `−−` (pair above the flippers) / `++` | Kick off every edge. |
| **Signed rails** | `++` / `−−` | Slanted neon pieces near the side walls. |
| **Kicker pins** | `+` / `−` | Small tinted pegs; nibble at the gap. |
| **Drop-target bank** | `TARGETS + · BANK +++` | Three targets that fold down when hit; clearing all three pays `+++` and the bank resets. |
| **Gates** | `+` | Channels that score, then **BOOST** (accelerate), **SLOW** (brake) or **WARP A/B** (teleport to the twin). |
| **One-way gates** | `ONE-WAY +` | A hinged flap: balls pass one way (scoring) and can't come back. |
| **Spinners** | `+ SPIN` | A paddle on an axle; a passing ball spins it (and slows), each revolution scores, up to five. |
| **Kickout hole** | `KICK ++` | Swallows the ball, scores, then ejects it from a linked nozzle elsewhere. |
| **Holes / baskets** | `?` | Swallow the ball and settle the bet. |
| **Auto-flippers** | pips under the ball | React automatically when a ball drops onto them, with 1–3 charges per ball by theme; once spent, the ball drains. |
| **EXIT** | `?` | The well between the flippers; settles the bet. |

The number of glyphs is the **tier**: the share of the remaining gap the
component takes (`+` ≈ 12–30%, `++` ≈ 30–55%, `+++` ≈ 55–95%).

## Themes = risk profiles

| Theme | Colour | Profile | Hit rate | Max |
| --- | --- | --- | --- | --- |
| **VERDANT** | green | safe, slow & steady | 88% | ×5 |
| **SOLAR** | yellow | moderate, balanced | 62% | ×25 |
| **EMBER** | orange | volatile, high potential | 41% | ×100 |
| **INFERNO** | red | extreme, rare huge wins | 16% | ×500 |
| **AURORA** | blue | marathon: low gravity, 3 flipper charges | 77% | ×5 |
| **NEBULA** | purple | bonus discs, 2 flipper charges | 56% | ×20 |

Every table has EV = 96% of stake. Risk pips next to the board title show the
profile at a glance.

## How the outcome works

Every ball is an isolated bet at the ball's bet value, decided the moment it is
launched: a multiplier is drawn from the board's prize table, fixing the ball's
**target prize**. The physics that follows is real but purely visual.

- **Signed components steer toward the target.** A + component awards a share
  of the remaining gap (by tier); a − component pulls back an overshoot (or
  nibbles a nominal step). Awards are multiples of 5% of the stake.
- **Every route ends at an exit** (hole, basket or the well), which settles the
  bet at exactly the target. The result card shows the prize (green if it is at
  least the bet, red otherwise) and its multiplier.
- Balls rattling against one component stop scoring and get kicked loose;
  scoring stops and gravity ramps at 12 s; force-settle at 22 s.

```sh
node tools/verify-rtp.js   # 6 tables at 96% EV; 27,000 steered balls settle exactly; boards + trap scan
node tools/gen-icons.js    # regenerate PWA icons (dependency-free PNG encoder)
```

## Project layout

```
index.html            app shell + HUD
style.css             layout, HUD, safe-area handling
js/config.js          RTP target, themes (palettes + prize tables), ball types, physics
js/field.js           board generator, trap scan, deterministic scoring/steering
js/main.js            plunger, pinball physics, components, auto-flippers, rendering
js/audio.js           tiny WebAudio synth (no assets)
sw.js                 service worker (offline cache)
manifest.json         PWA manifest
build.sh              writes dist/ (runtime files only)
tools/                icon generator + RTP/steering/board verifier
```
