/* MDFlash: creazione e gestione del controllo WebView2 dalla parte C.
 *
 * In C non esistono le classi di comodo del C++ (Callback<>, Microsoft::WRL),
 * quindi ogni gestore di evento è una piccola struttura con la sua tabella di
 * funzioni (vtable) scritta a mano: QueryInterface, AddRef, Release, Invoke. */
#include "app.h"

typedef HRESULT (STDMETHODCALLTYPE *QIFn)(void *, REFIID, void **);
typedef ULONG (STDMETHODCALLTYPE *RefFn)(void *);

typedef struct HandlerVtbl {
    QIFn QueryInterface;
    RefFn AddRef;
    RefFn Release;
    void *Invoke;
} HandlerVtbl;

typedef struct Handler {
    const HandlerVtbl *lpVtbl;
    LONG ref;
    const IID *iid;
    BOOL heap;        /* allocato con malloc: va liberato all'ultimo Release */
    int replyId;      /* per le risposte asincrone (stampa PDF) */
} Handler;

static HRESULT STDMETHODCALLTYPE H_QueryInterface(void *self, REFIID riid, void **ppv)
{
    Handler *h = (Handler *)self;
    if (IsEqualIID(riid, &IID_IUnknown) || IsEqualIID(riid, h->iid)) {
        *ppv = self;
        InterlockedIncrement(&h->ref);
        return S_OK;
    }
    *ppv = NULL;
    return E_NOINTERFACE;
}

static ULONG STDMETHODCALLTYPE H_AddRef(void *self)
{
    return (ULONG)InterlockedIncrement(&((Handler *)self)->ref);
}

static ULONG STDMETHODCALLTYPE H_Release(void *self)
{
    Handler *h = (Handler *)self;
    LONG r = InterlockedDecrement(&h->ref);
    if (r == 0 && h->heap) free(h);
    return (ULONG)r;
}

#define VTBL(name, fn) static const HandlerVtbl name = { H_QueryInterface, H_AddRef, H_Release, (void *)(fn) }
#define STATIC_HANDLER(var, vt, iidp) static Handler var = { &vt, 1, iidp, FALSE, 0 }

static EventRegistrationToken tok;
static BOOL altAlone = FALSE;

/* ---------- invio di messaggi alla pagina ---------- */

void webview_post_json(const char *json)
{
    if (!g.webview || !json) return;
    wchar_t *w = utf8_to_wide(json);
    if (w) {
        ICoreWebView2_PostWebMessageAsJson(g.webview, w);
        free(w);
    }
}

void webview_post_obj(cJSON *obj)
{
    char *s = cJSON_PrintUnformatted(obj);
    webview_post_json(s);
    free(s);
    cJSON_Delete(obj);
}

void webview_post_event(const char *ev, cJSON *data)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "ev", ev);
    cJSON_AddItemToObject(o, "data", data ? data : cJSON_CreateObject());
    webview_post_obj(o);
}

void post_json_from_thread(cJSON *obj)
{
    char *s = cJSON_PrintUnformatted(obj);
    cJSON_Delete(obj);
    if (!PostMessageW(g.hwnd, WM_APP_POSTJSON, 0, (LPARAM)s)) free(s);
}

/* ---------- gestori di evento ---------- */

/* Messaggio dalla pagina: lo si rimanda al ciclo dei messaggi della finestra,
 * così dialoghi modali e altro codice bloccante non girano dentro il callback
 * di WebView2 (il che porterebbe a rientri difficili da prevedere). */
