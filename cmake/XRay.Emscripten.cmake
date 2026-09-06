include_guard()

# Emscripten build: wasm64, pthreads, WebGL2. Included from XRay.Compiler.GNULike.cmake.

set(XRAY_WEB_TARGET_FLAGS
    -pthread
    -m64
    -msimd128
    -msse3
    -fwasm-exceptions
    -sUSE_SDL=2
    -sUSE_OGG=1
    -sUSE_VORBIS=1
    -sUSE_LIBJPEG=1
)
add_compile_options(${XRAY_WEB_TARGET_FLAGS})
add_link_options(${XRAY_WEB_TARGET_FLAGS})

set(CMAKE_EXECUTABLE_SUFFIX ".js")

# Emscripten ports and built-in libraries stand in for the system packages.
# Their flags are global (above), so the targets only need to exist.
foreach (lib SDL2::SDL2 Ogg::Ogg Vorbis::Vorbis Vorbis::VorbisFile JPEG::JPEG OpenAL::OpenAL)
    add_library(${lib} INTERFACE IMPORTED)
endforeach()
target_link_options(OpenAL::OpenAL INTERFACE -lopenal)
# The engine includes the flat OpenAL Soft header names (<al.h>), Emscripten ships them under AL/.
target_include_directories(OpenAL::OpenAL INTERFACE "${EMSCRIPTEN_SYSROOT}/include/AL")
set(JPEG_FOUND TRUE)

# Libraries without a port are built from source (LZO, Theora, Lua 5.1).
add_subdirectory("${CMAKE_SOURCE_DIR}/Externals/web" "${CMAKE_BINARY_DIR}/Externals/web")

# Satisfy find_package(Lua51) / find_package(Lua) in Externals with the source-built Lua.
set(LUA_INCLUDE_DIR "${XRAY_WEB_LUA_INCLUDE_DIR}" CACHE PATH "" FORCE)
set(LUA_LIBRARY xrLua51 CACHE STRING "" FORCE)
set(LUA_MATH_LIBRARY m CACHE STRING "" FORCE)
add_library(Lua51 ALIAS xrLua51)

# Runtime configuration of the game executable (applied in src/xr_3da/CMakeLists.txt)
set(XRAY_WEB_EXECUTABLE_LINK_OPTIONS
    -sPROXY_TO_PTHREAD
    -sOFFSCREENCANVAS_SUPPORT
    "-sOFFSCREENCANVASES_TO_PTHREAD=#canvas"
    "-sPTHREAD_POOL_SIZE=navigator.hardwareConcurrency+4"
    -sWASMFS
    -sALLOW_MEMORY_GROWTH
    -sINITIAL_MEMORY=2GB
    -sMAXIMUM_MEMORY=16GB
    -sSTACK_SIZE=16MB
    -sDEFAULT_PTHREAD_STACK_SIZE=4MB
    -sMIN_WEBGL_VERSION=2
    -sMAX_WEBGL_VERSION=2
    -sFULL_ES3
    -sGL_ENABLE_GET_PROC_ADDRESS
    -sMALLOC=mimalloc
    -sEXIT_RUNTIME=0
    -sENVIRONMENT=web,worker
    -sMODULARIZE
    -sEXPORT_ES6
    -sASSERTIONS=1 # temporarily on in every configuration while the GLES port is stabilized
    --profiling-funcs
    "--pre-js=${CMAKE_SOURCE_DIR}/web/pre.js"
    -sGL_ASSERTIONS=1 # temporarily on in every configuration while the GLES port is stabilized
    $<$<CONFIG:Debug,Mixed>:-gsource-map>
)
