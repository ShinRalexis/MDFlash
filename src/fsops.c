/* MDFlash: operazioni sui file (lettura con riconoscimento della codifica,
 * scrittura sicura, elenco cartelle, ricerca, cestino, versioni). */
#include "app.h"

/* ---------- lettura ---------- */

static unsigned char *read_all(const wchar_t *path, size_t *len, DWORD *err)
{
    HANDLE h = CreateFileW(path, GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                           NULL, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) { *err = GetLastError(); return NULL; }
    LARGE_INTEGER size;
    if (!GetFileSizeEx(h, &size) || size.QuadPart > 512LL * 1024 * 1024) {
        *err = ERROR_FILE_TOO_LARGE; CloseHandle(h); return NULL;
    }
    unsigned char *buf = (unsigned char *)malloc((size_t)size.QuadPart + 4);
    DWORD got = 0, total = 0;
    while (buf && total < (DWORD)size.QuadPart) {
        if (!ReadFile(h, buf + total, (DWORD)size.QuadPart - total, &got, NULL) || got == 0) break;
        total += got;
    }
    CloseHandle(h);
    if (!buf) { *err = ERROR_OUTOFMEMORY; return NULL; }
    memset(buf + total, 0, 4);
    *len = total;
    return buf;
}

static void add_mtime(cJSON *o, const wchar_t *path)
{
    WIN32_FILE_ATTRIBUTE_DATA fa;
    if (GetFileAttributesExW(path, GetFileExInfoStandard, &fa)) {
        cJSON_AddNumberToObject(o, "mtime", (double)filetime_to_ms(&fa.ftLastWriteTime));
        ULARGE_INTEGER s; s.LowPart = fa.nFileSizeLow; s.HighPart = fa.nFileSizeHigh;
        cJSON_AddNumberToObject(o, "size", (double)s.QuadPart);
    }
}

static cJSON *error_obj(DWORD err)
{
    cJSON *o = cJSON_CreateObject();
    char *m = last_error_utf8(err);
    cJSON_AddStringToObject(o, "error", m ? m : "errore");
    cJSON_AddNumberToObject(o, "code", (double)err);
    free(m);
    return o;
}

/* Converte il contenuto grezzo in UTF-8 e riconosce codifica e fine riga. */
static char *decode_text(unsigned char *buf, size_t len, const char **encoding, BOOL *bom)
{
    *bom = FALSE;
    if (len >= 3 && buf[0] == 0xEF && buf[1] == 0xBB && buf[2] == 0xBF) {
        *encoding = "utf-8"; *bom = TRUE;
        char *s = (char *)malloc(len - 2);
        memcpy(s, buf + 3, len - 3); s[len - 3] = 0;
        return s;
    }
    if (len >= 2 && ((buf[0] == 0xFF && buf[1] == 0xFE) || (buf[0] == 0xFE && buf[1] == 0xFF))) {
        BOOL be = buf[0] == 0xFE;
        *encoding = be ? "utf-16be" : "utf-16le"; *bom = TRUE;
        size_t n = (len - 2) / 2;
        wchar_t *w = (wchar_t *)malloc((n + 1) * sizeof(wchar_t));
        for (size_t i = 0; i < n; i++) {
            unsigned char a = buf[2 + i * 2], b = buf[3 + i * 2];
            w[i] = be ? (wchar_t)(a << 8 | b) : (wchar_t)(b << 8 | a);
        }
        w[n] = 0;
        char *s = wide_to_utf8_n(w, (int)n);
        free(w);
        return s;
    }
    /* UTF-8 valido? */
    if (len == 0 || MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, (char *)buf, (int)len, NULL, 0) > 0) {
        *encoding = "utf-8";
        char *s = (char *)malloc(len + 1);
        memcpy(s, buf, len); s[len] = 0;
        return s;
    }
    /* Altrimenti la codepage di sistema (di solito Windows-1252) */
    *encoding = "ansi";
    int n = MultiByteToWideChar(CP_ACP, 0, (char *)buf, (int)len, NULL, 0);
    wchar_t *w = (wchar_t *)malloc(((size_t)n + 1) * sizeof(wchar_t));
    MultiByteToWideChar(CP_ACP, 0, (char *)buf, (int)len, w, n);
    char *s = wide_to_utf8_n(w, n);
    free(w);
    return s;
}