static HRESULT STDMETHODCALLTYPE OnWebMessage(void *self, ICoreWebView2 *sender, ICoreWebView2WebMessageReceivedEventArgs *args)
{
    (void)self; (void)sender;
    LPWSTR json = NULL;
    if (FAILED(ICoreWebView2WebMessageReceivedEventArgs_get_WebMessageAsJson(args, &json)) || !json) return S_OK;
    char *u = wide_to_utf8(json);
    CoTaskMemFree(json);

    /* File trascinati: postMessageWithAdditionalObjects porta i percorsi veri */
    ICoreWebView2WebMessageReceivedEventArgs2 *a2 = NULL;
    if (SUCCEEDED(ICoreWebView2WebMessageReceivedEventArgs_QueryInterface(args, &IID_ICoreWebView2WebMessageReceivedEventArgs2, (void **)&a2)) && a2) {
        ICoreWebView2ObjectCollectionView *objs = NULL;
        if (SUCCEEDED(ICoreWebView2WebMessageReceivedEventArgs2_get_AdditionalObjects(a2, &objs)) && objs) {
            UINT32 n = 0;
            ICoreWebView2ObjectCollectionView_get_Count(objs, &n);
            if (n > 0) {
                cJSON *root = cJSON_Parse(u);
                if (root) {
                    cJSON *paths = cJSON_AddArrayToObject(root, "_files");
                    for (UINT32 i = 0; i < n; i++) {
                        IUnknown *obj = NULL;
                        if (FAILED(ICoreWebView2ObjectCollectionView_GetValueAtIndex(objs, i, &obj)) || !obj) continue;
                        ICoreWebView2File *f = NULL;
                        if (SUCCEEDED(IUnknown_QueryInterface(obj, &IID_ICoreWebView2File, (void **)&f)) && f) {
                            LPWSTR p = NULL;
                            if (SUCCEEDED(ICoreWebView2File_get_Path(f, &p)) && p) {
                                char *pu = wide_to_utf8(p);
                                cJSON_AddItemToArray(paths, cJSON_CreateString(pu));
                                free(pu);
                                CoTaskMemFree(p);
                            }
                            ICoreWebView2File_Release(f);
                        }
                        IUnknown_Release(obj);
                    }
                    free(u);
                    u = cJSON_PrintUnformatted(root);
                    cJSON_Delete(root);
                }
            }
            ICoreWebView2ObjectCollectionView_Release(objs);
        }
        ICoreWebView2WebMessageReceivedEventArgs2_Release(a2);
    }
    if (!PostMessageW(g.hwnd, WM_APP_WEBMSG, 0, (LPARAM)u)) free(u);
    return S_OK;
}
VTBL(vtWebMessage, OnWebMessage);
STATIC_HANDLER(hWebMessage, vtWebMessage, &IID_ICoreWebView2WebMessageReceivedEventHandler);

/* Tasti che la pagina riceverebbe ma che spettano alla finestra: Alt da solo e
 * F10 aprono il menu, Alt+lettera apre la voce corrispondente, Alt+F4 chiude. */
static HRESULT STDMETHODCALLTYPE OnAcceleratorKey(void *self, ICoreWebView2Controller *sender, ICoreWebView2AcceleratorKeyPressedEventArgs *args)
{
    (void)self; (void)sender;
    COREWEBVIEW2_KEY_EVENT_KIND kind;
    UINT key = 0;
    ICoreWebView2AcceleratorKeyPressedEventArgs_get_KeyEventKind(args, &kind);
    ICoreWebView2AcceleratorKeyPressedEventArgs_get_VirtualKey(args, &key);
    BOOL ctrl = GetKeyState(VK_CONTROL) < 0;
    BOOL shift = GetKeyState(VK_SHIFT) < 0;

    if (kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN || kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_DOWN) {
        if (key == VK_MENU) {
            COREWEBVIEW2_PHYSICAL_KEY_STATUS st;
            ICoreWebView2AcceleratorKeyPressedEventArgs_get_PhysicalKeyStatus(args, &st);
            if (!st.WasKeyDown) altAlone = !ctrl; /* Ctrl+Alt = AltGr: non è il menu */
            return S_OK;
        }
        altAlone = FALSE;
        if (kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN && !ctrl) {
            if (key == VK_F4) {
                ICoreWebView2AcceleratorKeyPressedEventArgs_put_Handled(args, TRUE);
                PostMessageW(g.hwnd, WM_CLOSE, 0, 0);
                return S_OK;
            }
            if (!shift && key >= 'A' && key <= 'Z' && menu_has_mnemonic((wchar_t)key)) {
                ICoreWebView2AcceleratorKeyPressedEventArgs_put_Handled(args, TRUE);
                PostMessageW(g.hwnd, WM_SYSCOMMAND, SC_KEYMENU, (LPARAM)(key | 0x20));
                return S_OK;
            }
            if (!shift && key == VK_SPACE) {
                ICoreWebView2AcceleratorKeyPressedEventArgs_put_Handled(args, TRUE);
                PostMessageW(g.hwnd, WM_SYSCOMMAND, SC_KEYMENU, (LPARAM)' ');
                return S_OK;
            }
        }
        if (kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_DOWN && key == VK_F10 && !shift && !ctrl) {
            ICoreWebView2AcceleratorKeyPressedEventArgs_put_Handled(args, TRUE);
            PostMessageW(g.hwnd, WM_SYSCOMMAND, SC_KEYMENU, 0);
            return S_OK;
        }
    } else if (kind == COREWEBVIEW2_KEY_EVENT_KIND_SYSTEM_KEY_UP || kind == COREWEBVIEW2_KEY_EVENT_KIND_KEY_UP) {
        if (key == VK_MENU && altAlone && g.menu && !g.fullscreen) {
            altAlone = FALSE;
            ICoreWebView2AcceleratorKeyPressedEventArgs_put_Handled(args, TRUE);
            PostMessageW(g.hwnd, WM_SYSCOMMAND, SC_KEYMENU, 0);
        }
    }
    return S_OK;
}
VTBL(vtAccel, OnAcceleratorKey);
STATIC_HANDLER(hAccel, vtAccel, &IID_ICoreWebView2AcceleratorKeyPressedEventHandler);

