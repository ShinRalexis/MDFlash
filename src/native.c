/* MDFlash: funzioni native di Windows chiamate dalla pagina. */
#include "app.h"
#include <shobjidl.h>
#include <winhttp.h>

/* ---------- registro ---------- */

DWORD reg_get_dword(const wchar_t *name, DWORD def)
{
    DWORD v = def, sz = sizeof v;
    if (RegGetValueW(HKEY_CURRENT_USER, REG_KEY, name, RRF_RT_REG_DWORD, NULL, &v, &sz) != ERROR_SUCCESS) return def;
    return v;
}

void reg_set_dword(const wchar_t *name, DWORD v)
{
    RegSetKeyValueW(HKEY_CURRENT_USER, REG_KEY, name, REG_DWORD, &v, sizeof v);
}

void native_save_placement(void)
{
    WINDOWPLACEMENT wp = { sizeof wp };
    if (g.fullscreen) wp = g.prevPlacement;
    else GetWindowPlacement(g.hwnd, &wp);
    RegSetKeyValueW(HKEY_CURRENT_USER, REG_KEY, L"Placement", REG_BINARY, &wp, sizeof wp);
}

void native_load_placement(int nCmdShow)
{
    WINDOWPLACEMENT wp;
    DWORD sz = sizeof wp;
    if (RegGetValueW(HKEY_CURRENT_USER, REG_KEY, L"Placement", RRF_RT_REG_BINARY, NULL, &wp, &sz) == ERROR_SUCCESS
        && sz == sizeof wp && wp.length == sizeof wp) {
        /* La finestra deve cadere almeno in parte su un monitor esistente */
        if (MonitorFromRect(&wp.rcNormalPosition, MONITOR_DEFAULTTONULL)) {
            if (wp.showCmd == SW_SHOWMINIMIZED || wp.showCmd == SW_MINIMIZE) wp.showCmd = SW_SHOWNORMAL;
            if (nCmdShow == SW_SHOWMINNOACTIVE || nCmdShow == SW_MINIMIZE) wp.showCmd = (UINT)nCmdShow;
            SetWindowPlacement(g.hwnd, &wp);
            return;
        }
    }
    ShowWindow(g.hwnd, nCmdShow);
}

/* ---------- finestra ---------- */

void native_set_dark_titlebar(BOOL dark)
{
    BOOL v = dark;
    /* 20 = DWMWA_USE_IMMERSIVE_DARK_MODE (19 sulle prime build di Windows 10) */
    if (FAILED(DwmSetWindowAttribute(g.hwnd, 20, &v, sizeof v)))
        DwmSetWindowAttribute(g.hwnd, 19, &v, sizeof v);
    /* Colore della barra del titolo uguale allo sfondo del tema (Windows 11) */
    COLORREF cap = g.bgColor;
    DwmSetWindowAttribute(g.hwnd, 35 /* DWMWA_CAPTION_COLOR */, &cap, sizeof cap);
}

