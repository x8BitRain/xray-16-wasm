# OpenXRay in the browser with WebAssembly

Emscripten build of the engine: wasm64 (Memory64), pthreads, WebGL2, game files in the Origin
Private File System, sound through Emscripten's OpenAL. Chrome only.

## One-time setup

```sh
brew install emscripten ninja glslang
git submodule update --init --recursive
emcmake cmake --preset web-release
```

## Build

```sh
cmake --build --preset web-release
```
