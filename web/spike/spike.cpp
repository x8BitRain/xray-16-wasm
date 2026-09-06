// Throwaway spike: proves SDL2 window + WebGL2 via html5 API + OPFS + threads + Memory64
// all work from a proxied main pthread with the engine's flag set.
#include <SDL.h>
#include <emscripten.h>
#include <emscripten/html5.h>
#include <emscripten/wasmfs.h>
#include <emscripten/threading.h>
#include <emscripten/heap.h>
#include <glad/gl.h>
extern "C" void glDrawElementsInstancedBaseVertexBaseInstanceWEBGL(GLenum, GLsizei, GLenum, const void*, GLsizei, GLint, GLuint);

#include <chrono>
#include <condition_variable>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fcntl.h>
#include <glob.h>
#include <mutex>
#include <sys/mman.h>
#include <sys/stat.h>
#include <thread>
#include <unistd.h>
#include <vector>

static SDL_Window* g_window;
static GLuint g_program, g_vao, g_vbo, g_ibo;
static int g_frame;
static bool g_relative;

static std::mutex g_mutex;
static std::condition_variable g_cv;
static int g_generation;
static int g_workerHits;
static std::vector<std::thread> g_workers;

typedef void (*PFNDRAWBASEVERTEXWEBGL)(GLenum, GLsizei, GLenum, const void*, GLsizei, GLint, GLuint);
static PFNDRAWBASEVERTEXWEBGL g_drawBaseVertex;

static double now_ms()
{
    return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();
}

static void test_opfs()
{
    backend_t opfs = wasmfs_create_opfs_backend();
    int rc = wasmfs_create_directory("/opfs", 0777, opfs);
    printf("[opfs] mount rc=%d\n", rc);
    mkdir("/opfs/spike", 0777);

    const size_t size = 64u << 20;
    std::vector<unsigned char> data(size);
    for (size_t i = 0; i < size; ++i) data[i] = (unsigned char)(i * 7);

    double t0 = now_ms();
    FILE* f = fopen("/opfs/spike/blob.bin", "wb");
    fwrite(data.data(), 1, size, f);
    fclose(f);
    double t1 = now_ms();
    printf("[opfs] wrote 64MB in %.0f ms (%.0f MB/s)\n", t1 - t0, 64.0 / ((t1 - t0) / 1000.0));

    int fd = open("/opfs/spike/blob.bin", O_RDONLY);
    struct stat st;
    fstat(fd, &st);
    printf("[opfs] stat size=%lld\n", (long long)st.st_size);
    std::vector<unsigned char> chunk(1u << 20);
    bool ok = true;
    t0 = now_ms();
    for (size_t off = 0; off < size; off += chunk.size())
    {
        ssize_t n = pread(fd, chunk.data(), chunk.size(), off);
        if (n != (ssize_t)chunk.size() || memcmp(chunk.data(), data.data() + off, chunk.size()) != 0) ok = false;
    }
    t1 = now_ms();
    printf("[opfs] pread 64MB in 1MB chunks: %.0f ms (%.0f MB/s) verify=%s\n", t1 - t0, 64.0 / ((t1 - t0) / 1000.0), ok ? "ok" : "MISMATCH");

    void* m = mmap(nullptr, 4096, PROT_READ, MAP_SHARED, fd, 0);
    printf("[opfs] mmap MAP_SHARED -> %s\n", m == MAP_FAILED ? "MAP_FAILED (expected)" : "succeeded");
    if (m != MAP_FAILED) munmap(m, 4096);
    close(fd);

    glob_t g{};
    rc = glob("/opfs/spike/*", 0, nullptr, &g);
    printf("[opfs] glob rc=%d count=%zu first=%s\n", rc, g.gl_pathc, g.gl_pathc ? g.gl_pathv[0] : "-");
    globfree(&g);
    char real[512];
    printf("[opfs] realpath=%s\n", realpath("/opfs/spike/../spike/blob.bin", real) ? real : "(null)");
}

static void test_memory64()
{
    printf("[mem64] sizeof(void*)=%zu heap=%zu MB\n", sizeof(void*), emscripten_get_heap_size() >> 20);
    std::vector<void*> blocks;
    const size_t step = 1ull << 30;
    for (int i = 1; i <= 6; ++i)
    {
        void* p = malloc(step);
        if (!p) { printf("[mem64] malloc of GB #%d failed\n", i); break; }
        for (size_t off = 0; off < step; off += 1u << 20) ((volatile char*)p)[off] = 1;
        blocks.push_back(p);
        printf("[mem64] allocated %d GB, heap=%zu MB\n", i, emscripten_get_heap_size() >> 20);
    }
    for (void* p : blocks) free(p);
}