void native_toggle_fullscreen(void)
{
    if (!g.fullscreen) {
        g.prevPlacement.length = sizeof g.prevPlacement;
        GetWindowPlacement(g.hwnd, &g.prevPlacement);
        g.prevStyle = GetWindowLongPtrW(g.hwnd, GWL_STYLE);
        MONITORINFO mi = { sizeof mi };
        GetMonitorInfoW(MonitorFromWindow(g.hwnd, MONITOR_DEFAULTTONEAREST), &mi);
        g.fullscreen = TRUE;
        SetMenu(g.hwnd, NULL);
        SetWindowLongPtrW(g.hwnd, GWL_STYLE, g.prevStyle & ~(LONG_PTR)WS_OVERLAPPEDWINDOW);
        SetWindowPos(g.hwnd, HWND_TOP, mi.rcMonitor.left, mi.rcMonitor.top,
                     mi.rcMonitor.right - mi.rcMonitor.left, mi.rcMonitor.bottom - mi.rcMonitor.top,
                     SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    } else {
        g.fullscreen = FALSE;
        SetWindowLongPtrW(g.hwnd, GWL_STYLE, g.prevStyle);
        SetMenu(g.hwnd, g.menu);
        SetWindowPlacement(g.hwnd, &g.prevPlacement);
        SetWindowPos(g.hwnd, NULL, 0, 0, 0, 0,
                     SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_FRAMECHANGED);
    }
}

void native_set_topmost(BOOL on)
{
    g.topmost = on;
    SetWindowPos(g.hwnd, on ? HWND_TOPMOST : HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE);
}

/* Simula una combinazione di tasti verso l'editor (per Taglia/Copia/Incolla
 * dal menu: così valgono le stesse regole della tastiera). Es.: "ctrl+x". */
void native_send_keys(const char *combo)
{
    INPUT in[8];
    int n = 0;
    WORD mods[3]; int nm = 0;
    WORD key = 0;
    char buf[64];
    snprintf(buf, sizeof buf, "%s", combo);
    for (char *tok = strtok(buf, "+"); tok; tok = strtok(NULL, "+")) {
        if (_stricmp(tok, "ctrl") == 0) mods[nm++] = VK_CONTROL;
        else if (_stricmp(tok, "shift") == 0) mods[nm++] = VK_SHIFT;
        else if (_stricmp(tok, "alt") == 0) mods[nm++] = VK_MENU;
        else if (strlen(tok) == 1) key = (WORD)toupper((unsigned char)tok[0]);
    }
    if (!key) return;
    webview_focus();
    memset(in, 0, sizeof in);
    for (int i = 0; i < nm; i++) { in[n].type = INPUT_KEYBOARD; in[n].ki.wVk = mods[i]; n++; }
    in[n].type = INPUT_KEYBOARD; in[n].ki.wVk = key; n++;
    in[n].type = INPUT_KEYBOARD; in[n].ki.wVk = key; in[n].ki.dwFlags = KEYEVENTF_KEYUP; n++;
    for (int i = nm - 1; i >= 0; i--) { in[n].type = INPUT_KEYBOARD; in[n].ki.wVk = mods[i]; in[n].ki.dwFlags = KEYEVENTF_KEYUP; n++; }
    SendInput((UINT)n, in, sizeof(INPUT));
}

/* ---------- appunti ---------- */

/* Formato "HTML Format" di Windows: intestazione con gli scostamenti in byte. */
static char *make_cf_html(const char *html)
{
    const char *pre = "<html><body>\r\n<!--StartFragment-->";
    const char *post = "<!--EndFragment-->\r\n</body></html>";
    const char *hdrFmt = "Version:0.9\r\nStartHTML:%010d\r\nEndHTML:%010d\r\nStartFragment:%010d\r\nEndFragment:%010d\r\n";
    char hdr[256];
    int hdrLen = snprintf(hdr, sizeof hdr, hdrFmt, 0, 0, 0, 0);
    int startHtml = hdrLen;
    int startFrag = startHtml + (int)strlen(pre);
    int endFrag = startFrag + (int)strlen(html);
    int endHtml = endFrag + (int)strlen(post);
    snprintf(hdr, sizeof hdr, hdrFmt, startHtml, endHtml, startFrag, endFrag);
    char *out = (char *)malloc((size_t)endHtml + 1);
    snprintf(out, (size_t)endHtml + 1, "%s%s%s%s", hdr, pre, html, post);
    return out;
}

static BOOL put_clip(UINT fmt, const void *data, size_t len)
{
    HGLOBAL h = GlobalAlloc(GMEM_MOVEABLE, len);
    if (!h) return FALSE;
    memcpy(GlobalLock(h), data, len);
    GlobalUnlock(h);
    if (!SetClipboardData(fmt, h)) { GlobalFree(h); return FALSE; }
    return TRUE;
}

cJSON *native_clipboard_write(const char *text, const char *html)
{
    cJSON *o = cJSON_CreateObject();
    if (!OpenClipboard(g.hwnd)) { json_add_tr(o, "error", S_CLIPBOARD_BUSY); return o; }
    EmptyClipboard();
    if (text) {
        wchar_t *w = utf8_to_wide(text);
        put_clip(CF_UNICODETEXT, w, (wcslen(w) + 1) * sizeof(wchar_t));
        free(w);
    }
    if (html) {
        char *cf = make_cf_html(html);
        put_clip(RegisterClipboardFormatW(L"HTML Format"), cf, strlen(cf) + 1);
        free(cf);
    }
    CloseClipboard();
    cJSON_AddBoolToObject(o, "ok", 1);
    return o;
}

cJSON *native_clipboard_read(void)
{
    cJSON *o = cJSON_CreateObject();
    if (!OpenClipboard(g.hwnd)) return o;
    HANDLE h = GetClipboardData(CF_UNICODETEXT);
    if (h) {
        const wchar_t *w = (const wchar_t *)GlobalLock(h);
        if (w) { char *u = wide_to_utf8(w); cJSON_AddStringToObject(o, "text", u); free(u); }
        GlobalUnlock(h);
    }
    UINT cfHtml = RegisterClipboardFormatW(L"HTML Format");
    h = GetClipboardData(cfHtml);
    if (h) {
        const char *s = (const char *)GlobalLock(h);
        if (s) {
            const char *a = strstr(s, "<!--StartFragment-->");
            const char *b = strstr(s, "<!--EndFragment-->");
            if (a && b && b > a) {
                a += strlen("<!--StartFragment-->");
                char *frag = (char *)malloc((size_t)(b - a) + 1);
                memcpy(frag, a, (size_t)(b - a));
                frag[b - a] = 0;
                cJSON_AddStringToObject(o, "html", frag);
                free(frag);
            }
        }
        GlobalUnlock(h);
    }
    CloseClipboard();
    return o;
}

/* ---------- dialoghi file ---------- */

static void set_filters(IFileDialog *fd, const cJSON *filters)
{
    int n = cJSON_GetArraySize(filters);
    if (n <= 0) return;
    COMDLG_FILTERSPEC *spec = (COMDLG_FILTERSPEC *)calloc((size_t)n, sizeof *spec);
    wchar_t **strs = (wchar_t **)calloc((size_t)n * 2, sizeof(wchar_t *));
    int i = 0;
    const cJSON *f;
    cJSON_ArrayForEach(f, filters) {
        char pat[512] = "";
        const cJSON *e;
        cJSON_ArrayForEach(e, cJSON_GetObjectItemCaseSensitive(f, "ext")) {
            if (!cJSON_IsString(e)) continue;
            size_t l = strlen(pat);
            snprintf(pat + l, sizeof pat - l, "%s*.%s", l ? ";" : "", e->valuestring);
        }
        strs[i * 2] = json_wstr(f, "name");
        strs[i * 2 + 1] = utf8_to_wide(pat[0] ? pat : "*.*");
        spec[i].pszName = strs[i * 2] ? strs[i * 2] : L"File";
        spec[i].pszSpec = strs[i * 2 + 1];
        i++;
    }
    IFileDialog_SetFileTypes(fd, (UINT)i, spec);
    for (int k = 0; k < i * 2; k++) free(strs[k]);
    free(strs);
    free(spec);
}

static void set_folder(IFileDialog *fd, const wchar_t *dir)
{
    if (!dir || !dir[0]) return;
    IShellItem *si = NULL;
    if (SUCCEEDED(SHCreateItemFromParsingName(dir, NULL, &IID_IShellItem, (void **)&si)) && si) {
        IFileDialog_SetFolder(fd, si);
        IShellItem_Release(si);
    }
}

static char *item_path(IShellItem *si)
{
    LPWSTR p = NULL;
    char *u = NULL;
    if (SUCCEEDED(IShellItem_GetDisplayName(si, SIGDN_FILESYSPATH, &p)) && p) {
        u = wide_to_utf8(p);
        CoTaskMemFree(p);
    }
    return u;
}

cJSON *native_file_dialog(const cJSON *args, BOOL save)
{
    cJSON *o = cJSON_CreateObject();
    IFileDialog *fd = NULL;
    HRESULT hr = CoCreateInstance(save ? &CLSID_FileSaveDialog : &CLSID_FileOpenDialog, NULL, CLSCTX_INPROC_SERVER,
                                  save ? &IID_IFileSaveDialog : &IID_IFileOpenDialog, (void **)&fd);
    if (FAILED(hr)) { json_add_tr(o, "error", S_DIALOG_UNAVAILABLE); return o; }
    wchar_t *title = json_wstr(args, "title");
    if (title) { IFileDialog_SetTitle(fd, title); free(title); }
    set_filters(fd, cJSON_GetObjectItemCaseSensitive(args, "filters"));
    DWORD opts = 0;
    IFileDialog_GetOptions(fd, &opts);
    opts |= FOS_FORCEFILESYSTEM;
    if (!save && json_bool(args, "multi", FALSE)) opts |= FOS_ALLOWMULTISELECT;
    if (save) opts |= FOS_OVERWRITEPROMPT;
    IFileDialog_SetOptions(fd, opts);
    wchar_t *dir = json_wstr(args, "folder");
    set_folder(fd, dir);
    free(dir);
    wchar_t *name = json_wstr(args, "name");
    if (name) { IFileDialog_SetFileName(fd, name); free(name); }
    wchar_t *defExt = json_wstr(args, "defaultExt");
    if (defExt) { IFileDialog_SetDefaultExtension(fd, defExt); free(defExt); }

    hr = IFileDialog_Show(fd, g.hwnd);
    if (FAILED(hr)) {
        cJSON_AddBoolToObject(o, "canceled", 1);
    } else if (save) {
        IShellItem *si = NULL;
        if (SUCCEEDED(IFileDialog_GetResult(fd, &si)) && si) {
            char *p = item_path(si);
            if (p) { cJSON_AddStringToObject(o, "path", p); free(p); }
            IShellItem_Release(si);
        }
    } else {
        IShellItemArray *arr = NULL;
        cJSON *paths = cJSON_AddArrayToObject(o, "paths");
        if (SUCCEEDED(IFileOpenDialog_GetResults((IFileOpenDialog *)fd, &arr)) && arr) {
            DWORD n = 0;
            IShellItemArray_GetCount(arr, &n);
            for (DWORD i = 0; i < n; i++) {
                IShellItem *si = NULL;
                if (SUCCEEDED(IShellItemArray_GetItemAt(arr, i, &si)) && si) {
                    char *p = item_path(si);
                    if (p) { cJSON_AddItemToArray(paths, cJSON_CreateString(p)); free(p); }
                    IShellItem_Release(si);
                }
            }
            IShellItemArray_Release(arr);
        }
    }
    IFileDialog_Release(fd);
    return o;
}

cJSON *native_folder_dialog(const cJSON *args)
{
    cJSON *o = cJSON_CreateObject();
    IFileDialog *fd = NULL;
    if (FAILED(CoCreateInstance(&CLSID_FileOpenDialog, NULL, CLSCTX_INPROC_SERVER, &IID_IFileOpenDialog, (void **)&fd))) {
        json_add_tr(o, "error", S_DIALOG_UNAVAILABLE);
        return o;
    }
    DWORD opts = 0;
    IFileDialog_GetOptions(fd, &opts);
    IFileDialog_SetOptions(fd, opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
    wchar_t *title = json_wstr(args, "title");
    if (title) { IFileDialog_SetTitle(fd, title); free(title); }
    wchar_t *dir = json_wstr(args, "folder");
    set_folder(fd, dir);
    free(dir);
    if (SUCCEEDED(IFileDialog_Show(fd, g.hwnd))) {
        IShellItem *si = NULL;
        if (SUCCEEDED(IFileDialog_GetResult(fd, &si)) && si) {
            char *p = item_path(si);
            if (p) { cJSON_AddStringToObject(o, "path", p); free(p); }
            IShellItem_Release(si);
        }
    } else {
        cJSON_AddBoolToObject(o, "canceled", 1);
    }
    IFileDialog_Release(fd);
    return o;
}

/* Finestra di conferma con pulsanti a scelta (TaskDialog di Windows).
 * Restituisce l'indice del pulsante premuto; Esc vale "cancelIndex". */
int native_message_box(const cJSON *args)
{
    const cJSON *buttons = cJSON_GetObjectItemCaseSensitive(args, "buttons");
    int n = cJSON_GetArraySize(buttons);
    if (n > 8) n = 8;
    TASKDIALOG_BUTTON btn[8];
    wchar_t *labels[8] = { 0 };
    for (int i = 0; i < n; i++) {
        const cJSON *b = cJSON_GetArrayItem(buttons, i);
        labels[i] = utf8_to_wide(cJSON_IsString(b) ? b->valuestring : "OK");
        btn[i].nButtonID = 100 + i;
        btn[i].pszButtonText = labels[i];
    }
    wchar_t *title = json_wstr(args, "title");
    wchar_t *text = json_wstr(args, "text");
    wchar_t *detail = json_wstr(args, "detail");
    const char *icon = json_str(args, "icon");
    TASKDIALOGCONFIG tc = { sizeof tc };
    tc.hwndParent = g.hwnd;
    tc.hInstance = g.hinst;
    tc.dwFlags = TDF_POSITION_RELATIVE_TO_WINDOW | TDF_ALLOW_DIALOG_CANCELLATION;
    tc.pszWindowTitle = title ? title : APP_NAME;
    tc.pszMainInstruction = text;
    tc.pszContent = detail;
    if (icon && strcmp(icon, "warning") == 0) tc.pszMainIcon = TD_WARNING_ICON;
    else if (icon && strcmp(icon, "error") == 0) tc.pszMainIcon = TD_ERROR_ICON;
    else if (icon && strcmp(icon, "info") == 0) tc.pszMainIcon = TD_INFORMATION_ICON;
    tc.cButtons = (UINT)n;
    tc.pButtons = n ? btn : NULL;
    if (!n) tc.dwCommonButtons = TDCBF_OK_BUTTON;
    tc.nDefaultButton = 100 + json_int(args, "defaultIndex", 0);
    int pressed = 0;
    HRESULT hr = TaskDialogIndirect(&tc, &pressed, NULL, NULL);
    for (int i = 0; i < n; i++) free(labels[i]);
    free(title); free(text); free(detail);
    int cancelIndex = json_int(args, "cancelIndex", n ? n - 1 : 0);
    if (FAILED(hr) || pressed == IDCANCEL) return cancelIndex;
    if (pressed >= 100) return pressed - 100;
    return 0;
}

/* ---------- Pandoc ---------- */

static BOOL find_pandoc_path(wchar_t *out)
{
    if (SearchPathW(NULL, L"pandoc.exe", NULL, MAX_PATH, out, NULL)) return TRUE;
    wchar_t base[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, base))) {
        path_join(out, MAX_PATH, base, L"Pandoc\\pandoc.exe");
        if (GetFileAttributesW(out) != INVALID_FILE_ATTRIBUTES) return TRUE;
    }
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_PROGRAM_FILES, NULL, 0, base))) {
        path_join(out, MAX_PATH, base, L"Pandoc\\pandoc.exe");
        if (GetFileAttributesW(out) != INVALID_FILE_ATTRIBUTES) return TRUE;
    }
    return FALSE;
}

