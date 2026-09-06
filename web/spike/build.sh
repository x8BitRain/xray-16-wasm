#!/bin/sh
# Builds the spike with the same flag set the engine will use.
set -e
cd "$(dirname "$0")"
REPO="$(cd ../.. && pwd)"
COMMON="-pthread -sMEMORY64=1 -msimd128 -msse3 -fwasm-exceptions -sUSE_SDL=2 -O2 -g"
emcc $COMMON -I"$REPO/sdk/include" spike.cpp "$REPO/sdk/include/glad/gl.c" -o spike.js \
  -sPROXY_TO_PTHREAD -sOFFSCREENCANVAS_SUPPORT -sOFFSCREENCANVASES_TO_PTHREAD='#canvas' \
  -sPTHREAD_POOL_SIZE='navigator.hardwareConcurrency+4' -sWASMFS \
  -sALLOW_MEMORY_GROWTH -sINITIAL_MEMORY=2GB -sMAXIMUM_MEMORY=16GB \
  -sSTACK_SIZE=16MB -sDEFAULT_PTHREAD_STACK_SIZE=4MB \
  -sMIN_WEBGL_VERSION=2 -sMAX_WEBGL_VERSION=2 -sFULL_ES3 -sGL_ENABLE_GET_PROC_ADDRESS \
  -sMALLOC=mimalloc -sEXIT_RUNTIME=0 -sENVIRONMENT=web,worker -sMODULARIZE -sEXPORT_ES6 \
  -sASSERTIONS=1 -sGL_ASSERTIONS=1
echo "built web/spike/spike.js"
