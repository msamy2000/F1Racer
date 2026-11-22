---
name: f1-regression-testing
description: >-
  Runbook and regression-test matrix for F1 2026 World Tour. Use when expanding
  Vitest coverage, verifying bug fixes, adding circuits, drivers, HUD controls,
  or regenerating pre-processed neural walkie-talkie race engineer audio clips.
---

# F1 2026 World Tour — Regression Testing & Verification Runbook

## Standard Verification Gate
Before committing or pushing any change:
1. Run the full unit and integration suite: `npm test`
2. Run TypeScript typechecking and production bundling: `npm run build`
3. If audio files were added or edited, verify MP3 headers/durations with `ffprobe`:
   `ffprobe -v error -show_entries format=format_name,duration -of default=noprint_wrappers=1 public/assets/audio/radio/*.mp3`

## Subsystem Regression Matrix

| Area Changed | Required Regression Checks | Test File(s) |
| :--- | :--- | :--- |
| Country flags / Drivers / Circuits | All driver & circuit flags resolve via `resolveFlagIso()`, render `<svg class="country-flag-icon">`, draw on mock 2D canvas without throwing, and zero raw flag emojis leak into UI HTML. | `src/__tests__/flagIcons.test.ts`, `src/__tests__/menuDriverSelect.test.ts` |
| HUD / Mobile Controls / Pause Menu | `BOX` illuminates `.active` (`BOX` → `BOX ●` → `IN PIT`), no `[data-touch="reset"]` exists, monochrome SVG cam/pause icons, decoupled Easy Drive vs BAS pause toggles, `Finish Time Trial` visibility, steer-mode persistence, 5-lights & radio toast timing. | `src/__tests__/raceHud.test.ts` |
| Race Engineer Radio & Podium Audio | Every fixed `RaceManager.emitRadio()` cue maps to a `RadioClipKey` whose MP3 exists (>4 KB); dynamic lap lines return `null`; MP3 fetch/decode caches buffers, ducks engine gain to `0.58`, cancels stale async plays, falls back to chirp on fetch failure; zero `speechSynthesis`; zero champagne cork-pop oscillator; looping celebration music on GP & Time Trial podiums. | `src/__tests__/audioAndAtmosphere.test.ts` |
| Cars / Podium / Effects | All 12 cars clone geometries independently (disposing car 0 keeps cars 1..11 intact), GLB meshes set `frustumCulled = false`, `NaN` coordinate guard in `updateFromState()`, sculpted 7-part metallic trophies (`podium-trophy-1..3`), zero Lego robot driver meshes or champagne particles. | `src/__tests__/renderingAndEffects.test.ts` |
| Circuits / Landmarks / Terrain | Distinct per-circuit landmarks (`silverstone-wing`, `silverstone-campsite`, `silverstone-cranes`, `rbr-hillside-chalet`, `alpine-mountain-range`, `monza-park-wall`, `monza-park-bridge`, `lombardy-prealps-range`, `vegasSphereMat`), no shared treeline/mountain clone, clean `dispose()`. | `src/__tests__/trackMeshBuilder.test.ts`, `src/__tests__/trackSpline.test.ts` |
| Assists / Track Limits / Pit Stops / Penalties | Decoupled Easy Drive vs BAS defaults (`false` / `true`) and independent behavior; 4-wheel track-limit escalation (`Warning 1/3` → `2/3` → `Black & White Flag 3/3` → `+3s` penalty); full pit-stop lifecycle; penalty classification reorder; Time Trial & 1-Lap Qualifying transitions. | `src/__tests__/drivingAssists.test.ts`, `src/__tests__/raceManager.test.ts`, `src/__tests__/carPhysics.test.ts` |
| Branding / Typography / PWA / SW | `index.html` & `manifest.webmanifest` titled `F1 2026 World Tour` with no personal names; `Inter` + `Segoe UI` font stack & smoothing; `public/sw.js` versioned cache + `event.waitUntil()` + Range skip; flex-star portraits precached. | `src/__tests__/menuDriverSelect.test.ts`, `src/__tests__/pwaManager.test.ts`, `src/__tests__/dataIntegrity.test.ts` |

## Adding a New Race Engineer Radio Clip
When adding a new fixed `emitRadio()` call in `src/engine/RaceManager.ts`:
1. Add the key to `RadioClipKey` and match it in `resolveRadioClipKey()` in `src/audio/F1AudioEngine.ts`.
2. Generate the MP3 using British neural voice `en-GB-RyanNeural` (`edge-tts`) processed with `ffmpeg` VHF pit-wall bandpass (`480–2450 Hz`), `1350 Hz` presence boost, compression, 10-bit `acrusher`, low VHF static bed, opening PTT chirp, and closing roger beep into `public/assets/audio/radio/<key>.mp3`.
3. Bump `CACHE_NAME` in `public/sw.js`.
4. Add the new cue to `src/__tests__/audioAndAtmosphere.test.ts` to assert mapping and on-disk MP3 existence.
