/* MDFlash: punto di ingresso e finestra principale. */
#include "app.h"

AppState g;

#define COPYDATA_OPEN 0x4D44 /* "MD": file da aprire inviati da un'altra istanza */


/* Una seconda istanza (doppio clic su un altro .md) passa i suoi argomenti
 * alla finestra già aperta: cartella corrente e file, separati da \0. */
static BOOL forward_to_running(int argc, wchar_t **argv)
{
    HWND other = FindWindowW(APP_CLASS, NULL);
    if (!other) return FALSE;
    size_t len = 0;
    wchar_t cwd[MAX_PATH];
    GetCurrentDirectoryW(MAX_PATH, cwd);
    len += wcslen(cwd) + 1;
    for (int i = 1; i < argc; i++) len += wcslen(argv[i]) + 1;
    len += 1;
    wchar_t *buf = (wchar_t *)calloc(len, sizeof(wchar_t));
    wchar_t *p = buf;
    wcscpy(p, cwd); p += wcslen(cwd) + 1;
    for (int i = 1; i < argc; i++) { wcscpy(p, argv[i]); p += wcslen(argv[i]) + 1; }
    COPYDATASTRUCT cds = { COPYDATA_OPEN, (DWORD)(len * sizeof(wchar_t)), buf };
    DWORD pid = 0;
    GetWindowThreadProcessId(other, &pid);
    AllowSetForegroundWindow(pid);
    DWORD_PTR res = 0;
    BOOL okSend = SendMessageTimeoutW(other, WM_COPYDATA, 0, (LPARAM)&cds, SMTO_ABORTIFHUNG, 5000, &res) != 0;
    free(buf);
    return okSend;
}

static void receive_files(const COPYDATASTRUCT *cds)
{
    const wchar_t *p = (const wchar_t *)cds->lpData;
    const wchar_t *end = p + cds->cbData / sizeof(wchar_t);
    if (p >= end) return;
    const wchar_t *cwd = p;
    p += wcslen(p) + 1;
    cJSON *files = cJSON_CreateArray();
    while (p < end && *p) {
        if (!(p[0] == L'-' && p[1] == L'-')) {
            wchar_t full[MAX_PATH * 2];
            if (PathIsRelativeW(p)) PathCombineW(full, cwd, p);
            else wcsncpy(full, p, MAX_PATH * 2 - 1);
            full[MAX_PATH * 2 - 1] = 0;
            char *u = wide_to_utf8(full);
            cJSON_AddItemToArray(files, cJSON_CreateString(u));
            free(u);
        }
        p += wcslen(p) + 1;
    }
    if (g.pageReady) bridge_open_files_now(files);
    else {
        if (!g.pendingFiles) g.pendingFiles = cJSON_CreateArray();
        cJSON *it;
        while ((it = cJSON_DetachItemFromArray(files, 0)) != NULL) cJSON_AddItemToArray(g.pendingFiles, it);
        cJSON_Delete(files);
    }
    if (IsIconic(g.hwnd)) ShowWindow(g.hwnd, SW_RESTORE);
    SetForegroundWindow(g.hwnd);
}