cJSON *native_find_pandoc(void)
{
    wchar_t p[MAX_PATH];
    if (!find_pandoc_path(p)) return cJSON_CreateNull();
    char *u = wide_to_utf8(p);
    cJSON *s = cJSON_CreateString(u);
    free(u);
    return s;
}

typedef struct { wchar_t *cmdline; wchar_t *cwd; int replyId; wchar_t *readBack; wchar_t *tmpIn; } PandocJob;

static void append_arg(wchar_t **cmd, size_t *cap, const wchar_t *arg)
{
    size_t need = wcslen(*cmd) + wcslen(arg) * 2 + 4;
    if (need > *cap) { *cap = need * 2; *cmd = (wchar_t *)realloc(*cmd, *cap * sizeof(wchar_t)); }
    wcscat(*cmd, L" \"");
    /* le virgolette dentro un argomento vanno precedute da \ */
    wchar_t *w = *cmd + wcslen(*cmd);
    for (const wchar_t *a = arg; *a; a++) { if (*a == L'"') *w++ = L'\\'; *w++ = *a; }
    *w++ = L'"';
    *w = 0;
}

static DWORD WINAPI pandoc_thread(LPVOID p)
{
    PandocJob *job = (PandocJob *)p;
    cJSON *reply = cJSON_CreateObject();
    cJSON_AddNumberToObject(reply, "re", job->replyId);
    cJSON *data = cJSON_AddObjectToObject(reply, "data");

    SECURITY_ATTRIBUTES sa = { sizeof sa, NULL, TRUE };
    HANDLE rd = NULL, wr = NULL;
    CreatePipe(&rd, &wr, &sa, 0);
    SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);
    STARTUPINFOW si = { sizeof si };
    si.dwFlags = STARTF_USESTDHANDLES;
    si.hStdOutput = wr;
    si.hStdError = wr;
    si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
    PROCESS_INFORMATION pi;
    if (!CreateProcessW(NULL, job->cmdline, NULL, NULL, TRUE, CREATE_NO_WINDOW, NULL, job->cwd, &si, &pi)) {
        char *m = last_error_utf8(GetLastError());
        cJSON_AddStringToObject(data, "error", m);
        free(m);
        CloseHandle(wr); CloseHandle(rd);
    } else {
        CloseHandle(wr);
        /* raccoglie i messaggi di pandoc (avvisi ed errori) */
        size_t cap = 4096, len = 0;
        char *out = (char *)malloc(cap);
        DWORD got;
        char buf[4096];
        while (ReadFile(rd, buf, sizeof buf, &got, NULL) && got) {
            if (len + got + 1 > cap) { cap = (len + got + 1) * 2; out = (char *)realloc(out, cap); }
            memcpy(out + len, buf, got);
            len += got;
        }
        out[len] = 0;
        CloseHandle(rd);
        WaitForSingleObject(pi.hProcess, 180000);
        DWORD code = 1;
        GetExitCodeProcess(pi.hProcess, &code);
        CloseHandle(pi.hProcess); CloseHandle(pi.hThread);
        /* pandoc scrive in UTF-8 */
        cJSON_AddStringToObject(data, "log", out);
        free(out);
        cJSON_AddNumberToObject(data, "code", (double)code);
        if (code != 0) json_add_tr(data, "error", S_PANDOC_ERROR);
        else if (job->readBack) {
            cJSON *r = fs_read_text(job->readBack);
            const char *t = json_str(r, "text");
            if (t) cJSON_AddStringToObject(data, "text", t);
            cJSON_Delete(r);
            DeleteFileW(job->readBack);
        }
    }
    if (job->tmpIn) DeleteFileW(job->tmpIn);
    post_json_from_thread(reply);
    free(job->cmdline); free(job->cwd); free(job->readBack); free(job->tmpIn);
    free(job);
    return 0;
}

