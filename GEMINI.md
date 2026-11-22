# F1 2026 World Tour — Project Engineering Guardrails

These invariants capture lessons learnt from production bugs and user reviews. Do not violate them when adding features or refactoring.

## 1. Three.js / WebGL Rendering & Asset Safety
- **Never share disposable `BufferGeometry` across car instances**: In `CarMeshBuilder.ts`, clone GLB geometries per car (`obj.geometry = obj.geometry.clone()`, `userData.sharedGlbGeometry = false`), set `frustumCulled = false`, and guard `updateFromState()` against non-finite (`NaN`/`Infinity`) positions so disposing showroom or rival cars never makes grid cars vanish.
- **No primitive "Lego robot" characters and no champagne on the podium**: `SceneManager.enterPodiumCeremony()` showcases centered illuminated photorealistic driver portrait monoliths (`podium-plaque-1..3`), sculpted rotating metallic trophies (`buildPodiumTrophyMesh`), and the winning F1 car. Never add blocky 3D driver bodies, champagne bottles/particles, cork-pop SFX, or champagne copy.
- **Circuit-authentic outdoor environments & landmarks**: Each daylight circuit (`red-bull-ring`, `monza`, `silverstone`) and night circuit (`las-vegas`) must keep its own distinct real-world terrain, flora, and signature landmarks (e.g., Las Vegas Sphere Arena, Styrian Alps + chalets, Monza Royal Park walls/bridges + Lombardy Prealps, Silverstone Wing + campsite + cranes). Never copy-paste a generic mountain range or treeline across tracks.
- **Daytime HDRI radiance control**: Always run `compressHdrTextureRadiance()` on loaded HDRI maps so daytime sky/sun specular highlights do not clip white.

## 2. Audio & Race Engineer Comms
- **Never use browser/OS `speechSynthesis`**: Robotic Web Speech TTS is strictly prohibited. Fixed Race Engineer callouts in `RaceManager.emitRadio()` must map via `resolveRadioClipKey()` in `src/audio/F1AudioEngine.ts` to pre-generated neural walkie-talkie MP3s under `public/assets/audio/radio/*.mp3`. Dynamic numeric callouts (e.g., lap-time splits) play only the crisp pit-wall two-tone telemetry chirp (`playTwoToneChirp`).
- **Music lifecycle & iOS Safari audio safety**: `setMenuMusicActive(false)` and `setEngineActive(true)` must immediately pause menu music (even when `Audio.volume` is read-only on iOS Safari) and cancel in-flight async `play()` promises. `playPodiumCelebration()` must start looping stage celebration music (`setMenuMusicActive(true)`) on both Grand Prix and Time Trial finishes when unmuted.

## 3. Cross-Platform UI, Controls & Branding
- **Cross-platform SVG/Canvas country flags**: Never emit raw Unicode regional-indicator flag emojis (`🇪🇬`, `🇬🇧`, etc.) in HTML or Canvas (Windows Chrome/Edge lack color flag glyphs). Always use `renderFlagSvg()` or `drawFlagOnCanvas()` from `src/ui/flagIcons.ts`.
- **Clean HUD & Podium iconography**: Use crisp monochrome inline SVGs (`CAM_ICON_SVG`, `PAUSE_ICON_SVG`) or clean text labels (`Official Classification`, `Full 3D Stage`) instead of multi-color system emojis (`📊`, `🎉`, `🥂`, `📷`).
- **Windows Chrome readability & clean app title**: Keep `Inter` + `Segoe UI` + antialiased font smoothing in `index.html` and `src/ui/styles.css`. Keep browser `<title>` and `public/manifest.webmanifest` strictly `F1 2026 World Tour` (no personal driver names in app title/banner).
- **Decoupled driving assists & defaults**: `steeringAssist` (Easy Drive) and `brakingAssist` (BAS) must remain independently configurable in both Setup and Pause menus, defaulting to `steeringAssist: false`, `brakingAssist: true`.
- **Mobile HUD controls**: Keep the `BOX` pill illuminated (`.active` class + `BOX ●` / `IN PIT` label) when pit request is armed or in pit lane. Never reintroduce a mobile Track Reset button. Keep Windows touchscreen laptops classified as Laptop UI (`isMobile = false`).

## 4. PWA Cache & Regression Testing Discipline
- **Service Worker (`public/sw.js`)**: Bump `CACHE_NAME` (`f1-2026-world-tour-vN`) whenever static assets, UI bundles, portraits, or audio files change; never cache HTTP `Range` (`206`) responses; wrap cache writes in `event.waitUntil()`.
- **Test every fix at the root cause**: Every bug fix or UX change must add or update automated tests in `src/__tests__/` and pass `npm test && npm run build` before pushing.
