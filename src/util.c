/* MDFlash: piccole utilità (conversioni di testo, base64, JSON, percorsi). */
#include "app.h"

wchar_t *utf8_to_wide(const char *s)
{
    if (!s) s = "";
    int n = MultiByteToWideChar(CP_UTF8, 0, s, -1, NULL, 0);
    wchar_t *w = (wchar_t *)malloc((size_t)(n > 0 ? n : 1) * sizeof(wchar_t));
    if (!w) return NULL;
    if (n > 0) MultiByteToWideChar(CP_UTF8, 0, s, -1, w, n);
    else w[0] = 0;
    return w;
}

char *wide_to_utf8_n(const wchar_t *s, int len)
{
    if (!s) { s = L""; len = 0; }
    int n = WideCharToMultiByte(CP_UTF8, 0, s, len, NULL, 0, NULL, NULL);
    char *u = (char *)malloc((size_t)n + 1);
    if (!u) return NULL;
    if (n > 0) WideCharToMultiByte(CP_UTF8, 0, s, len, u, n, NULL, NULL);
    u[n] = 0;
    return u;
}

char *wide_to_utf8(const wchar_t *s)
{
    return wide_to_utf8_n(s, s ? (int)wcslen(s) : 0);
}

static const char B64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

char *base64_encode(const unsigned char *in, size_t len)
{
    size_t outLen = 4 * ((len + 2) / 3);
    char *out = (char *)malloc(outLen + 1);
    if (!out) return NULL;
    size_t i = 0, o = 0;
    while (i + 2 < len) {
        unsigned v = (unsigned)in[i] << 16 | (unsigned)in[i + 1] << 8 | in[i + 2];
        out[o++] = B64[(v >> 18) & 63]; out[o++] = B64[(v >> 12) & 63];
        out[o++] = B64[(v >> 6) & 63];  out[o++] = B64[v & 63];
        i += 3;
    }
    if (i < len) {
        unsigned v = (unsigned)in[i] << 16 | (i + 1 < len ? (unsigned)in[i + 1] << 8 : 0);
        out[o++] = B64[(v >> 18) & 63]; out[o++] = B64[(v >> 12) & 63];
        out[o++] = (i + 1 < len) ? B64[(v >> 6) & 63] : '=';
        out[o++] = '=';
    }
    out[o] = 0;
    return out;
}

unsigned char *base64_decode(const char *in, size_t *outLen)
{
    static signed char T[256];
    static int init = 0;
    if (!init) {
        memset(T, -1, sizeof T);
        for (int i = 0; i < 64; i++) T[(unsigned char)B64[i]] = (signed char)i;
        T['-'] = 62; T['_'] = 63; /* variante URL */
        init = 1;
    }
    /* Salta un eventuale prefisso "data:...;base64," */
    const char *comma = strstr(in, ";base64,");
    if (comma) in = comma + 8;
    size_t len = strlen(in);
    unsigned char *out = (unsigned char *)malloc(len / 4 * 3 + 4);
    if (!out) return NULL;
    size_t o = 0; unsigned acc = 0; int bits = 0;
    for (size_t i = 0; i < len; i++) {
        signed char v = T[(unsigned char)in[i]];
        if (v < 0) continue; /* '=', spazi, a capo */
        acc = (acc << 6) | (unsigned)v; bits += 6;
        if (bits >= 8) { bits -= 8; out[o++] = (unsigned char)((acc >> bits) & 0xFF); }
    }
    *outLen = o;
    return out;
}

const char *json_str(const cJSON *obj, const char *key)
{
    const cJSON *it = cJSON_GetObjectItemCaseSensitive(obj, key);
    return cJSON_IsString(it) ? it->valuestring : NULL;
}

wchar_t *json_wstr(const cJSON *obj, const char *key)
{
    const char *s = json_str(obj, key);
    return s ? utf8_to_wide(s) : NULL;
}

int json_int(const cJSON *obj, const char *key, int def)
{
    const cJSON *it = cJSON_GetObjectItemCaseSensitive(obj, key);
    return cJSON_IsNumber(it) ? it->valueint : def;
}

double json_num(const cJSON *obj, const char *key, double def)
{
    const cJSON *it = cJSON_GetObjectItemCaseSensitive(obj, key);
    return cJSON_IsNumber(it) ? it->valuedouble : def;
}

BOOL json_bool(const cJSON *obj, const char *key, BOOL def)
{
    const cJSON *it = cJSON_GetObjectItemCaseSensitive(obj, key);
    if (cJSON_IsBool(it)) return cJSON_IsTrue(it);
    return def;
}

void path_join(wchar_t *out, size_t cap, const wchar_t *a, const wchar_t *b)
{
    size_t la = wcslen(a);
    if (la && (a[la - 1] == L'\\' || a[la - 1] == L'/'))
        _snwprintf(out, cap, L"%s%s", a, b);
    else
        _snwprintf(out, cap, L"%s\\%s", a, b);
    out[cap - 1] = 0;
}

void ensure_dir(const wchar_t *path)
{
    SHCreateDirectoryExW(NULL, path, NULL);
}

unsigned long long filetime_to_ms(const FILETIME *ft)
{
    ULARGE_INTEGER u;
    u.LowPart = ft->dwLowDateTime;
    u.HighPart = ft->dwHighDateTime;
    /* da intervalli di 100 ns dal 1601 a millisecondi dal 1970 */
    return (u.QuadPart - 116444736000000000ULL) / 10000ULL;
}

char *last_error_utf8(DWORD err)
{
    wchar_t *msg = NULL;
    FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM | FORMAT_MESSAGE_IGNORE_INSERTS,
                   NULL, err, 0, (LPWSTR)&msg, 0, NULL);
    char *u;
    if (msg) {
        size_t n = wcslen(msg);
        while (n && (msg[n - 1] == L'\r' || msg[n - 1] == L'\n' || msg[n - 1] == L' ')) msg[--n] = 0;
        u = wide_to_utf8(msg);
        LocalFree(msg);
    } else {
        u = (char *)malloc(32);
        if (u) snprintf(u, 32, "Errore %lu", (unsigned long)err);
    }
    return u;
}