/* Normalizza i fine riga a \n; restituisce "crlf" se prevalevano i CRLF. */
static const char *normalize_eol(char *s)
{
    size_t crlf = 0, lf = 0;
    char *r = s, *w = s;
    while (*r) {
        if (r[0] == '\r' && r[1] == '\n') { crlf++; *w++ = '\n'; r += 2; }
        else if (r[0] == '\r') { *w++ = '\n'; r++; }
        else { if (*r == '\n') lf++; *w++ = *r++; }
    }
    *w = 0;
    return crlf > lf ? "crlf" : "lf";
}

cJSON *fs_read_text(const wchar_t *path)
{
    size_t len = 0; DWORD err = 0;
    unsigned char *buf = read_all(path, &len, &err);
    if (!buf) return error_obj(err);
    const char *enc; BOOL bom;
    char *text = decode_text(buf, len, &enc, &bom);
    free(buf);
    const char *eol = normalize_eol(text);
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "text", text);
    cJSON_AddStringToObject(o, "encoding", enc);
    cJSON_AddBoolToObject(o, "bom", bom);
    cJSON_AddStringToObject(o, "eol", eol);
    add_mtime(o, path);
    free(text);
    return o;
}

/* ---------- scrittura ---------- */

static BOOL write_all(const wchar_t *path, const void *data, size_t len, DWORD *err)
{
    HANDLE h = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, NULL);
    if (h == INVALID_HANDLE_VALUE) { *err = GetLastError(); return FALSE; }
    DWORD put = 0; size_t done = 0; BOOL ok = TRUE;
    while (done < len) {
        DWORD chunk = (DWORD)((len - done) > 0x10000000 ? 0x10000000 : (len - done));
        if (!WriteFile(h, (const char *)data + done, chunk, &put, NULL)) { ok = FALSE; *err = GetLastError(); break; }
        done += put;
    }
    if (ok) FlushFileBuffers(h);
    CloseHandle(h);
    return ok;
}

/* Scrive in un file temporaneo accanto e poi lo sostituisce: se qualcosa va
 * storto a metà, il file originale resta intatto. */