static LRESULT CALLBACK WndProc(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp)
{
    BOOL handled = FALSE;
    LRESULT r = menu_dark_draw(hwnd, msg, wp, lp, &handled);
    if (handled) return r;

    switch (msg) {
    case WM_SIZE:
        webview_resize();
        return 0;
    case WM_MOVE:
    case WM_MOVING:
        if (g.controller) ICoreWebView2Controller_NotifyParentWindowPositionChanged(g.controller);
        break;
    case WM_GETMINMAXINFO: {
        MINMAXINFO *mm = (MINMAXINFO *)lp;
        UINT dpi = GetDpiForWindow(hwnd);
        mm->ptMinTrackSize.x = MulDiv(480, (int)dpi, 96);
        mm->ptMinTrackSize.y = MulDiv(320, (int)dpi, 96);
        return 0;
    }
    case WM_DPICHANGED: {
        RECT *rc = (RECT *)lp;
        SetWindowPos(hwnd, NULL, rc->left, rc->top, rc->right - rc->left, rc->bottom - rc->top,
                     SWP_NOZORDER | SWP_NOACTIVATE);
        return 0;
    }
    case WM_ERASEBKGND: {
        RECT rc;
        GetClientRect(hwnd, &rc);
        HBRUSH br = CreateSolidBrush(g.bgColor);
        FillRect((HDC)wp, &rc, br);
        DeleteObject(br);
        return 1;
    }
    case WM_SETFOCUS:
        webview_focus();
        return 0;
    case WM_ACTIVATE:
        if (LOWORD(wp) != WA_INACTIVE && g.pageReady) webview_post_event("activate", NULL);
        break;
    case WM_COMMAND: {
        const char *cmd = menu_command_for_id(LOWORD(wp));
        if (cmd && *cmd) {
            if (strncmp(cmd, "key:", 4) == 0) {
                native_send_keys(cmd + 4);
            } else {
                cJSON *d = cJSON_CreateObject();
                cJSON_AddStringToObject(d, "cmd", cmd);
                webview_post_event("menu", d);
                webview_focus();
            }
            return 0;
        }
        break;
    }
    case WM_COPYDATA: {
        const COPYDATASTRUCT *cds = (const COPYDATASTRUCT *)lp;
        if (cds && cds->dwData == COPYDATA_OPEN) { receive_files(cds); return TRUE; }
        break;
    }
    case WM_SETTINGCHANGE:
        if (lp && wcscmp((const wchar_t *)lp, L"ImmersiveColorSet") == 0 && g.pageReady) {
            DWORD light = 1, sz = sizeof light;
            RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                         L"AppsUseLightTheme", RRF_RT_REG_DWORD, NULL, &light, &sz);
            cJSON *d = cJSON_CreateObject();
            cJSON_AddBoolToObject(d, "dark", light == 0);
            webview_post_event("systemTheme", d);
        }
        break;
    case WM_DEVICECHANGE:
        /* chiavetta USB inserita: anche la nuova unità deve mostrare le immagini */
        if (wp == 0x8000 /* DBT_DEVICEARRIVAL */) webview_remap_drives();
        break;
    case WM_APP_WEBMSG: {
        char *json = (char *)lp;
        bridge_handle(json);
        free(json);
        return 0;
    }
    case WM_APP_POSTJSON: {
        char *json = (char *)lp;
        webview_post_json(json);
        free(json);
        return 0;
    }
    case WM_CLOSE:
        /* La pagina decide: se ci sono documenti non salvati chiede all'utente
         * e poi risponde "quit". Se non risponde (pagina bloccata), al secondo
         * tentativo si chiede se chiudere comunque. */
        if (g.pageReady) {
            DWORD now = GetTickCount();
            if (g.closeRequestedAt && now - g.closeRequestedAt > 8000) {
                int a = MessageBoxW(hwnd, tr(S_NOT_RESPONDING), APP_NAME, MB_ICONWARNING | MB_YESNO | MB_DEFBUTTON2);
                if (a == IDYES) { native_save_placement(); DestroyWindow(hwnd); }
                else g.closeRequestedAt = 0;
                return 0;
            }
            if (!g.closeRequestedAt) g.closeRequestedAt = now;
            webview_post_event("closeRequest", NULL);
            return 0;
        }
        native_save_placement();
        DestroyWindow(hwnd);
        return 0;
    case WM_QUERYENDSESSION:
        return TRUE;
    case WM_DESTROY:
        PostQuitMessage(0);
        return 0;
    }
    return DefWindowProcW(hwnd, msg, wp, lp);
}

/* La pagina ha annullato la chiusura (l'utente ha premuto "Annulla"). */
void main_close_canceled(void)
{
    g.closeRequestedAt = 0;
}