/* args: { from, to, input (testo) | inputPath, output | readBack:true, cwd, extra:[...] } */
void native_run_pandoc_async(const cJSON *args, int replyId)
{
    wchar_t exe[MAX_PATH];
    if (!find_pandoc_path(exe)) {
        cJSON *o = cJSON_CreateObject();
        cJSON_AddNumberToObject(o, "re", replyId);
        cJSON_AddStringToObject(cJSON_AddObjectToObject(o, "data"), "error", "nopandoc");
        webview_post_obj(o);
        return;
    }
    PandocJob *job = (PandocJob *)calloc(1, sizeof *job);
    job->replyId = replyId;
    size_t cap = 1024;
    job->cmdline = (wchar_t *)calloc(cap, sizeof(wchar_t));
    _snwprintf(job->cmdline, cap, L"\"%s\"", exe);

    wchar_t tmpDir[MAX_PATH];
    GetTempPathW(MAX_PATH, tmpDir);
    const char *input = json_str(args, "input");
    wchar_t *inputPath = json_wstr(args, "inputPath");
    if (input) {
        wchar_t tmp[MAX_PATH];
        GetTempFileNameW(tmpDir, L"mdf", 0, tmp);
        wchar_t *t2 = (wchar_t *)malloc(MAX_PATH * sizeof(wchar_t));
        _snwprintf(t2, MAX_PATH, L"%s.md", tmp);
        DeleteFileW(tmp);
        DWORD e;
        HANDLE h = CreateFileW(t2, GENERIC_WRITE, 0, NULL, CREATE_ALWAYS, 0, NULL);
        if (h != INVALID_HANDLE_VALUE) { WriteFile(h, input, (DWORD)strlen(input), &e, NULL); CloseHandle(h); }
        job->tmpIn = t2;
        inputPath = _wcsdup(t2);
    }
    wchar_t *from = json_wstr(args, "from"), *to = json_wstr(args, "to");
    if (from) { append_arg(&job->cmdline, &cap, L"-f"); append_arg(&job->cmdline, &cap, from); }
    if (to) { append_arg(&job->cmdline, &cap, L"-t"); append_arg(&job->cmdline, &cap, to); }
    wchar_t *output = json_wstr(args, "output");
    if (!output && json_bool(args, "readBack", FALSE)) {
        wchar_t tmp[MAX_PATH];
        GetTempFileNameW(tmpDir, L"mdo", 0, tmp);
        job->readBack = _wcsdup(tmp);
        output = _wcsdup(tmp);
    }
    if (output) { append_arg(&job->cmdline, &cap, L"-o"); append_arg(&job->cmdline, &cap, output); }
    const cJSON *e;
    cJSON_ArrayForEach(e, cJSON_GetObjectItemCaseSensitive(args, "extra")) {
        if (!cJSON_IsString(e)) continue;
        wchar_t *w = utf8_to_wide(e->valuestring);
        append_arg(&job->cmdline, &cap, w);
        free(w);
    }
    if (inputPath) append_arg(&job->cmdline, &cap, inputPath);
    job->cwd = json_wstr(args, "cwd");
    free(from); free(to); free(output); free(inputPath);
    HANDLE th = CreateThread(NULL, 0, pandoc_thread, job, 0, NULL);
    if (th) CloseHandle(th);
}