static BOOL write_atomic(const wchar_t *path, const void *data, size_t len, DWORD *err)
{
    wchar_t tmp[MAX_PATH * 2];
    _snwprintf(tmp, MAX_PATH * 2, L"%s.mdflash-tmp", path);
    tmp[MAX_PATH * 2 - 1] = 0;
    if (!write_all(tmp, data, len, err)) {
        /* cartelle in cui non si possono creare altri file: scrittura diretta */
        DeleteFileW(tmp);
        return write_all(path, data, len, err);
    }
    if (GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES) {
        if (ReplaceFileW(path, tmp, NULL, REPLACEFILE_IGNORE_MERGE_ERRORS, NULL, NULL)) return TRUE;
    }
    if (MoveFileExW(tmp, path, MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) return TRUE;
    *err = GetLastError();
    DeleteFileW(tmp);
    return write_all(path, data, len, err);
}

cJSON *fs_write_text(const wchar_t *path, const char *utf8, const char *encoding, BOOL bom, const char *eol)
{
    BOOL crlf = eol && strcmp(eol, "crlf") == 0;
    /* Converte \n in \r\n se richiesto */
    size_t n = strlen(utf8), extra = 0;
    if (crlf) for (size_t i = 0; i < n; i++) if (utf8[i] == '\n' && (i == 0 || utf8[i - 1] != '\r')) extra++;
    char *s = (char *)malloc(n + extra + 1);
    size_t o = 0;
    for (size_t i = 0; i < n; i++) {
        if (crlf && utf8[i] == '\n' && (i == 0 || utf8[i - 1] != '\r')) s[o++] = '\r';
        s[o++] = utf8[i];
    }
    s[o] = 0;

    void *out = NULL; size_t outLen = 0; BOOL ok; DWORD err = 0;
    if (encoding && strncmp(encoding, "utf-16", 6) == 0) {
        BOOL be = strcmp(encoding, "utf-16be") == 0;
        wchar_t *w = utf8_to_wide(s);
        size_t wn = wcslen(w);
        unsigned char *b = (unsigned char *)malloc(wn * 2 + 2);
        b[0] = be ? 0xFE : 0xFF; b[1] = be ? 0xFF : 0xFE;
        for (size_t i = 0; i < wn; i++) {
            b[2 + i * 2] = be ? (unsigned char)(w[i] >> 8) : (unsigned char)(w[i] & 0xFF);
            b[3 + i * 2] = be ? (unsigned char)(w[i] & 0xFF) : (unsigned char)(w[i] >> 8);
        }
        free(w);
        out = b; outLen = wn * 2 + 2;
    } else if (encoding && strcmp(encoding, "ansi") == 0) {
        wchar_t *w = utf8_to_wide(s);
        int an = WideCharToMultiByte(CP_ACP, 0, w, -1, NULL, 0, NULL, NULL);
        char *a = (char *)malloc((size_t)an);
        WideCharToMultiByte(CP_ACP, 0, w, -1, a, an, NULL, NULL);
        free(w);
        out = a; outLen = an > 0 ? (size_t)an - 1 : 0;
    } else if (bom) {
        unsigned char *b = (unsigned char *)malloc(o + 3);
        b[0] = 0xEF; b[1] = 0xBB; b[2] = 0xBF;
        memcpy(b + 3, s, o);
        out = b; outLen = o + 3;
    } else {
        out = s; outLen = o; s = NULL;
    }
    ok = write_atomic(path, out, outLen, &err);
    free(out); free(s);
    if (!ok) return error_obj(err);
    cJSON *r = cJSON_CreateObject();
    add_mtime(r, path);
    return r;
}

cJSON *fs_write_binary(const wchar_t *path, const unsigned char *data, size_t len)
{
    wchar_t dir[MAX_PATH * 2];
    wcsncpy(dir, path, MAX_PATH * 2 - 1); dir[MAX_PATH * 2 - 1] = 0;
    PathRemoveFileSpecW(dir);
    ensure_dir(dir);
    DWORD err = 0;
    if (!write_all(path, data, len, &err)) return error_obj(err);
    cJSON *r = cJSON_CreateObject();
    add_mtime(r, path);
    return r;
}

cJSON *fs_stat(const wchar_t *path)
{
    WIN32_FILE_ATTRIBUTE_DATA fa;
    cJSON *o = cJSON_CreateObject();
    if (!GetFileAttributesExW(path, GetFileExInfoStandard, &fa)) {
        cJSON_AddBoolToObject(o, "exists", 0);
        return o;
    }
    cJSON_AddBoolToObject(o, "exists", 1);
    cJSON_AddBoolToObject(o, "dir", (fa.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0);
    cJSON_AddBoolToObject(o, "readonly", (fa.dwFileAttributes & FILE_ATTRIBUTE_READONLY) != 0);
    add_mtime(o, path);
    return o;
}

/* ---------- elenchi ---------- */

static BOOL skip_name(const wchar_t *n)
{
    return wcscmp(n, L".") == 0 || wcscmp(n, L"..") == 0;
}

static BOOL is_text_doc(const wchar_t *name)
{
    const wchar_t *ext = PathFindExtensionW(name);
    static const wchar_t *exts[] = { L".md", L".markdown", L".mdown", L".mkd", L".mkdn", L".mdx", L".txt", NULL };
    for (int i = 0; exts[i]; i++) if (_wcsicmp(ext, exts[i]) == 0) return TRUE;
    return FALSE;
}

cJSON *fs_list_dir(const wchar_t *path)
{
    wchar_t pat[MAX_PATH * 2];
    path_join(pat, MAX_PATH * 2, path, L"*");
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileExW(pat, FindExInfoBasic, &fd, FindExSearchNameMatch, NULL, FIND_FIRST_EX_LARGE_FETCH);
    if (h == INVALID_HANDLE_VALUE) return error_obj(GetLastError());
    cJSON *o = cJSON_CreateObject();
    cJSON *arr = cJSON_AddArrayToObject(o, "entries");
    do {
        if (skip_name(fd.cFileName)) continue;
        if (fd.dwFileAttributes & (FILE_ATTRIBUTE_SYSTEM)) continue;
        cJSON *e = cJSON_CreateObject();
        char *n = wide_to_utf8(fd.cFileName);
        cJSON_AddStringToObject(e, "name", n);
        free(n);
        cJSON_AddBoolToObject(e, "dir", (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) != 0);
        cJSON_AddBoolToObject(e, "hidden", (fd.dwFileAttributes & FILE_ATTRIBUTE_HIDDEN) != 0 || fd.cFileName[0] == L'.');
        cJSON_AddNumberToObject(e, "mtime", (double)filetime_to_ms(&fd.ftLastWriteTime));
        ULARGE_INTEGER s; s.LowPart = fd.nFileSizeLow; s.HighPart = fd.nFileSizeHigh;
        cJSON_AddNumberToObject(e, "size", (double)s.QuadPart);
        cJSON_AddItemToArray(arr, e);
    } while (FindNextFileW(h, &fd));
    FindClose(h);
    return o;
}

static BOOL skip_dir(const WIN32_FIND_DATAW *fd)
{
    const wchar_t *n = fd->cFileName;
    if (n[0] == L'.') return TRUE; /* .git, .obsidian, .trash ... */
    if (_wcsicmp(n, L"node_modules") == 0) return TRUE;
    if (fd->dwFileAttributes & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM | FILE_ATTRIBUTE_REPARSE_POINT)) return TRUE;
    return FALSE;
}

typedef void (*walk_fn)(const wchar_t *full, const wchar_t *rel, const WIN32_FIND_DATAW *fd, void *ctx);

/* Visita ricorsiva dei documenti di testo; si ferma se *stop diventa vero. */
static void walk(const wchar_t *root, const wchar_t *rel, int depth, walk_fn fn, void *ctx, int *stop)
{
    if (depth > 24 || *stop) return;
    wchar_t dir[MAX_PATH * 2], pat[MAX_PATH * 2];
    if (rel[0]) path_join(dir, MAX_PATH * 2, root, rel); else wcsncpy(dir, root, MAX_PATH * 2);
    dir[MAX_PATH * 2 - 1] = 0;
    path_join(pat, MAX_PATH * 2, dir, L"*");
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileExW(pat, FindExInfoBasic, &fd, FindExSearchNameMatch, NULL, FIND_FIRST_EX_LARGE_FETCH);
    if (h == INVALID_HANDLE_VALUE) return;
    do {
        if (skip_name(fd.cFileName)) continue;
        wchar_t subRel[MAX_PATH * 2], full[MAX_PATH * 2];
        if (rel[0]) path_join(subRel, MAX_PATH * 2, rel, fd.cFileName); else wcsncpy(subRel, fd.cFileName, MAX_PATH * 2);
        subRel[MAX_PATH * 2 - 1] = 0;
        path_join(full, MAX_PATH * 2, dir, fd.cFileName);
        if (fd.dwFileAttributes & FILE_ATTRIBUTE_DIRECTORY) {
            if (!skip_dir(&fd)) walk(root, subRel, depth + 1, fn, ctx, stop);
        } else if (is_text_doc(fd.cFileName)) {
            fn(full, subRel, &fd, ctx);
        }
    } while (!*stop && FindNextFileW(h, &fd));
    FindClose(h);
}

typedef struct { cJSON *arr; int count, max; int *stop; } TreeCtx;

static void tree_cb(const wchar_t *full, const wchar_t *rel, const WIN32_FIND_DATAW *fd, void *p)
{
    TreeCtx *c = (TreeCtx *)p;
    cJSON *e = cJSON_CreateObject();
    char *f = wide_to_utf8(full), *r = wide_to_utf8(rel);
    cJSON_AddStringToObject(e, "path", f);
    cJSON_AddStringToObject(e, "rel", r);
    cJSON_AddNumberToObject(e, "mtime", (double)filetime_to_ms(&fd->ftLastWriteTime));
    free(f); free(r);
    cJSON_AddItemToArray(c->arr, e);
    if (++c->count >= c->max) *c->stop = 1;
}

cJSON *fs_list_tree(const wchar_t *root, int maxFiles)
{
    cJSON *o = cJSON_CreateObject();
    int stop = 0;
    TreeCtx c = { cJSON_AddArrayToObject(o, "files"), 0, maxFiles > 0 ? maxFiles : 5000, &stop };
    walk(root, L"", 0, tree_cb, &c, &stop);
    cJSON_AddBoolToObject(o, "truncated", stop != 0);
    return o;
}

/* ---------- ricerca nel testo dei file ---------- */

typedef struct {
    cJSON *arr; const wchar_t *needle; size_t needleLen; BOOL cs;
    int total, max; int *stop;
} SearchCtx;

static void search_cb(const wchar_t *full, const wchar_t *rel, const WIN32_FIND_DATAW *fd, void *p)
{
    SearchCtx *c = (SearchCtx *)p;
    (void)fd;
    size_t len; DWORD err;
    unsigned char *buf = read_all(full, &len, &err);
    if (!buf) return;
    const char *enc; BOOL bom;
    char *u = decode_text(buf, len, &enc, &bom);
    free(buf);
    wchar_t *text = utf8_to_wide(u);
    free(u);
    if (!text) return;
    size_t tlen = wcslen(text);
    wchar_t *hay = text;
    if (!c->cs) {
        hay = (wchar_t *)malloc((tlen + 1) * sizeof(wchar_t));
        memcpy(hay, text, (tlen + 1) * sizeof(wchar_t));
        CharLowerBuffW(hay, (DWORD)tlen);
    }
    cJSON *matches = NULL;
    int inFile = 0;
    /* Il nome del file conta come corrispondenza */
    wchar_t nameLow[MAX_PATH];
    wcsncpy(nameLow, PathFindFileNameW(full), MAX_PATH - 1); nameLow[MAX_PATH - 1] = 0;
    if (!c->cs) CharLowerBuffW(nameLow, (DWORD)wcslen(nameLow));
    BOOL nameHit = wcsstr(nameLow, c->needle) != NULL;

    const wchar_t *pos = hay;
    while ((pos = wcsstr(pos, c->needle)) != NULL && inFile < 30) {
        size_t off = (size_t)(pos - hay);
        size_t ls = off; while (ls > 0 && text[ls - 1] != L'\n') ls--;
        size_t le = off; while (le < tlen && text[le] != L'\n') le++;
        int line = 1; for (size_t i = 0; i < ls; i++) if (text[i] == L'\n') line++;
        /* Frammento di al massimo ~160 caratteri attorno alla corrispondenza */
        size_t from = ls, to = le;
        if (off - from > 60) from = off - 60;
        if (to - off > 100) to = off + 100;
        if (!matches) matches = cJSON_CreateArray();
        cJSON *m = cJSON_CreateObject();
        char *snip = wide_to_utf8_n(text + from, (int)(to - from));
        cJSON_AddNumberToObject(m, "line", line);
        cJSON_AddStringToObject(m, "text", snip);
        cJSON_AddNumberToObject(m, "col", (double)(off - from));
        cJSON_AddNumberToObject(m, "len", (double)c->needleLen);
        cJSON_AddBoolToObject(m, "cut", from > ls);
        free(snip);
        cJSON_AddItemToArray(matches, m);
        inFile++;
        pos += c->needleLen;
    }
    if (matches || nameHit) {
        cJSON *e = cJSON_CreateObject();
        char *f = wide_to_utf8(full), *r = wide_to_utf8(rel);
        cJSON_AddStringToObject(e, "path", f);
        cJSON_AddStringToObject(e, "rel", r);
        free(f); free(r);
        cJSON_AddItemToObject(e, "matches", matches ? matches : cJSON_CreateArray());
        cJSON_AddItemToArray(c->arr, e);
        c->total += inFile ? inFile : 1;
        if (c->total >= c->max) *c->stop = 1;
    }
    if (hay != text) free(hay);
    free(text);
}

cJSON *fs_search(const wchar_t *root, const char *query, BOOL caseSensitive, int maxResults)
{
    cJSON *o = cJSON_CreateObject();
    wchar_t *needle = utf8_to_wide(query);
    if (!needle || !needle[0]) { free(needle); cJSON_AddArrayToObject(o, "results"); return o; }
    if (!caseSensitive) CharLowerBuffW(needle, (DWORD)wcslen(needle));
    int stop = 0;
    SearchCtx c = { cJSON_AddArrayToObject(o, "results"), needle, wcslen(needle), caseSensitive, 0,
                    maxResults > 0 ? maxResults : 500, &stop };
    walk(root, L"", 0, search_cb, &c, &stop);
    cJSON_AddBoolToObject(o, "truncated", stop != 0);
    free(needle);
    return o;
}

/* ---------- gestione file ---------- */

static cJSON *ok_obj(void)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddBoolToObject(o, "ok", 1);
    return o;
}

