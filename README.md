# Slingo

A 2.5D slingshot betting game, playable on mobile and desktop as an installable PWA.
Pull back the slingshot, fire at a 3×3 jumbo board of mystery tiles, and chase
line-pattern bonuses.

## Play it

Any static file server works (no build step, zero dependencies):

```sh
python3 -m http.server 8080
# or: npx serve .
```

Open `http://localhost:8080`. On a phone, "Add to Home Screen" installs it as a
standalone app (manifest + service worker included; works offline after first load).

## Controls

- **Mobile**: touch the slingshot pouch area (lower part of the screen), pull back
  with your finger to set aim and power, release to fire. The device vibrates when
  you reach maximum pull, and the camera kicks on release proportionally to shot
  strength.
- **Desktop**: identical, with click-and-drag.

While aiming, a filled trajectory line and a glowing reticle mark the exact
landing point of the shot. The ⟳ button on the right edge refreshes the whole
board with fresh tiles.

The game opens straight into play with the slingshot primed and a ball loaded.
Hitting a tile places an isolated bet at the cost shown on its face; the tile spins
around its central vertical pivot before settling on its back side, which shows the
outcome. Resolved tiles refill with a fresh random tile after a short delay.

## Tile types

All types share the same per-bet RTP (see math below). Each front face shows a
question-mark watermark, a type-distinct background color, and its glowing cost.

| Type | Behaviour |
| --- | --- |
| **Standard** | Normal prize table (×0.5 up to ×25). |
| **Safe** | 75% hit rate, mostly ×0.5–×2, rare ×5/×8. |
| **Wild** | ~5% hit rate, ×10 up to ×100. |
| **Jackpot** | Almost always loses or returns small; 0.17% chance of a fixed ×500. |
| **Double or Nothing** | ×2 at 47%, else nothing. |
| **High / Low** | Strictly binary: every bet lands on one of the two displayed options and the percentages sum to 100 (e.g. ▲×1.6 @ 40%, ▼×0.5 @ 60%); a miss only exists in the variant whose low option is ×0. |
| **Fill & Deal** | Shots into the doggy-door slot each add $1/$2/$5/$10/$25 (per tile) to the counter; a shot anywhere else on the tile places the accumulated bet on the standard table. |
| **Risk Slider** | Fixed cost; a slider oscillates 0%→100%→0% every 2 s. Risk r gives multiplier 1+49r and win chance RTP/mult — hit the tile to lock in the current risk. |
| **Randomizer** | Shows a count 1–5 (2–3 most common). On hit, that many random tiles resolve simultaneously, splitting the stake. |
| **Roulette** | Shots toggle the 3×3 LED cubes yellow; a shot elsewhere places one bet per selected cube. The drawn cube lights green (selected) or red (not); a hit pays ×8.46 per square (9 × RTP, so EV per square = RTP). |
| **Stepper** | First shot on either button starts the game and places the bet; the crash step is pre-drawn in one isolated event. Top button = take a step (cash-out value ÷= step probability), bottom = cash out. Counters show current cash-out value and next-step success %. |

## Pattern bonuses

Winning tiles keep their perimeter lit while they extend a straight line of
*consecutive* winners. A losing hit, or a winner that doesn't continue the line,
clears the lights (the newest winner stays lit if it won). Deterministic awards
(a full line on the 3×3 board is 3 tiles; diagonals run through the centre, so
they pay more):

- **3-tile horizontal/vertical line**: last won prize ×2
- **3-tile diagonal**: last won prize ×3

## RTP math

- Target RTP: **96%**. Per-bet tile EV: **94%** — the 2-point gap is the
  deterministic budget for pattern bonuses.
- Every prize table satisfies Σ (multiplier × probability) = 0.94.
- Risk slider: win probability is 0.94 / multiplier, so EV is 0.94 at every risk.
- Roulette: 9 cubes, uniform draw, prize 9 × 0.94 = ×8.46 per selected square.
- Stepper: immediate cash-out returns 0.94×cost and every step is EV-neutral
  (value ÷= success probability), so *any* strategy has EV 0.94.
- Randomizer: stake splits evenly over the chosen tiles, each resolving at 0.94 EV.

Run the checks:

```sh
node tools/verify-rtp.js   # analytic + Monte Carlo verification
node tools/gen-icons.js    # regenerate PWA icons (dependency-free PNG encoder)
```

## Project layout

```
index.html            app shell + HUD
style.css             layout, HUD, safe-area handling
js/config.js          RTP targets, prize tables, tile registry
js/tiles.js           tile creation, outcome rolls, per-type hit logic
js/main.js            board geometry, slingshot, projectile, rendering, bonuses
js/audio.js           tiny WebAudio synth (no assets)
sw.js                 service worker (offline cache)
manifest.webmanifest  PWA manifest
tools/                icon generator + RTP verifier
```