static BOOL is_app_uri(const wchar_t *uri)
{
    static const wchar_t prefix[] = L"https://" APP_HOST L"/";
    return uri && _wcsnicmp(uri, prefix, wcslen(prefix)) == 0;
}

/* I link esterni non devono mai sostituire l'editor: vanno al browser. */
static HRESULT STDMETHODCALLTYPE OnNavigationStarting(void *self, ICoreWebView2 *sender, ICoreWebView2NavigationStartingEventArgs *args)
{
    (void)self; (void)sender;
    LPWSTR uri = NULL;
    ICoreWebView2NavigationStartingEventArgs_get_Uri(args, &uri);
    if (uri && !is_app_uri(uri) && _wcsnicmp(uri, L"about:", 6) != 0) {
        ICoreWebView2NavigationStartingEventArgs_put_Cancel(args, TRUE);
        native_open_external(uri);
    }
    if (uri) CoTaskMemFree(uri);
    return S_OK;
}
VTBL(vtNavStart, OnNavigationStarting);
STATIC_HANDLER(hNavStart, vtNavStart, &IID_ICoreWebView2NavigationStartingEventHandler);

static HRESULT STDMETHODCALLTYPE OnNewWindow(void *self, ICoreWebView2 *sender, ICoreWebView2NewWindowRequestedEventArgs *args)
{
    (void)self; (void)sender;
    LPWSTR uri = NULL;
    ICoreWebView2NewWindowRequestedEventArgs_get_Uri(args, &uri);
    ICoreWebView2NewWindowRequestedEventArgs_put_Handled(args, TRUE);
    if (uri) { native_open_external(uri); CoTaskMemFree(uri); }
    return S_OK;
}
VTBL(vtNewWindow, OnNewWindow);
STATIC_HANDLER(hNewWindow, vtNewWindow, &IID_ICoreWebView2NewWindowRequestedEventHandler);

/* Gli appunti servono all'"Incolla" del menu: la pagina è nostra, si concede. */
static HRESULT STDMETHODCALLTYPE OnPermission(void *self, ICoreWebView2 *sender, ICoreWebView2PermissionRequestedEventArgs *args)
{
    (void)self; (void)sender;
    COREWEBVIEW2_PERMISSION_KIND k;
    ICoreWebView2PermissionRequestedEventArgs_get_PermissionKind(args, &k);
    if (k == COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ)
        ICoreWebView2PermissionRequestedEventArgs_put_State(args, COREWEBVIEW2_PERMISSION_STATE_ALLOW);
    else
        ICoreWebView2PermissionRequestedEventArgs_put_State(args, COREWEBVIEW2_PERMISSION_STATE_DENY);
    return S_OK;
}
VTBL(vtPermission, OnPermission);
STATIC_HANDLER(hPermission, vtPermission, &IID_ICoreWebView2PermissionRequestedEventHandler);