int WINAPI wWinMain(HINSTANCE hInst, HINSTANCE hPrev, PWSTR cmdLine, int nCmdShow)
{
    (void)hPrev; (void)cmdLine;
    int argc = 0;
    wchar_t **argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    BOOL newWindow = FALSE;
    for (int i = 1; i < argc; i++) if (_wcsicmp(argv[i], L"--new-window") == 0) newWindow = TRUE;
    g.secondary = newWindow;

    /* Istanza singola: i file aperti da Esplora risorse diventano schede */
    HANDLE mutex = CreateMutexW(NULL, FALSE, L"Local\\MDFlash.SingleInstance");
    if (!newWindow && GetLastError() == ERROR_ALREADY_EXISTS) {
        if (forward_to_running(argc, argv)) { LocalFree(argv); return 0; }
    }

    SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(NULL, COINIT_APARTMENTTHREADED);
    INITCOMMONCONTROLSEX icc = { sizeof icc, ICC_STANDARD_CLASSES };
    InitCommonControlsEx(&icc);
    SetCurrentProcessExplicitAppUserModelID(L"MDFlash.Editor");

    g.hinst = hInst;
    GetModuleFileNameW(NULL, g.exeDir, MAX_PATH);
    PathRemoveFileSpecW(g.exeDir);
    wchar_t base[MAX_PATH];
    /* Modalità portatile: con un file "portable" accanto all'exe, impostazioni,
     * versioni e dati del motore restano nella cartella "data" lì accanto
     * (es. su una chiavetta USB) invece che nel profilo dell'utente. */
    wchar_t marker[MAX_PATH];
    path_join(marker, MAX_PATH, g.exeDir, L"portable");
    if (GetFileAttributesW(marker) != INVALID_FILE_ATTRIBUTES) {
        path_join(g.dataDir, MAX_PATH, g.exeDir, L"data\\local");
        path_join(g.roamingDir, MAX_PATH, g.exeDir, L"data\\roaming");
    } else {
        SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, 0, base);
        path_join(g.dataDir, MAX_PATH, base, L"MDFlash");
        SHGetFolderPathW(NULL, CSIDL_APPDATA, NULL, 0, base);
        path_join(g.roamingDir, MAX_PATH, base, L"MDFlash");
    }
    ensure_dir(g.dataDir);
    ensure_dir(g.roamingDir);

    g.bgColor = reg_get_dword(L"BgColor", RGB(255, 255, 255));
    g.darkChrome = reg_get_dword(L"Dark", 0) != 0;
    menu_set_colors(g.bgColor, reg_get_dword(L"FgColor", RGB(32, 32, 32)));

    bridge_queue_files(argc, argv, 1);
    LocalFree(argv);

    WNDCLASSEXW wc = { sizeof wc };
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = WndProc;
    wc.hInstance = hInst;
    wc.hIcon = LoadIconW(hInst, MAKEINTRESOURCEW(1));
    wc.hIconSm = (HICON)LoadImageW(hInst, MAKEINTRESOURCEW(1), IMAGE_ICON,
                                   GetSystemMetrics(SM_CXSMICON), GetSystemMetrics(SM_CYSMICON), 0);
    wc.hCursor = LoadCursorW(NULL, (LPCWSTR)IDC_ARROW);
    wc.lpszClassName = APP_CLASS;
    RegisterClassExW(&wc);

    UINT dpi = GetDpiForSystem();
    g.hwnd = CreateWindowExW(0, APP_CLASS, APP_NAME, WS_OVERLAPPEDWINDOW,
                             CW_USEDEFAULT, CW_USEDEFAULT, MulDiv(1180, (int)dpi, 96), MulDiv(800, (int)dpi, 96),
                             NULL, NULL, hInst, NULL);
    if (!g.hwnd) return 1;

    menu_load_cached();
    menu_set_dark(g.darkChrome);
    native_set_dark_titlebar(g.darkChrome);
    native_load_placement(nCmdShow);
    UpdateWindow(g.hwnd);

    webview_create();

    MSG msg;
    while (GetMessageW(&msg, NULL, 0, 0) > 0) {
        TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }

    if (g.controller) ICoreWebView2Controller_Close(g.controller);
    CoUninitialize();
    if (mutex) CloseHandle(mutex);
    return 0;
}