/* ---------- HTTP (assistente Ollama) ----------
 * Le richieste partono da un thread: la pagina non può chiamare Ollama da sola
 * perché il suo indirizzo non è tra le origini accettate da Ollama (CORS). */

typedef struct { wchar_t *url; char *method; char *body; int replyId; int streamId; } HttpJob;
static volatile LONG abortFlags[64];

void native_http_abort(int streamId)
{
    if (streamId > 0) InterlockedExchange(&abortFlags[streamId % 64], 1);
}

static DWORD WINAPI http_thread(LPVOID p)
{
    HttpJob *job = (HttpJob *)p;
    cJSON *reply = cJSON_CreateObject();
    cJSON_AddNumberToObject(reply, "re", job->replyId);
    cJSON *data = cJSON_AddObjectToObject(reply, "data");
    HINTERNET ses = NULL, con = NULL, req = NULL;
    URL_COMPONENTSW uc = { sizeof uc };
    wchar_t host[256], path[2048];
    uc.lpszHostName = host; uc.dwHostNameLength = 256;
    uc.lpszUrlPath = path; uc.dwUrlPathLength = 2048;
    wchar_t extra[1024] = L"";
    uc.lpszExtraInfo = extra; uc.dwExtraInfoLength = 1024;
    if (!WinHttpCrackUrl(job->url, 0, 0, &uc)) { json_add_tr(data, "error", S_BAD_URL); goto done; }
    wcsncat(path, extra, 2047 - wcslen(path));
    ses = WinHttpOpen(L"MDFlash/" APP_VERSION_W, WINHTTP_ACCESS_TYPE_AUTOMATIC_PROXY, NULL, NULL, 0);
    if (!ses) goto fail;
    WinHttpSetTimeouts(ses, 5000, 10000, 30000, 600000);
    con = WinHttpConnect(ses, host, uc.nPort, 0);
    if (!con) goto fail;
    wchar_t *method = utf8_to_wide(job->method ? job->method : "GET");
    req = WinHttpOpenRequest(con, method, path, NULL, WINHTTP_NO_REFERER, WINHTTP_DEFAULT_ACCEPT_TYPES,
                             uc.nScheme == INTERNET_SCHEME_HTTPS ? WINHTTP_FLAG_SECURE : 0);
    free(method);
    if (!req) goto fail;
    DWORD blen = job->body ? (DWORD)strlen(job->body) : 0;
    if (!WinHttpSendRequest(req, L"Content-Type: application/json\r\n", (DWORD)-1L,
                            job->body, blen, blen, 0) || !WinHttpReceiveResponse(req, NULL)) goto fail;
    DWORD status = 0, sz = sizeof status;
    WinHttpQueryHeaders(req, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, NULL, &status, &sz, NULL);
    cJSON_AddNumberToObject(data, "status", (double)status);

    size_t cap = 8192, len = 0, lineStart = 0;
    char *buf = (char *)malloc(cap);
    for (;;) {
        if (job->streamId && InterlockedExchange(&abortFlags[job->streamId % 64], 0)) {
            cJSON_AddBoolToObject(data, "aborted", 1);
            break;
        }
        DWORD avail = 0;
        if (!WinHttpQueryDataAvailable(req, &avail) || avail == 0) break;
        if (len + avail + 1 > cap) { cap = (len + avail + 1) * 2; buf = (char *)realloc(buf, cap); }
        DWORD got = 0;
        if (!WinHttpReadData(req, buf + len, avail, &got) || got == 0) break;
        len += got;
        buf[len] = 0;
        if (job->streamId) {
            /* Ollama manda una riga JSON per pezzo di testo: si inoltrano subito */
            char *nl;
            while ((nl = memchr(buf + lineStart, '\n', len - lineStart)) != NULL) {
                *nl = 0;
                if (nl > buf + lineStart) {
                    cJSON *ev = cJSON_CreateObject();
                    cJSON_AddStringToObject(ev, "ev", "httpChunk");
                    cJSON *d = cJSON_AddObjectToObject(ev, "data");
                    cJSON_AddNumberToObject(d, "id", job->streamId);
                    cJSON_AddStringToObject(d, "line", buf + lineStart);
                    post_json_from_thread(ev);
                }
                *nl = '\n';
                lineStart = (size_t)(nl - buf) + 1;
            }
        }
    }
    if (!job->streamId) cJSON_AddStringToObject(data, "body", buf);
    else if (lineStart < len) cJSON_AddStringToObject(data, "rest", buf + lineStart);
    free(buf);
    goto done;
fail: {
        DWORD err = GetLastError();
        if (err == ERROR_WINHTTP_CANNOT_CONNECT || err == ERROR_WINHTTP_TIMEOUT)
            cJSON_AddStringToObject(data, "error", "noconnect");
        else {
            wchar_t wm[128];
            _snwprintf(wm, 128, tr(S_NET_ERROR), (unsigned long)err);
            wm[127] = 0;
            char *m = wide_to_utf8(wm);
            cJSON_AddStringToObject(data, "error", m);
            free(m);
        }
    }
done:
    if (req) WinHttpCloseHandle(req);
    if (con) WinHttpCloseHandle(con);
    if (ses) WinHttpCloseHandle(ses);
    post_json_from_thread(reply);
    free(job->url); free(job->method); free(job->body); free(job);
    return 0;
}

