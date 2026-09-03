# Slingo

Slingshot pinball on procedurally generated boards, playable on mobile and
desktop as an installable PWA. Pull back the slingshot, lob a ball anywhere into
the cabinet, and watch it bounce, roll and drop through bumpers, kickers, pins,
lanes and rails until an exit swallows it — racking up its prize along the way.
Every five balls the board regenerates with a new layout and a new risk theme.

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

- **Mobile**: touch the slingshot area (below the cabinet), pull back to set aim
  and power, release to fire. The device buzzes at maximum pull and the camera
  kicks on release proportionally to shot strength.
- **Desktop**: identical, with click-and-drag.
- A filled trajectory line and glowing reticle show exactly where the ball drops
  in. The whole cabinet is open to aim at, except the hatched **NO AIM** zone
  just above the exit.
- **Ball type** (bottom button) cycles the bet: Bronze $1, Silver $5, Gold $10,
  Platinum $25, Diamond $100. The loaded ball takes on that colour.
- Fire as fast as you can pull; multiple balls play out at once, each with its
  own floating running total. Balls bounce off each other too.
- **⟳** rolls a new board whenever the field is empty.

## The board formula

Each board is generated from a recipe: an asymmetric chamfered cabinet outline
with a side notch, an orbit rail on the opposite side and an optional swoosh
ramp (both kept well clear of the walls), then components placed by rejection
sampling inside the polygon with clearances of more than a ball diameter. A
**trap scan** then checks every resting position a ball could occupy for a
V-shaped pocket (two supports pushing up from opposite sides at distinct
contact points) and regenerates the board if one exists — so there are no dead
ends by construction, not just by tuning.

| Component | Indicator | What it does |
| --- | --- | --- |
| **CORE reactor** | `+++` | Big central pop bumper; takes a large share of the remaining gap. |
| **BONUS discs** (Nebula) | `+++` | Extra big-pop bumpers. |
| **Pop bumpers** | `++` / `−−` | Kick the ball away; medium share. |
| **Triangle kickers** | `−−` (slingshot pair) / `++` | Kick off every edge; the pair above the flippers always subtracts. |
| **Signed rails** | `++` / `−−` | Slanted neon pieces hugging the side walls. |
| **Kicker pins** | `+` / `−` | Small tinted pegs; nibble at the gap. |
| **Plain pins**, guides, orbit rail | — | Pure deflectors. |
| **Gates** | `+` | Short channels scattered across the field. Passing through scores, then: **BOOST** (green chevrons) fires the ball on along the channel, **SLOW** (blue bars) brakes it, **WARP A/B** (magenta) teleports it out of its twin. |
| **Spinners** | `+ SPIN` | A paddle on an axle between two posts. A ball passing through spins it (and loses some speed); every revolution scores for that ball, up to five. |
| **Holes / baskets** | `?` | Swallow the ball and settle the bet. |
| **Auto-flippers** | pips under the ball | React automatically when a ball drops onto them, with 1–3 charges per ball depending on the theme; once spent, the ball drains. |
| **EXIT** | `?` | The well between the flippers; settles the bet. |

The number of glyphs is the **tier**: the share of the remaining gap the
component takes (`+` ≈ 12–30%, `++` ≈ 30–55%, `+++` ≈ 55–95%).

## Themes = risk profiles

Each theme pairs a colour with a prize table of identical EV (96%) but very
different variance, plus physics and component-mix tweaks:

| Theme | Colour | Profile | Hit rate | Max |
| --- | --- | --- | --- | --- |
| **VERDANT** | green | safe, slow & steady | 88% | ×5 |
| **SOLAR** | yellow | moderate, balanced | 62% | ×25 |
| **EMBER** | orange | volatile, high potential | 41% | ×100 |
| **INFERNO** | red | extreme, rare huge wins | 16% | ×500 |
| **AURORA** | blue | marathon: low gravity, 3 flipper charges | 77% | ×5 |
| **NEBULA** | purple | bonus discs, 2 flipper charges | 56% | ×20 |

Risk pips next to the board title show the profile at a glance.

## How the outcome works

Every ball is an isolated bet at the ball's bet value. The outcome is decided
the moment you fire: a multiplier is drawn from the board's prize table, fixing
the ball's **target prize**. The physics that follows is real but purely visual
— it cannot change the outcome.

- **Signed components steer toward the target.** A + component awards a share of
  the remaining gap (by tier); a − component pulls back an overshoot (or nibbles
  a nominal step so later + hits have something to fill). Awards are multiples of
  5% of the stake, so totals stay clean.
- **Every route ends at an exit** (hole, basket or the well), which reveals the
  exact residual between running total and target — so the target is reached on
  every possible path. Balls rattling against one component stop scoring and get
  kicked loose; scoring stops and gravity ramps at 12 s; force-settle at 22 s.
- The reveal card shows the residual and the final result (`×2 · $20.00`, `×0`).

Verify the tables, the steering guarantee and board generation with:

```sh
node tools/verify-rtp.js   # 6 tables at 96% EV; 27,000 simulated balls settle exactly; 240 boards valid
node tools/gen-icons.js    # regenerate PWA icons (dependency-free PNG encoder)
```

## Project layout

```
index.html            app shell + HUD
style.css             layout, HUD, safe-area handling
js/config.js          RTP target, themes (palettes + prize tables), ball types, physics
js/field.js           board generator, deterministic scoring/steering, aim clamping
js/main.js            slingshot, ball flight, pinball physics, auto-flippers, rendering
js/audio.js           tiny WebAudio synth (no assets)
sw.js                 service worker (offline cache)
manifest.json         PWA manifest
build.sh              writes dist/ (runtime files only)
tools/                icon generator + RTP/steering/board verifier
```