/* Se il processo di rendering si blocca, si ricarica: i testi non salvati
 * sono comunque al sicuro nella copia di recupero della pagina. */
static HRESULT STDMETHODCALLTYPE OnProcessFailed(void *self, ICoreWebView2 *sender, ICoreWebView2ProcessFailedEventArgs *args)
{
    (void)self; (void)args;
    g.pageReady = FALSE;
    ICoreWebView2_Reload(sender);
    return S_OK;
}
VTBL(vtProcessFailed, OnProcessFailed);
STATIC_HANDLER(hProcessFailed, vtProcessFailed, &IID_ICoreWebView2ProcessFailedEventHandler);

/* Menu contestuale nativo (con i suggerimenti del correttore ortografico)
 * ripulito dalle voci da browser che in un editor non hanno senso. */
static HRESULT STDMETHODCALLTYPE OnContextMenu(void *self, ICoreWebView2 *sender, ICoreWebView2ContextMenuRequestedEventArgs *args)
{
    (void)self; (void)sender;
    static const wchar_t *drop[] = {
        L"back", L"forward", L"reload", L"saveAs", L"print", L"createQrCode", L"inspectElement",
        L"share", L"webCapture", L"saveImageAs", L"openLinkInNewWindow", L"saveLinkAs",
        L"copyImageLocation", L"openImageInNewWindow", L"readAloud", L"translate", L"other", NULL
    };
    ICoreWebView2ContextMenuItemCollection *items = NULL;
    if (FAILED(ICoreWebView2ContextMenuRequestedEventArgs_get_MenuItems(args, &items)) || !items) return S_OK;
    UINT32 n = 0;
    ICoreWebView2ContextMenuItemCollection_get_Count(items, &n);
    for (INT32 i = (INT32)n - 1; i >= 0; i--) {
        ICoreWebView2ContextMenuItem *it = NULL;
        if (FAILED(ICoreWebView2ContextMenuItemCollection_GetValueAtIndex(items, (UINT32)i, &it)) || !it) continue;
        LPWSTR name = NULL;
        ICoreWebView2ContextMenuItem_get_Name(it, &name);
        BOOL remove = FALSE;
        for (int k = 0; name && drop[k]; k++) if (wcscmp(name, drop[k]) == 0) { remove = TRUE; break; }
        if (name) CoTaskMemFree(name);
        ICoreWebView2ContextMenuItem_Release(it);
        if (remove) ICoreWebView2ContextMenuItemCollection_RemoveValueAtIndex(items, (UINT32)i);
    }
    /* Niente separatori in testa, in coda o doppi */
    ICoreWebView2ContextMenuItemCollection_get_Count(items, &n);
    BOOL prevSep = TRUE;
    for (UINT32 i = 0; i < n;) {
        ICoreWebView2ContextMenuItem *it = NULL;
        if (FAILED(ICoreWebView2ContextMenuItemCollection_GetValueAtIndex(items, i, &it)) || !it) { i++; continue; }
        COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND kind;
        ICoreWebView2ContextMenuItem_get_Kind(it, &kind);
        ICoreWebView2ContextMenuItem_Release(it);
        BOOL sep = kind == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR;
        if (sep && (prevSep || i == n - 1)) {
            ICoreWebView2ContextMenuItemCollection_RemoveValueAtIndex(items, i);
            n--;
            continue;
        }
        prevSep = sep;
        i++;
    }
    ICoreWebView2ContextMenuItemCollection_Release(items);
    return S_OK;
}
VTBL(vtContextMenu, OnContextMenu);
STATIC_HANDLER(hContextMenu, vtContextMenu, &IID_ICoreWebView2ContextMenuRequestedEventHandler);

/* ---------- mappatura delle cartelle ----------
 * L'interfaccia sta in <exe>\app ed è servita come https://app.mdflash.example/.
 * Ogni unità disco ha un suo nome (es. c.drive.mdflash.example) così le immagini
 * con percorso relativo al documento si vedono senza aprire l'accesso a file://. */