static void start_workers()
{
    for (int i = 0; i < 4; ++i)
    {
        g_workers.emplace_back([i]
        {
            int seen = 0;
            for (;;)
            {
                std::unique_lock<std::mutex> lock(g_mutex);
                g_cv.wait(lock, [&] { return g_generation != seen; });
                seen = g_generation;
                ++g_workerHits;
            }
        });
    }
}

static GLuint compile(GLenum type, const char* src)
{
    GLuint s = glCreateShader(type);
    glShaderSource(s, 1, &src, nullptr);
    glCompileShader(s);
    GLint ok = 0;
    glGetShaderiv(s, GL_COMPILE_STATUS, &ok);
    if (!ok)
    {
        char log[1024];
        glGetShaderInfoLog(s, sizeof log, nullptr, log);
        printf("[gl] shader error: %s\n", log);
    }
    return s;
}

static bool init_gl()
{
    EmscriptenWebGLContextAttributes attrs;
    emscripten_webgl_init_context_attributes(&attrs);
    attrs.majorVersion = 2;
    attrs.minorVersion = 0;
    attrs.depth = true;
    attrs.stencil = true;
    attrs.antialias = false;
    attrs.powerPreference = EM_WEBGL_POWER_PREFERENCE_HIGH_PERFORMANCE;
    EMSCRIPTEN_WEBGL_CONTEXT_HANDLE ctx = emscripten_webgl_create_context("#canvas", &attrs);
    if (ctx <= 0) { printf("[gl] create_context failed: %d\n", (int)ctx); return false; }
    emscripten_webgl_make_context_current(ctx);

    int version = gladLoadGLES2((GLADloadfunc)emscripten_webgl_get_proc_address);
    printf("[gl] gladLoadGLES2 -> %d.%d ES3.0=%d\n", GLAD_VERSION_MAJOR(version), GLAD_VERSION_MINOR(version), (int)GLAD_GL_ES_VERSION_3_0);
    printf("[gl] %s | %s | %s\n", glGetString(GL_VENDOR), glGetString(GL_RENDERER), glGetString(GL_VERSION));
    printf("[gl] anisotropic=%d s3tc=%d\n", (int)GLAD_GL_EXT_texture_filter_anisotropic, (int)GLAD_GL_EXT_texture_compression_s3tc);
    const bool hasBaseVertex = emscripten_webgl_enable_extension(ctx, "WEBGL_draw_instanced_base_vertex_base_instance");
    printf("[gl] WEBGL_draw_instanced_base_vertex_base_instance=%d\n", (int)hasBaseVertex);
    if (hasBaseVertex)
        g_drawBaseVertex = glDrawElementsInstancedBaseVertexBaseInstanceWEBGL;

    const char* vs =
        "#version 300 es\n"
        "layout(location=0) in vec2 pos; layout(location=1) in vec3 col; uniform float angle; out vec3 v_col;\n"
        "void main(){ float c=cos(angle), s=sin(angle); gl_Position=vec4(mat2(c,s,-s,c)*pos,0.0,1.0); v_col=col; }";
    const char* fs =
        "#version 300 es\nprecision highp float; in vec3 v_col; layout(location=0) out vec4 SV_Target;\n"
        "void main(){ SV_Target=vec4(v_col,1.0); }";
    g_program = glCreateProgram();
    glAttachShader(g_program, compile(GL_VERTEX_SHADER, vs));
    glAttachShader(g_program, compile(GL_FRAGMENT_SHADER, fs));
    glLinkProgram(g_program);
    GLint linked = 0;
    glGetProgramiv(g_program, GL_LINK_STATUS, &linked);
    printf("[gl] program linked=%d\n", linked);

    // Two triangles in one buffer; the second is reached only through baseVertex=3.
    const float verts[] = {
        -0.5f, -0.5f, 1, 0, 0,  0.5f, -0.5f, 0, 1, 0,  0.0f, 0.5f, 0, 0, 1,
        -0.9f,  0.6f, 1, 1, 0, -0.6f,  0.6f, 0, 1, 1, -0.75f, 0.9f, 1, 0, 1,
    };
    const unsigned short idx[] = { 0, 1, 2 };
    glGenVertexArrays(1, &g_vao);
    glBindVertexArray(g_vao);
    glGenBuffers(1, &g_vbo);
    glBindBuffer(GL_ARRAY_BUFFER, g_vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof verts, verts, GL_STATIC_DRAW);
    glGenBuffers(1, &g_ibo);
    glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, g_ibo);
    glBufferData(GL_ELEMENT_ARRAY_BUFFER, sizeof idx, idx, GL_STATIC_DRAW);
    glEnableVertexAttribArray(0);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 20, (void*)0);
    glEnableVertexAttribArray(1);
    glVertexAttribPointer(1, 3, GL_FLOAT, GL_FALSE, 20, (void*)8);
    return true;
}