void native_http_async(const cJSON *args, int replyId)
{
    HttpJob *job = (HttpJob *)calloc(1, sizeof *job);
    job->url = json_wstr(args, "url");
    const char *m = json_str(args, "method");
    const char *b = json_str(args, "body");
    job->method = _strdup(m ? m : "GET");
    job->body = b ? _strdup(b) : NULL;
    job->replyId = replyId;
    job->streamId = json_int(args, "streamId", 0);
    if (job->streamId) InterlockedExchange(&abortFlags[job->streamId % 64], 0);
    if (!job->url) job->url = _wcsdup(L"");
    HANDLE th = CreateThread(NULL, 0, http_thread, job, 0, NULL);
    if (th) CloseHandle(th);
}

/* ---------- shell ---------- */

cJSON *native_open_external(const wchar_t *target)
{
    cJSON *o = cJSON_CreateObject();
    HINSTANCE r = ShellExecuteW(g.hwnd, L"open", target, NULL, NULL, SW_SHOWNORMAL);
    cJSON_AddBoolToObject(o, "ok", (INT_PTR)r > 32);
    return o;
}

cJSON *native_show_in_folder(const wchar_t *path)
{
    cJSON *o = cJSON_CreateObject();
    PIDLIST_ABSOLUTE pidl = ILCreateFromPathW(path);
    if (pidl) {
        SHOpenFolderAndSelectItems(pidl, 0, NULL, 0);
        ILFree(pidl);
        cJSON_AddBoolToObject(o, "ok", 1);
    }
    return o;
}

cJSON *native_list_themes(void)
{
    wchar_t dir[MAX_PATH], pat[MAX_PATH];
    path_join(dir, MAX_PATH, g.roamingDir, L"themes");
    ensure_dir(dir);
    cJSON *o = cJSON_CreateObject();
    char *d = wide_to_utf8(dir);
    cJSON_AddStringToObject(o, "dir", d);
    free(d);
    cJSON *arr = cJSON_AddArrayToObject(o, "themes");
    path_join(pat, MAX_PATH, dir, L"*.css");
    WIN32_FIND_DATAW fd;
    HANDLE h = FindFirstFileW(pat, &fd);
    if (h == INVALID_HANDLE_VALUE) return o;
    do {
        wchar_t full[MAX_PATH];
        path_join(full, MAX_PATH, dir, fd.cFileName);
        cJSON *t = fs_read_text(full);
        const char *css = json_str(t, "text");
        if (css) {
            cJSON *e = cJSON_CreateObject();
            wchar_t name[MAX_PATH];
            wcsncpy(name, fd.cFileName, MAX_PATH - 1); name[MAX_PATH - 1] = 0;
            PathRemoveExtensionW(name);
            char *n = wide_to_utf8(name);
            cJSON_AddStringToObject(e, "name", n);
            cJSON_AddStringToObject(e, "css", css);
            free(n);
            cJSON_AddItemToArray(arr, e);
        }
        cJSON_Delete(t);
    } while (FindNextFileW(h, &fd));
    FindClose(h);
    return o;
}