static void map_drives(void)
{
    ICoreWebView2_3 *w3 = NULL;
    if (FAILED(ICoreWebView2_QueryInterface(g.webview, &IID_ICoreWebView2_3, (void **)&w3)) || !w3) return;
    wchar_t appDir[MAX_PATH];
    path_join(appDir, MAX_PATH, g.exeDir, L"app");
    ICoreWebView2_3_SetVirtualHostNameToFolderMapping(w3, APP_HOST, appDir, COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
    DWORD drives = GetLogicalDrives();
    for (int i = 0; i < 26; i++) {
        if (!(drives & (1u << i))) continue;
        wchar_t host[64], root[8];
        _snwprintf(host, 64, DRIVE_HOST_FMT, L'a' + i);
        host[63] = 0;
        _snwprintf(root, 8, L"%c:\\", L'A' + i);
        UINT type = GetDriveTypeW(root);
        if (type == DRIVE_NO_ROOT_DIR || type == DRIVE_UNKNOWN) continue;
        ICoreWebView2_3_SetVirtualHostNameToFolderMapping(w3, host, root, COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_ALLOW);
    }
    ICoreWebView2_3_Release(w3);
}

void webview_remap_drives(void)
{
    if (g.webview) map_drives();
}

/* ---------- creazione ---------- */

static HRESULT STDMETHODCALLTYPE OnControllerCreated(void *self, HRESULT hr, ICoreWebView2Controller *controller)
{
    (void)self;
    if (FAILED(hr) || !controller) {
        wchar_t msg[512];
        _snwprintf(msg, 512, tr(S_WV2_FAIL), (unsigned long)hr);
        msg[511] = 0;
        MessageBoxW(g.hwnd, msg, APP_NAME, MB_ICONERROR);
        PostQuitMessage(1);
        return S_OK;
    }
    g.controller = controller;
    ICoreWebView2Controller_AddRef(controller);
    ICoreWebView2Controller_get_CoreWebView2(controller, &g.webview);

    /* Sfondo uguale al tema: niente lampo bianco all'avvio */
    webview_set_bg(g.bgColor);

    ICoreWebView2Settings *s = NULL;
    ICoreWebView2_get_Settings(g.webview, &s);
    if (s) {
        ICoreWebView2Settings_put_IsStatusBarEnabled(s, FALSE);
        ICoreWebView2Settings_put_AreDevToolsEnabled(s, TRUE);
        ICoreWebView2Settings_put_IsZoomControlEnabled(s, TRUE);
        ICoreWebView2Settings_put_AreDefaultScriptDialogsEnabled(s, TRUE);
        ICoreWebView2Settings_put_IsBuiltInErrorPageEnabled(s, TRUE);
        ICoreWebView2Settings3 *s3 = NULL;
        if (SUCCEEDED(ICoreWebView2Settings_QueryInterface(s, &IID_ICoreWebView2Settings3, (void **)&s3)) && s3) {
            /* Ctrl+F, Ctrl+P, F5 ecc. li gestisce l'editor, non il browser */
            ICoreWebView2Settings3_put_AreBrowserAcceleratorKeysEnabled(s3, FALSE);
            ICoreWebView2Settings3_Release(s3);
        }
        ICoreWebView2Settings_Release(s);
    }

    ICoreWebView2_add_WebMessageReceived(g.webview, (ICoreWebView2WebMessageReceivedEventHandler *)&hWebMessage, &tok);
    ICoreWebView2_add_NavigationStarting(g.webview, (ICoreWebView2NavigationStartingEventHandler *)&hNavStart, &tok);
    ICoreWebView2_add_NewWindowRequested(g.webview, (ICoreWebView2NewWindowRequestedEventHandler *)&hNewWindow, &tok);
    ICoreWebView2_add_PermissionRequested(g.webview, (ICoreWebView2PermissionRequestedEventHandler *)&hPermission, &tok);
    ICoreWebView2_add_ProcessFailed(g.webview, (ICoreWebView2ProcessFailedEventHandler *)&hProcessFailed, &tok);
    ICoreWebView2Controller_add_AcceleratorKeyPressed(controller, (ICoreWebView2AcceleratorKeyPressedEventHandler *)&hAccel, &tok);

    ICoreWebView2_11 *w11 = NULL;
    if (SUCCEEDED(ICoreWebView2_QueryInterface(g.webview, &IID_ICoreWebView2_11, (void **)&w11)) && w11) {
        ICoreWebView2_11_add_ContextMenuRequested(w11, (ICoreWebView2ContextMenuRequestedEventHandler *)&hContextMenu, &tok);
        ICoreWebView2_11_Release(w11);
    }

    map_drives();
    webview_resize();
    ICoreWebView2_Navigate(g.webview, L"https://" APP_HOST L"/index.html");
    ICoreWebView2Controller_MoveFocus(controller, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
    return S_OK;
}
VTBL(vtController, OnControllerCreated);
STATIC_HANDLER(hController, vtController, &IID_ICoreWebView2CreateCoreWebView2ControllerCompletedHandler);

static HRESULT STDMETHODCALLTYPE OnEnvironmentCreated(void *self, HRESULT hr, ICoreWebView2Environment *env)
{
    (void)self;
    if (FAILED(hr) || !env) {
        int r = MessageBoxW(g.hwnd, tr(S_WV2_MISSING), APP_NAME, MB_ICONERROR | MB_YESNO);
        if (r == IDYES) native_open_external(L"https://developer.microsoft.com/microsoft-edge/webview2/");
        PostQuitMessage(1);
        return S_OK;
    }
    g.env = env;
    ICoreWebView2Environment_AddRef(env);
    ICoreWebView2Environment_CreateCoreWebView2Controller(env, g.hwnd,
        (ICoreWebView2CreateCoreWebView2ControllerCompletedHandler *)&hController);
    return S_OK;
}
VTBL(vtEnv, OnEnvironmentCreated);
STATIC_HANDLER(hEnv, vtEnv, &IID_ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler);

typedef HRESULT (STDAPICALLTYPE *CreateEnvFn)(PCWSTR, PCWSTR, ICoreWebView2EnvironmentOptions *,
                                              ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *);

void webview_create(void)
{
    /* Il caricatore ufficiale (WebView2Loader.dll) sta accanto all'eseguibile */
    wchar_t loader[MAX_PATH];
    path_join(loader, MAX_PATH, g.exeDir, L"WebView2Loader.dll");
    HMODULE mod = LoadLibraryW(loader);
    if (!mod) mod = LoadLibraryW(L"WebView2Loader.dll");
    CreateEnvFn create = mod ? (CreateEnvFn)(void *)GetProcAddress(mod, "CreateCoreWebView2EnvironmentWithOptions") : NULL;
    if (!create) {
        MessageBoxW(g.hwnd, tr(S_LOADER_MISSING), APP_NAME, MB_ICONERROR);
        PostQuitMessage(1);
        return;
    }
    /* I dati del motore vanno in %LOCALAPPDATA%: la cartella del programma
     * (Program Files) non è scrivibile. */
    wchar_t udf[MAX_PATH];
    path_join(udf, MAX_PATH, g.dataDir, L"WebView2");
    HRESULT hr = create(NULL, udf, NULL, (ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler *)&hEnv);
    if (FAILED(hr)) OnEnvironmentCreated(NULL, hr, NULL);
}

void webview_resize(void)
{
    if (!g.controller) return;
    RECT rc;
    GetClientRect(g.hwnd, &rc);
    ICoreWebView2Controller_put_Bounds(g.controller, rc);
}

void webview_focus(void)
{
    if (g.controller) ICoreWebView2Controller_MoveFocus(g.controller, COREWEBVIEW2_MOVE_FOCUS_REASON_PROGRAMMATIC);
}

void webview_set_bg(COLORREF c)
{
    if (!g.controller) return;
    ICoreWebView2Controller2 *c2 = NULL;
    if (SUCCEEDED(ICoreWebView2Controller_QueryInterface(g.controller, &IID_ICoreWebView2Controller2, (void **)&c2)) && c2) {
        COREWEBVIEW2_COLOR col = { 255, GetRValue(c), GetGValue(c), GetBValue(c) };
        ICoreWebView2Controller2_put_DefaultBackgroundColor(c2, col);
        ICoreWebView2Controller2_Release(c2);
    }
}

void webview_open_devtools(void)
{
    if (g.webview) ICoreWebView2_OpenDevToolsWindow(g.webview);
}

void webview_set_zoom(double z)
{
    if (g.controller) ICoreWebView2Controller_put_ZoomFactor(g.controller, z);
}

double webview_get_zoom(void)
{
    double z = 1.0;
    if (g.controller) ICoreWebView2Controller_get_ZoomFactor(g.controller, &z);
    return z;
}

/* ---------- PDF ---------- */

static HRESULT STDMETHODCALLTYPE OnPdfDone(void *self, HRESULT hr, BOOL ok)
{
    Handler *h = (Handler *)self;
    webview_set_bg(g.bgColor); /* torna il colore del tema dopo la pagina bianca */
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "re", h->replyId);
    cJSON *d = cJSON_AddObjectToObject(o, "data");
    if (SUCCEEDED(hr) && ok) cJSON_AddBoolToObject(d, "ok", 1);
    else json_add_tr(d, "error", S_PDF_FAIL);
    webview_post_obj(o);
    return S_OK;
}
VTBL(vtPdf, OnPdfDone);

void webview_print_pdf(const wchar_t *path, cJSON *opts, int replyId)
{
    ICoreWebView2_7 *w7 = NULL;
    ICoreWebView2Environment6 *e6 = NULL;
    ICoreWebView2PrintSettings *ps = NULL;
    if (FAILED(ICoreWebView2_QueryInterface(g.webview, &IID_ICoreWebView2_7, (void **)&w7)) || !w7) goto fail;
    if (SUCCEEDED(ICoreWebView2Environment_QueryInterface(g.env, &IID_ICoreWebView2Environment6, (void **)&e6)) && e6) {
        ICoreWebView2Environment6_CreatePrintSettings(e6, &ps);
        ICoreWebView2Environment6_Release(e6);
    }
    if (ps) {
        /* misure in pollici; A4 predefinito */
        double w = json_num(opts, "pageWidth", 8.27), hgt = json_num(opts, "pageHeight", 11.69);
        double m = json_num(opts, "margin", 0.6);
        ICoreWebView2PrintSettings_put_PageWidth(ps, w);
        ICoreWebView2PrintSettings_put_PageHeight(ps, hgt);
        ICoreWebView2PrintSettings_put_MarginTop(ps, m);
        ICoreWebView2PrintSettings_put_MarginBottom(ps, m);
        ICoreWebView2PrintSettings_put_MarginLeft(ps, m);
        ICoreWebView2PrintSettings_put_MarginRight(ps, m);
        ICoreWebView2PrintSettings_put_ShouldPrintBackgrounds(ps, json_bool(opts, "backgrounds", TRUE));
        ICoreWebView2PrintSettings_put_ShouldPrintHeaderAndFooter(ps, json_bool(opts, "headerFooter", FALSE));
        ICoreWebView2PrintSettings_put_Orientation(ps, json_bool(opts, "landscape", FALSE)
            ? COREWEBVIEW2_PRINT_ORIENTATION_LANDSCAPE : COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT);
    }
    /* i margini del PDF prendono il colore di fondo del controllo: bianco */
    webview_set_bg(RGB(255, 255, 255));
    Handler *h = (Handler *)calloc(1, sizeof(Handler));
    h->lpVtbl = &vtPdf; h->ref = 1; h->iid = &IID_ICoreWebView2PrintToPdfCompletedHandler; h->heap = TRUE; h->replyId = replyId;
    HRESULT hr = ICoreWebView2_7_PrintToPdf(w7, path, ps, (ICoreWebView2PrintToPdfCompletedHandler *)h);
    H_Release(h);
    if (ps) ICoreWebView2PrintSettings_Release(ps);
    ICoreWebView2_7_Release(w7);
    if (SUCCEEDED(hr)) return;
    webview_set_bg(g.bgColor);
fail:;
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "re", replyId);
    json_add_tr(cJSON_AddObjectToObject(o, "data"), "error", S_PDF_UNAVAILABLE);
    webview_post_obj(o);
}