cJSON *fs_copy(const wchar_t *src, const wchar_t *dst, BOOL overwrite)
{
    wchar_t dir[MAX_PATH * 2];
    wcsncpy(dir, dst, MAX_PATH * 2 - 1); dir[MAX_PATH * 2 - 1] = 0;
    PathRemoveFileSpecW(dir);
    ensure_dir(dir);
    if (!CopyFileW(src, dst, !overwrite)) return error_obj(GetLastError());
    return ok_obj();
}

cJSON *fs_rename(const wchar_t *src, const wchar_t *dst)
{
    if (GetFileAttributesW(dst) != INVALID_FILE_ATTRIBUTES && _wcsicmp(src, dst) != 0)
        return error_obj(ERROR_ALREADY_EXISTS);
    if (!MoveFileExW(src, dst, MOVEFILE_COPY_ALLOWED)) return error_obj(GetLastError());
    return ok_obj();
}

cJSON *fs_trash(const wchar_t *path)
{
    /* SHFileOperation vuole una lista terminata da due zeri */
    size_t n = wcslen(path);
    wchar_t *from = (wchar_t *)calloc(n + 2, sizeof(wchar_t));
    wcscpy(from, path);
    SHFILEOPSTRUCTW op = { 0 };
    op.hwnd = g.hwnd;
    op.wFunc = FO_DELETE;
    op.pFrom = from;
    op.fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI;
    int r = SHFileOperationW(&op);
    free(from);
    if (r != 0 || op.fAnyOperationsAborted) return error_obj(r ? (DWORD)r : ERROR_CANCELLED);
    return ok_obj();
}

