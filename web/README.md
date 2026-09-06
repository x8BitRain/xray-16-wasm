# OpenXRay in the browser (WebAssembly)

Emscripten build of the engine: wasm64 (Memory64), pthreads, WebGL2, game files in the Origin
Private File System. Chrome only. Sound is not built in yet, so always run with `-nosound`.

## Build

```sh
brew install emscripten ninja glslang
git submodule update --init --recursive
emcmake cmake --preset web-release
cmake --build --preset web-release
```

The build writes `xr_3da.js` and `xr_3da.wasm` into `web/dist` and refreshes `web/dist/engine`
(a copy of `res/fsgame.ltx` and `res/gamedata`, listed in `engine_data.json`).

## Run

```sh
node web/serve.mjs web/dist 8081 "/path/to/Stalker Call of Pripyat"
```

Open http://localhost:8081 in Chrome. The last argument is optional: with it the page offers
"Ingest from server" (fast, no dialogs); without it use "Select game folder", which asks for the
Call of Pripyat install folder. Either way the game files are copied into OPFS once (about 5 GB),
lowercased, minus `bin/`, `directx/` and `helpers/`. Reloading afterwards skips straight to Launch.

If the toolbar shows "OPFS unavailable" the log panel names the cause; the usual ones are
opening the page from `file://` and serving it without the COOP/COEP headers.

To start a game, put this in the extra arguments box and press Launch:

```
-start server(all/single/alife/new) client(localhost)
```

That loads Zaton directly and skips the menu, the intro videos and the intro cutscene
(the page always passes `-nointro -nogameintro`). Once the level has loaded, press a key to
dismiss the "game loaded" prompt. Loading takes a few minutes the first time because the
collision model is built from scratch; it is cached in OPFS afterwards.

Leave "absolute cursor (-i)" checked to drive menus with the normal pointer. Unchecked, the
engine uses relative mouse look and the page requests pointer lock when you click the canvas.

Engine logs stream to the page and to OPFS `game/_appdata_/logs/`. Saves go to
`game/_appdata_/savedgames/`, screenshots to `game/_appdata_/screenshots/`.
`window.saveFromOpfs("game/_appdata_/screenshots/<name>.jpg")` copies a file out of OPFS into
`web/out/` through the dev server.

## Shader validation without a browser

The engine rewrites its GLSL 4.10 shaders to GLSL ES 3.00 at runtime (`rgl_essl_rewrite.h`).
The same rewrite can be checked offline:

```sh
./web/tools/essl_check.sh          # rewrites every GL shader and runs glslangValidator
python3 web/tools/essl_report.py   # unique error sites, mapped back to the original files
```

## Known gaps

- The main menu can crash when the cursor moves over its items (bad indirect call in the UI
  update path). Launching with `-start` avoids the menu entirely.
- No sound: xrSound is built but the engine must run with `-nosound`.
- Compressed 3D textures and a few 2D ones fail to upload (WebGL rejects compressed 3D
  subimages), so water and one or two UI textures are wrong.
- Occlusion queries never block, so nothing is culled by them; hardware occlusion is effectively off.