static void frame(void*)
{
    emscripten_current_thread_process_queued_calls();
    ++g_frame;
    if (g_frame <= 5)
        printf("[loop] frame %d t=%.0f\n", g_frame, emscripten_get_now());
    if (g_frame == 180)
    {
        printf("[loop] switching to EM_TIMING_SETTIMEOUT\n");
        emscripten_set_main_loop_timing(EM_TIMING_SETTIMEOUT, 16);
    }

    SDL_PumpEvents();
    SDL_Event ev;
    while (SDL_PollEvent(&ev))
    {
        switch (ev.type)
        {
        case SDL_KEYDOWN: printf("[in] key %s\n", SDL_GetScancodeName(ev.key.keysym.scancode)); break;
        case SDL_MOUSEMOTION:
            if (g_frame % 10 == 0) printf("[in] motion abs=%d,%d rel=%d,%d\n", ev.motion.x, ev.motion.y, ev.motion.xrel, ev.motion.yrel);
            break;
        case SDL_MOUSEBUTTONDOWN:
            printf("[in] button %d\n", ev.button.button);
            if (!g_relative)
            {
                int rc = SDL_SetRelativeMouseMode(SDL_TRUE);
                printf("[in] SDL_SetRelativeMouseMode -> %d (%s)\n", rc, SDL_GetError());
                g_relative = true;
            }
            break;
        case SDL_MOUSEWHEEL: printf("[in] wheel %d\n", ev.wheel.y); break;
        case SDL_WINDOWEVENT: printf("[in] window event %d\n", ev.window.event); break;
        case SDL_TEXTINPUT: printf("[in] text %s\n", ev.text.text); break;
        }
    }

    {
        std::lock_guard<std::mutex> lock(g_mutex);
        ++g_generation;
    }
    g_cv.notify_all();

    glViewport(0, 0, 800, 450);
    glClearColor(0.1f, 0.1f, 0.15f, 1.0f);
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);
    glUseProgram(g_program);
    glUniform1f(glGetUniformLocation(g_program, "angle"), g_frame * 0.01f);
    glBindVertexArray(g_vao);
    glDrawElements(GL_TRIANGLES, 3, GL_UNSIGNED_SHORT, nullptr);
    if (g_drawBaseVertex)
        g_drawBaseVertex(GL_TRIANGLES, 3, GL_UNSIGNED_SHORT, nullptr, 1, 3, 0);

    if (g_frame % 120 == 0)
        printf("[loop] frame %d workerHits=%d relative=%d glError=0x%x\n", g_frame, g_workerHits, (int)SDL_GetRelativeMouseMode(), glGetError());
}

int main()
{
    printf("[spike] main on thread %p, hardware_concurrency=%u\n", (void*)pthread_self(), std::thread::hardware_concurrency());
    test_opfs();
    test_memory64();
    start_workers();

    if (SDL_Init(SDL_INIT_VIDEO) != 0) { printf("[sdl] init failed: %s\n", SDL_GetError()); return 1; }
    g_window = SDL_CreateWindow("spike", 0, 0, 800, 450, SDL_WINDOW_RESIZABLE);
    printf("[sdl] window=%p (%s)\n", (void*)g_window, SDL_GetError());
    if (!init_gl()) return 1;

    emscripten_set_main_loop_arg(frame, nullptr, 60, 0);
    printf("[spike] main done, keeping the thread alive for the loop\n");
    emscripten_exit_with_live_runtime();
    return 0;
}