cJSON *fs_mkdir(const wchar_t *path)
{
    int r = SHCreateDirectoryExW(NULL, path, NULL);
    if (r != ERROR_SUCCESS && r != ERROR_ALREADY_EXISTS) return error_obj((DWORD)r);
    return ok_obj();
}

/* ---------- cronologia delle versioni ----------
 * Ogni documento ha una cartella in %APPDATA%\MDFlash\versions\<hash del percorso>
 * con una copia per ogni salvataggio (le più vecchie oltre "keep" vengono tolte). */

static void snapshot_dir(const wchar_t *docPath, wchar_t *out, size_t cap)
{
    wchar_t low[MAX_PATH * 2];
    wcsncpy(low, docPath, MAX_PATH * 2 - 1); low[MAX_PATH * 2 - 1] = 0;
    CharLowerBuffW(low, (DWORD)wcslen(low));
    unsigned long long h = 1469598103934665603ULL;
    for (const wchar_t *p = low; *p; p++) { h ^= (unsigned)*p; h *= 1099511628211ULL; }
    wchar_t sub[64];
    _snwprintf(sub, 64, L"versions\\%016llx", h);
    sub[63] = 0;
    path_join(out, cap, g.roamingDir, sub);
}

static int cmp_desc(const void *a, const void *b)
{
    return -wcscmp(*(const wchar_t **)a, *(const wchar_t **)b);
}

