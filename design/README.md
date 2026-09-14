# Brand assets

The icon is generated, not drawn by hand. `icon-source.js` holds the mark as
vector geometry in a 512-unit space; every deliverable is that same artwork
placed by a transform. Change the mark once and the app icon, the Android
adaptive layers, the themed icon, the splash and the Play Store graphics all
follow, with no resampling and nothing to keep in sync by hand.

To re-render after an edit, run the build script that produced these (it needs
only headless Chromium, no design tool and no licence).

## What each file is for

| File | Size | Where it goes |
|---|---|---|
| `assets/icon.png` | 1024² | `expo.icon` — the base icon Expo derives the legacy launcher icons from |
| `assets/adaptive-icon.png` | 1024², transparent | `android.adaptiveIcon.foregroundImage` |
| `assets/monochrome-icon.png` | 1024², transparent | `android.adaptiveIcon.monochromeImage` — Android 13+ themed icons |
| `assets/splash-icon.png` | 1024², transparent | `expo.splash.image` |
| `design/play-store/playstore-icon.png` | 512² | Play Console → Store listing → App icon |
| `design/play-store/feature-graphic.png` | 1024×500 | Play Console → Store listing → Feature graphic |

## Decisions worth not undoing

**No rounded corners baked into the artwork.** Android and the Play Store each
apply their own mask, and a shape baked in shows as a dark halo inside theirs.
Both square files are deliberately full-bleed.

**The adaptive foreground is smaller than the plain icon** — 52% of the canvas
against 58%. A launcher may mask the icon to a circle, and a circle inscribed
in the square cuts the corners off anything much larger than 61%. The safe zone
is a 66dp circle inside the 108dp canvas; the mark sits inside it on every mask
shape, which was checked against circle, squircle, rounded square and full
square rather than assumed.

**The mark is three fat bars and one printed line**, not the two lines and three
thin bars of the first draft. That version looked considered at 200px and turned
to porridge at 48 — which is the size that decides whether anyone finds the app
on a crowded home screen. Anything added back here should be checked at 48px
first.

**The splash background is `#0E3E35`, the same green the icon sits on**, so
launching the app continues the icon rather than flashing white and then
resolving into a dark interface.

**The feature graphic says "Works offline · Backs up to your own Google Drive"**
and not "Free". The paywall is planned; a store graphic promising free forever
would have to be replaced the day it ships, and screenshots of it would still be
circulating.

It used to say *"No account needed"*, which was true when it was written and
became false the day signing in was made mandatory. Rebuild this file whenever
the app's promises change — `node design/build-feature.js` — because a store
graphic that contradicts the first screen of the app is worse than a plain one.
That script measures the rendered text and shrinks the title until it fits,
rather than trusting a guess at font metrics.

## Play Console requirements these already meet

- App icon: 512×512, 32-bit PNG, under 1 MB.
- Feature graphic: 1024×500, **no alpha channel** — Play rejects transparency
  here, so that file is deliberately written as opaque RGB while the icons keep
  their alpha.
- Still to produce for the listing: at least two phone screenshots, 16:9 or 9:16,
  each between 320px and 3840px on its longest edge.