/* ---------- associazione dei file .md (per l'utente corrente) ---------- */

static void reg_str(const wchar_t *key, const wchar_t *name, const wchar_t *val)
{
    RegSetKeyValueW(HKEY_CURRENT_USER, key, name, REG_SZ, val, (DWORD)((wcslen(val) + 1) * sizeof(wchar_t)));
}

cJSON *native_register_association(void)
{
    wchar_t exe[MAX_PATH], cmd[MAX_PATH + 16], icon[MAX_PATH + 8];
    GetModuleFileNameW(NULL, exe, MAX_PATH);
    _snwprintf(cmd, MAX_PATH + 16, L"\"%s\" \"%%1\"", exe);
    _snwprintf(icon, MAX_PATH + 8, L"\"%s\",1", exe);
    cmd[MAX_PATH + 15] = 0; icon[MAX_PATH + 7] = 0;

    reg_str(L"Software\\Classes\\MDFlash.md", NULL, tr(S_DOC_TYPE));
    reg_str(L"Software\\Classes\\MDFlash.md\\DefaultIcon", NULL, icon);
    reg_str(L"Software\\Classes\\MDFlash.md\\shell\\open\\command", NULL, cmd);
    static const wchar_t *exts[] = { L".md", L".markdown", L".mdown", L".mkd", L".mkdn", NULL };
    for (int i = 0; exts[i]; i++) {
        wchar_t k[128];
        _snwprintf(k, 128, L"Software\\Classes\\%s\\OpenWithProgids", exts[i]);
        reg_str(k, L"MDFlash.md", L"");
        reg_str(L"Software\\MDFlash\\Capabilities\\FileAssociations", exts[i], L"MDFlash.md");
        reg_str(L"Software\\Classes\\Applications\\MDFlash.exe\\SupportedTypes", exts[i], L"");
    }
    reg_str(L"Software\\Classes\\Applications\\MDFlash.exe", L"FriendlyAppName", L"MDFlash");
    reg_str(L"Software\\Classes\\Applications\\MDFlash.exe\\shell\\open\\command", NULL, cmd);
    reg_str(L"Software\\MDFlash\\Capabilities", L"ApplicationName", L"MDFlash");
    reg_str(L"Software\\MDFlash\\Capabilities", L"ApplicationDescription", tr(S_APP_DESC));
    reg_str(L"Software\\RegisteredApplications", L"MDFlash", L"Software\\MDFlash\\Capabilities");
    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, NULL, NULL);
    /* Windows 10/11 non permettono di imporsi come predefiniti: si apre la
     * pagina delle Impostazioni già sul programma, l'utente conferma lì. */
    ShellExecuteW(g.hwnd, L"open", L"ms-settings:defaultapps?registeredAppUser=MDFlash", NULL, NULL, SW_SHOWNORMAL);
    cJSON *o = cJSON_CreateObject();
    cJSON_AddBoolToObject(o, "ok", 1);
    return o;
}

/* ---------- Word senza Pandoc ----------
 * Un .docx è uno zip di file XML. Qui il documento contiene un "altChunk":
 * una pagina HTML (in formato MHT, con le immagini incluse) che Word converte
 * in testo formattato quando apre il file. */