/* Restituisce i nomi delle versioni (più recenti prima); *count elementi da liberare. */
static wchar_t **collect_snapshots(const wchar_t *dir, int *count)
{
    wchar_t pat[MAX_PATH * 2];
    path_join(pat, MAX_PATH * 2, dir, L"*.md");
    WIN32_FIND_DATAW fd;
    int cap = 64, n = 0;
    wchar_t **names = (wchar_t **)malloc(sizeof(wchar_t *) * (size_t)cap);
    HANDLE h = FindFirstFileW(pat, &fd);
    if (h != INVALID_HANDLE_VALUE) {
        do {
            if (n == cap) { cap *= 2; names = (wchar_t **)realloc(names, sizeof(wchar_t *) * (size_t)cap); }
            names[n++] = _wcsdup(fd.cFileName);
        } while (FindNextFileW(h, &fd));
        FindClose(h);
    }
    qsort(names, (size_t)n, sizeof(wchar_t *), cmp_desc);
    *count = n;
    return names;
}

cJSON *fs_snapshot(const wchar_t *docPath, const char *utf8, int keep)
{
    wchar_t dir[MAX_PATH * 2];
    snapshot_dir(docPath, dir, MAX_PATH * 2);
    ensure_dir(dir);
    /* Annota a quale file appartiene la cartella */
    wchar_t info[MAX_PATH * 2];
    path_join(info, MAX_PATH * 2, dir, L"source.txt");
    if (GetFileAttributesW(info) == INVALID_FILE_ATTRIBUTES) {
        char *p = wide_to_utf8(docPath);
        DWORD e; write_all(info, p, strlen(p), &e);
        free(p);
    }
    int n = 0;
    wchar_t **names = collect_snapshots(dir, &n);
    /* Nessuna copia se il contenuto è identico all'ultima versione */
    BOOL same = FALSE;
    if (n > 0) {
        wchar_t last[MAX_PATH * 2];
        path_join(last, MAX_PATH * 2, dir, names[0]);
        size_t len; DWORD e;
        unsigned char *b = read_all(last, &len, &e);
        if (b) { same = len == strlen(utf8) && memcmp(b, utf8, len) == 0; free(b); }
    }
    cJSON *o = cJSON_CreateObject();
    if (!same) {
        SYSTEMTIME st; GetLocalTime(&st);
        wchar_t name[64], full[MAX_PATH * 2];
        _snwprintf(name, 64, L"%04d%02d%02d-%02d%02d%02d-%03d.md", st.wYear, st.wMonth, st.wDay,
                   st.wHour, st.wMinute, st.wSecond, st.wMilliseconds);
        name[63] = 0;
        path_join(full, MAX_PATH * 2, dir, name);
        DWORD e; write_all(full, utf8, strlen(utf8), &e);
    }
    for (int i = 0; i < n; i++) free(names[i]);
    free(names);
    /* Oltre il limite si cancellano le più vecchie (l'elenco è decrescente) */
    names = collect_snapshots(dir, &n);
    for (int i = 0; i < n; i++) {
        if (i >= keep) {
            wchar_t full[MAX_PATH * 2];
            path_join(full, MAX_PATH * 2, dir, names[i]);
            DeleteFileW(full);
        }
        free(names[i]);
    }
    free(names);
    cJSON_AddBoolToObject(o, "saved", !same);
    return o;
}

cJSON *fs_list_snapshots(const wchar_t *docPath)
{
    wchar_t dir[MAX_PATH * 2];
    snapshot_dir(docPath, dir, MAX_PATH * 2);
    int n = 0;
    wchar_t **names = collect_snapshots(dir, &n);
    cJSON *o = cJSON_CreateObject();
    cJSON *arr = cJSON_AddArrayToObject(o, "versions");
    for (int i = 0; i < n; i++) {
        wchar_t full[MAX_PATH * 2];
        path_join(full, MAX_PATH * 2, dir, names[i]);
        cJSON *e = cJSON_CreateObject();
        char *p = wide_to_utf8(full), *nm = wide_to_utf8(names[i]);
        cJSON_AddStringToObject(e, "path", p);
        cJSON_AddStringToObject(e, "name", nm);
        free(p); free(nm);
        add_mtime(e, full);
        cJSON_AddItemToArray(arr, e);
        free(names[i]);
    }
    free(names);
    return o;
}
