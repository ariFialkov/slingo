# Slingo

Slingshot pinball, playable on mobile and desktop as an installable PWA. Pull
back the slingshot, lob a ball into the playfield, and watch it bounce, roll and
drop through bumpers, pins, lanes and rails until a mystery pocket or hole
swallows it — racking up its prize along the way.

## Play it

Any static file server works (no bundler, zero dependencies):

```sh
python3 -m http.server 8080
# or: npx serve .
```

Open `http://localhost:8080`. On a phone, "Add to Home Screen" installs it as a
standalone app (manifest + service worker included; works offline after first
load). `./build.sh` produces a clean `dist/` folder containing only the runtime
files, for uploading elsewhere.

## Controls

- **Mobile**: touch the slingshot area (below the field), pull back to set aim
  and power, release to fire. The device buzzes at maximum pull and the camera
  kicks on release proportionally to shot strength.
- **Desktop**: identical, with click-and-drag.
- A filled trajectory line and glowing reticle show exactly where the ball will
  drop in. The slingshot can only shoot into the field's entry zone (top of the
  table), so aim is a matter of taste, not skill.
- **Ball type** (bottom button) cycles the bet: Bronze $1, Silver $5, Gold $10,
  Platinum $25, Diamond $100. The loaded ball takes on that colour.
- Fire as fast as you can pull. Multiple balls play out at once, each with its
  own floating running total; balls bounce off each other too.

## Playfield

| Component | What it does |
| --- | --- |
| **+ bumpers** (green) | Kick the ball away and add to its running total. |
| **− bumpers** (red) | Kick the ball away and subtract. |
| **Pins** | Pure deflectors (plinko-style), no score. |
| **Rollover lanes** (top) | Three dashed gates; crossing one downward adds. |
| **Signed rails** | Slanted side pieces: red pair mid-field subtracts, green pair lower down adds. |
| **Holes** (three "?" wells) | Swallow the ball and settle the bet immediately. |
| **Mystery pockets** (five "?" slots along the bottom) | Where every ball eventually drains; settles the bet. |

## How the outcome works

Every ball is an isolated bet at the ball's bet value. The outcome is decided
the moment you fire: a multiplier is drawn from the prize table below, fixing
the ball's **target prize**. The physics that follows is real (gravity,
restitution, bumper kicks) but purely visual — it cannot change the outcome.

- **Signed components steer toward the target.** A + component awards a share of
  the remaining gap; a − component pulls back an overshoot (or nibbles a nominal
  step so later + hits have something to fill). Awards are always multiples of
  5% of the stake, so totals stay clean.
- **Every route ends in a pocket or hole**, which reveals the exact residual
  between the running total and the target — so the target is reached on every
  possible path, and no ball can get "stuck" short of it. Stuck balls are nudged,
  gravity ramps up after 18 s, and a ball is force-settled at 30 s.
- The reveal card shows the residual and the final result (`×2 · $20.00`, or
  `×0`).

### Prize table (per ball, EV = 96% of stake)

| Multiplier | ×0.5 | ×1 | ×1.5 | ×2 | ×3 | ×5 | ×10 | ×25 | ×100 | ×0 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Probability | 20% | 20% | 10% | 8% | 4% | 2% | 0.6% | 0.12% | 0.04% | 35.2% |

Overall RTP is **96%**, the same as before. Verify it (and the steering
guarantee) with:

```sh
node tools/verify-rtp.js   # table EV + 20,000 simulated balls settle exactly on target
node tools/gen-icons.js    # regenerate PWA icons (dependency-free PNG encoder)
```

## Project layout

```
index.html            app shell + HUD
style.css             layout, HUD, safe-area handling
js/config.js          RTP target, prize table, ball types, physics constants
js/field.js           playfield layout + deterministic scoring/steering
js/main.js            slingshot, ball flight, pinball physics, rendering
js/audio.js           tiny WebAudio synth (no assets)
sw.js                 service worker (offline cache)
manifest.json         PWA manifest
build.sh              writes dist/ (runtime files only)
tools/                icon generator + RTP/steering verifier
```