static unsigned long crc_table[256];
static void crc_init(void)
{
    for (unsigned long n = 0; n < 256; n++) {
        unsigned long c = n;
        for (int k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320UL ^ (c >> 1) : c >> 1;
        crc_table[n] = c;
    }
}
static unsigned long crc32_buf(const unsigned char *b, size_t n)
{
    unsigned long c = 0xFFFFFFFFUL;
    for (size_t i = 0; i < n; i++) c = crc_table[(c ^ b[i]) & 0xFF] ^ (c >> 8);
    return c ^ 0xFFFFFFFFUL;
}

typedef struct { char name[64]; unsigned long crc; size_t size; size_t offset; } ZipEntry;

static void put16(FILE *f, unsigned v) { fputc((int)(v & 0xFF), f); fputc((int)((v >> 8) & 0xFF), f); }
static void put32(FILE *f, unsigned long v) { put16(f, (unsigned)(v & 0xFFFF)); put16(f, (unsigned)((v >> 16) & 0xFFFF)); }

static void zip_add(FILE *f, ZipEntry *e, const char *name, const void *data, size_t len)
{
    snprintf(e->name, sizeof e->name, "%s", name);
    e->crc = crc32_buf((const unsigned char *)data, len);
    e->size = len;
    e->offset = (size_t)ftell(f);
    put32(f, 0x04034b50); put16(f, 20); put16(f, 0); put16(f, 0); /* senza compressione */
    put16(f, 0); put16(f, 0x21); /* ora e data fittizie (1980-01-01) */
    put32(f, e->crc); put32(f, (unsigned long)len); put32(f, (unsigned long)len);
    put16(f, (unsigned)strlen(name)); put16(f, 0);
    fwrite(name, 1, strlen(name), f);
    fwrite(data, 1, len, f);
}

static void zip_finish(FILE *f, ZipEntry *e, int n)
{
    size_t start = (size_t)ftell(f);
    for (int i = 0; i < n; i++) {
        put32(f, 0x02014b50); put16(f, 20); put16(f, 20); put16(f, 0); put16(f, 0);
        put16(f, 0); put16(f, 0x21);
        put32(f, e[i].crc); put32(f, (unsigned long)e[i].size); put32(f, (unsigned long)e[i].size);
        put16(f, (unsigned)strlen(e[i].name)); put16(f, 0); put16(f, 0); put16(f, 0); put16(f, 0);
        put32(f, 0); put32(f, (unsigned long)e[i].offset);
        fwrite(e[i].name, 1, strlen(e[i].name), f);
    }
    size_t end = (size_t)ftell(f);
    put32(f, 0x06054b50); put16(f, 0); put16(f, 0); put16(f, (unsigned)n); put16(f, (unsigned)n);
    put32(f, (unsigned long)(end - start)); put32(f, (unsigned long)start); put16(f, 0);
}

/* html: pagina completa; le immagini locali sono indicate come
 * src="mdflash-img:N" e il loro percorso sta in images[N]. */
cJSON *native_export_docx_ex(const wchar_t *path, const char *html, const cJSON *images)
{
    static int crcReady = 0;
    if (!crcReady) { crc_init(); crcReady = 1; }
    /* MHT: multipart/related con la pagina e ogni immagine in base64 */
    size_t cap = strlen(html) * 2 + 4096, len = 0;
    char *mht = (char *)malloc(cap);
    #define MHT_ADD(s) do { size_t _l = strlen(s); if (len + _l + 1 > cap) { cap = (len + _l + 1) * 2; mht = (char *)realloc(mht, cap); } memcpy(mht + len, s, _l); len += _l; mht[len] = 0; } while (0)
    MHT_ADD("MIME-Version: 1.0\r\nContent-Type: multipart/related; boundary=\"----=mdflash_boundary\"\r\n\r\n");
    MHT_ADD("------=mdflash_boundary\r\nContent-Type: text/html; charset=\"utf-8\"\r\nContent-Location: file:///C:/mdflash/doc.htm\r\nContent-Transfer-Encoding: 8bit\r\n\r\n");
    MHT_ADD(html);
    MHT_ADD("\r\n");
    int idx = 0;
    const cJSON *im;
    cJSON_ArrayForEach(im, images) {
        if (cJSON_IsString(im)) {
            wchar_t *w = utf8_to_wide(im->valuestring);
            HANDLE h = CreateFileW(w, GENERIC_READ, FILE_SHARE_READ, NULL, OPEN_EXISTING, 0, NULL);
            if (h != INVALID_HANDLE_VALUE) {
                DWORD sz = GetFileSize(h, NULL), got = 0;
                unsigned char *b = (unsigned char *)malloc(sz ? sz : 1);
                ReadFile(h, b, sz, &got, NULL);
                CloseHandle(h);
                char *b64 = base64_encode(b, got);
                free(b);
                const wchar_t *ext = PathFindExtensionW(w);
                const char *ct = "image/png";
                if (_wcsicmp(ext, L".jpg") == 0 || _wcsicmp(ext, L".jpeg") == 0) ct = "image/jpeg";
                else if (_wcsicmp(ext, L".gif") == 0) ct = "image/gif";
                else if (_wcsicmp(ext, L".bmp") == 0) ct = "image/bmp";
                else if (_wcsicmp(ext, L".svg") == 0) ct = "image/svg+xml";
                else if (_wcsicmp(ext, L".webp") == 0) ct = "image/webp";
                char head[256];
                snprintf(head, sizeof head, "------=mdflash_boundary\r\nContent-Type: %s\r\nContent-Transfer-Encoding: base64\r\nContent-Location: file:///C:/mdflash/img%d\r\n\r\n", ct, idx);
                MHT_ADD(head);
                /* righe da 76 caratteri come vuole MIME */
                size_t bl = strlen(b64);
                for (size_t i = 0; i < bl; i += 76) {
                    char line[80];
                    size_t n = bl - i < 76 ? bl - i : 76;
                    memcpy(line, b64 + i, n);
                    line[n] = 0;
                    MHT_ADD(line);
                    MHT_ADD("\r\n");
                }
                free(b64);
            }
            free(w);
        }
        idx++;
    }
    MHT_ADD("------=mdflash_boundary--\r\n");
    #undef MHT_ADD

    const char *ctypes =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">"
        "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>"
        "<Default Extension=\"xml\" ContentType=\"application/xml\"/>"
        "<Default Extension=\"mht\" ContentType=\"message/rfc822\"/>"
        "<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>"
        "</Types>";
    const char *rels =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>"
        "</Relationships>";
    const char *doc =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\" "
        "xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">"
        "<w:body><w:altChunk r:id=\"htmlChunk\"/><w:sectPr><w:pgSz w:w=\"11906\" w:h=\"16838\"/>"
        "<w:pgMar w:top=\"1134\" w:right=\"1134\" w:bottom=\"1134\" w:left=\"1134\" w:header=\"708\" w:footer=\"708\" w:gutter=\"0\"/>"
        "</w:sectPr></w:body></w:document>";
    const char *docRels =
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>"
        "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">"
        "<Relationship Id=\"htmlChunk\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/aFChunk\" Target=\"chunk.mht\"/>"
        "</Relationships>";

    cJSON *o = cJSON_CreateObject();
    FILE *f = _wfopen(path, L"wb");
    if (!f) { free(mht); json_add_tr(o, "error", S_FILE_LOCKED); return o; }
    ZipEntry e[5];
    zip_add(f, &e[0], "[Content_Types].xml", ctypes, strlen(ctypes));
    zip_add(f, &e[1], "_rels/.rels", rels, strlen(rels));
    zip_add(f, &e[2], "word/document.xml", doc, strlen(doc));
    zip_add(f, &e[3], "word/_rels/document.xml.rels", docRels, strlen(docRels));
    zip_add(f, &e[4], "word/chunk.mht", mht, len);
    zip_finish(f, e, 5);
    fclose(f);
    free(mht);
    cJSON_AddBoolToObject(o, "ok", 1);
    return o;
}

cJSON *native_export_docx(const wchar_t *path, const char *html)
{
    return native_export_docx_ex(path, html, NULL);
}
