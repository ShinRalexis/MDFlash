/* MDFlash: smistamento dei messaggi della pagina.
 *
 * La pagina invia { "t": "<comando>", "id": <numero>, ...argomenti }.
 * Il C risponde con { "re": <id>, "data": {...} }; gli avvisi spontanei del C
 * (file da aprire, voce di menu scelta, finestra attivata) hanno la forma
 * { "ev": "<nome>", "data": {...} }. */
#include "app.h"


static void reply(int id, cJSON *data)
{
    if (id <= 0) { cJSON_Delete(data); return; }
    cJSON *o = cJSON_CreateObject();
    cJSON_AddNumberToObject(o, "re", id);
    cJSON_AddItemToObject(o, "data", data ? data : cJSON_CreateObject());
    webview_post_obj(o);
}

static cJSON *ok(void)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddBoolToObject(o, "ok", 1);
    return o;
}

static COLORREF parse_color(const char *s, COLORREF def)
{
    unsigned r, gg, b;
    if (s && s[0] == '#' && strlen(s) >= 7 && sscanf(s + 1, "%02x%02x%02x", &r, &gg, &b) == 3) return RGB(r, gg, b);
    return def;
}

/* File passati dalla riga di comando (doppio clic su un .md in Esplora risorse) */
void bridge_queue_files(int argc, wchar_t **argv, int start)
{
    if (!g.pendingFiles) g.pendingFiles = cJSON_CreateArray();
    for (int i = start; i < argc; i++) {
        if (argv[i][0] == L'-' && argv[i][1] == L'-') continue; /* opzioni */
        wchar_t full[MAX_PATH * 2];
        if (!GetFullPathNameW(argv[i], MAX_PATH * 2, full, NULL)) continue;
        char *u = wide_to_utf8(full);
        cJSON_AddItemToArray(g.pendingFiles, cJSON_CreateString(u));
        free(u);
    }
}

void bridge_open_files_now(cJSON *files)
{
    cJSON *d = cJSON_CreateObject();
    cJSON_AddItemToObject(d, "paths", files);
    webview_post_event("openFiles", d);
}

static cJSON *startup_info(void)
{
    cJSON *o = cJSON_CreateObject();
    cJSON_AddStringToObject(o, "version", APP_VERSION);
    cJSON_AddBoolToObject(o, "secondary", g.secondary);
    cJSON_AddItemToObject(o, "files", g.pendingFiles ? g.pendingFiles : cJSON_CreateArray());
    g.pendingFiles = NULL;
    cJSON_AddItemToObject(o, "pandoc", native_find_pandoc());
    wchar_t docs[MAX_PATH];
    if (SUCCEEDED(SHGetFolderPathW(NULL, CSIDL_PERSONAL, NULL, 0, docs))) {
        char *u = wide_to_utf8(docs);
        cJSON_AddStringToObject(o, "documents", u);
        free(u);
    }
    char *rd = wide_to_utf8(g.roamingDir);
    cJSON_AddStringToObject(o, "dataDir", rd);
    free(rd);
    wchar_t tmp[MAX_PATH];
    GetTempPathW(MAX_PATH, tmp);
    char *tu = wide_to_utf8(tmp);
    cJSON_AddStringToObject(o, "temp", tu);
    free(tu);
    cJSON_AddNumberToObject(o, "zoom", webview_get_zoom());
    /* Lingua di Windows, per il correttore e le date */
    wchar_t loc[LOCALE_NAME_MAX_LENGTH];
    if (GetUserDefaultLocaleName(loc, LOCALE_NAME_MAX_LENGTH)) {
        char *u = wide_to_utf8(loc);
        cJSON_AddStringToObject(o, "locale", u);
        free(u);
    }
    /* Windows usa il tema scuro per le app? */
    DWORD light = 1, sz = sizeof light;
    RegGetValueW(HKEY_CURRENT_USER, L"Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
                 L"AppsUseLightTheme", RRF_RT_REG_DWORD, NULL, &light, &sz);
    cJSON_AddBoolToObject(o, "systemDark", light == 0);
    return o;
}

static void native_command(const char *cmd, const cJSON *msg)
{
    if (strcmp(cmd, "fullscreen") == 0) native_toggle_fullscreen();
    else if (strcmp(cmd, "topmost") == 0) native_set_topmost(json_bool(msg, "on", !g.topmost));
    else if (strcmp(cmd, "devtools") == 0) webview_open_devtools();
    else if (strcmp(cmd, "zoomIn") == 0) webview_set_zoom(webview_get_zoom() * 1.1);
    else if (strcmp(cmd, "zoomOut") == 0) webview_set_zoom(webview_get_zoom() / 1.1);
    else if (strcmp(cmd, "zoomReset") == 0) webview_set_zoom(1.0);
    else if (strcmp(cmd, "minimize") == 0) ShowWindow(g.hwnd, SW_MINIMIZE);
    else if (strcmp(cmd, "focusWindow") == 0) {
        if (IsIconic(g.hwnd)) ShowWindow(g.hwnd, SW_RESTORE);
        SetForegroundWindow(g.hwnd);
    }
}

void bridge_handle(const char *json)
{
    cJSON *m = cJSON_Parse(json);
    if (!m) return;
    const char *t = json_str(m, "t");
    int id = json_int(m, "id", 0);
    if (!t) { cJSON_Delete(m); return; }

    wchar_t *path = json_wstr(m, "path");

    if (strcmp(t, "ready") == 0) {
        g.pageReady = TRUE;
        reply(id, startup_info());
    } else if (strcmp(t, "readFile") == 0) {
        reply(id, path ? fs_read_text(path) : NULL);
    } else if (strcmp(t, "writeFile") == 0) {
        const char *text = json_str(m, "text");
        reply(id, path && text ? fs_write_text(path, text, json_str(m, "encoding"), json_bool(m, "bom", FALSE), json_str(m, "eol")) : NULL);
    } else if (strcmp(t, "writeBinary") == 0) {
        const char *b64 = json_str(m, "data");
        if (path && b64) {
            size_t n = 0;
            unsigned char *bin = base64_decode(b64, &n);
            reply(id, fs_write_binary(path, bin, n));
            free(bin);
        } else reply(id, NULL);
    } else if (strcmp(t, "stat") == 0) {
        reply(id, path ? fs_stat(path) : NULL);
    } else if (strcmp(t, "statMany") == 0) {
        cJSON *out = cJSON_CreateObject();
        cJSON *arr = cJSON_AddArrayToObject(out, "stats");
        const cJSON *p;
        cJSON_ArrayForEach(p, cJSON_GetObjectItemCaseSensitive(m, "paths")) {
            wchar_t *w = utf8_to_wide(cJSON_IsString(p) ? p->valuestring : "");
            cJSON_AddItemToArray(arr, fs_stat(w));
            free(w);
        }
        reply(id, out);
    } else if (strcmp(t, "listDir") == 0) {
        reply(id, path ? fs_list_dir(path) : NULL);
    } else if (strcmp(t, "listTree") == 0) {
        reply(id, path ? fs_list_tree(path, json_int(m, "max", 5000)) : NULL);
    } else if (strcmp(t, "search") == 0) {
        reply(id, path ? fs_search(path, json_str(m, "query") ? json_str(m, "query") : "",
                                   json_bool(m, "caseSensitive", FALSE), json_int(m, "max", 500)) : NULL);
    } else if (strcmp(t, "copy") == 0 || strcmp(t, "rename") == 0) {
        wchar_t *dst = json_wstr(m, "dest");
        if (path && dst) reply(id, t[0] == 'c' ? fs_copy(path, dst, json_bool(m, "overwrite", FALSE)) : fs_rename(path, dst));
        else reply(id, NULL);
        free(dst);
    } else if (strcmp(t, "trash") == 0) {
        reply(id, path ? fs_trash(path) : NULL);
    } else if (strcmp(t, "mkdir") == 0) {
        reply(id, path ? fs_mkdir(path) : NULL);
    } else if (strcmp(t, "snapshot") == 0) {
        const char *text = json_str(m, "text");
        reply(id, path && text ? fs_snapshot(path, text, json_int(m, "keep", 50)) : NULL);
    } else if (strcmp(t, "listSnapshots") == 0) {
        reply(id, path ? fs_list_snapshots(path) : NULL);
    } else if (strcmp(t, "openDialog") == 0) {
        reply(id, native_file_dialog(m, FALSE));
    } else if (strcmp(t, "saveDialog") == 0) {
        reply(id, native_file_dialog(m, TRUE));
    } else if (strcmp(t, "folderDialog") == 0) {
        reply(id, native_folder_dialog(m));
    } else if (strcmp(t, "confirm") == 0) {
        cJSON *o = cJSON_CreateObject();
        cJSON_AddNumberToObject(o, "index", native_message_box(m));
        reply(id, o);
    } else if (strcmp(t, "clipboardWrite") == 0) {
        reply(id, native_clipboard_write(json_str(m, "text"), json_str(m, "html")));
    } else if (strcmp(t, "clipboardRead") == 0) {
        reply(id, native_clipboard_read());
    } else if (strcmp(t, "setTitle") == 0) {
        wchar_t *title = json_wstr(m, "title");
        if (title) { SetWindowTextW(g.hwnd, title); free(title); }
        reply(id, ok());
    } else if (strcmp(t, "setMenu") == 0) {
        const cJSON *def = cJSON_GetObjectItemCaseSensitive(m, "menu");
        menu_build_from_json(def);
        char *s = cJSON_PrintUnformatted(def);
        if (s) { menu_save_cache(s); free(s); }
        reply(id, ok());
    } else if (strcmp(t, "setChrome") == 0) {
        /* colori della cornice: barra del titolo, menu, sfondo iniziale */
        g.darkChrome = json_bool(m, "dark", FALSE);
        g.bgColor = parse_color(json_str(m, "bg"), RGB(255, 255, 255));
        COLORREF fg = parse_color(json_str(m, "fg"), RGB(32, 32, 32));
        menu_set_colors(g.bgColor, fg);
        menu_set_dark(g.darkChrome);
        native_set_dark_titlebar(g.darkChrome);
        webview_set_bg(g.bgColor);
        reg_set_dword(L"BgColor", g.bgColor);
        reg_set_dword(L"FgColor", fg);
        reg_set_dword(L"Dark", g.darkChrome);
        RedrawWindow(g.hwnd, NULL, NULL, RDW_FRAME | RDW_INVALIDATE);
        reply(id, ok());
    } else if (strcmp(t, "native") == 0) {
        const char *cmd = json_str(m, "cmd");
        if (cmd) native_command(cmd, m);
        cJSON *o = ok();
        cJSON_AddBoolToObject(o, "fullscreen", g.fullscreen);
        cJSON_AddBoolToObject(o, "topmost", g.topmost);
        cJSON_AddNumberToObject(o, "zoom", webview_get_zoom());
        reply(id, o);
    } else if (strcmp(t, "sendKeys") == 0) {
        const char *k = json_str(m, "keys");
        if (k) native_send_keys(k);
        reply(id, ok());
    } else if (strcmp(t, "printPdf") == 0) {
        if (path) webview_print_pdf(path, m, id);
        else reply(id, NULL);
    } else if (strcmp(t, "pandoc") == 0) {
        native_run_pandoc_async(m, id);
    } else if (strcmp(t, "http") == 0) {
        native_http_async(m, id);
    } else if (strcmp(t, "httpAbort") == 0) {
        native_http_abort(json_int(m, "streamId", 0));
        reply(id, ok());
    } else if (strcmp(t, "openExternal") == 0) {
        wchar_t *u = json_wstr(m, "url");
        reply(id, u ? native_open_external(u) : NULL);
        free(u);
    } else if (strcmp(t, "showInFolder") == 0) {
        reply(id, path ? native_show_in_folder(path) : NULL);
    } else if (strcmp(t, "listThemes") == 0) {
        reply(id, native_list_themes());
    } else if (strcmp(t, "registerAssoc") == 0) {
        reply(id, native_register_association());
    } else if (strcmp(t, "exportDocx") == 0) {
        const char *html = json_str(m, "html");
        reply(id, path && html ? native_export_docx_ex(path, html, cJSON_GetObjectItemCaseSensitive(m, "images")) : NULL);
    } else if (strcmp(t, "addRecentDoc") == 0) {
        if (path) SHAddToRecentDocs(SHARD_PATHW, path);
        reply(id, ok());
    } else if (strcmp(t, "newWindow") == 0) {
        wchar_t exe[MAX_PATH], args[MAX_PATH * 2 + 32];
        GetModuleFileNameW(NULL, exe, MAX_PATH);
        if (path) _snwprintf(args, MAX_PATH * 2 + 32, L"--new-window \"%s\"", path);
        else wcscpy(args, L"--new-window");
        args[MAX_PATH * 2 + 31] = 0;
        ShellExecuteW(NULL, L"open", exe, args, NULL, SW_SHOWNORMAL);
        reply(id, ok());
    } else if (strcmp(t, "remapDrives") == 0) {
        webview_remap_drives();
        reply(id, ok());
    } else if (strcmp(t, "quit") == 0) {
        reply(id, ok());
        native_save_placement();
        DestroyWindow(g.hwnd);
    } else if (strcmp(t, "resolveFiles") == 0) {
        /* percorsi dei file trascinati, aggiunti da OnWebMessage in "_files" */
        cJSON *o = cJSON_CreateObject();
        cJSON *files = cJSON_GetObjectItemCaseSensitive(m, "_files");
        cJSON_AddItemToObject(o, "paths", files ? cJSON_Duplicate(files, 1) : cJSON_CreateArray());
        reply(id, o);
    } else if (strcmp(t, "setLanguage") == 0) {
        lang_set(json_str(m, "lang"));
        reply(id, ok());
    } else if (strcmp(t, "closeCanceled") == 0) {
        main_close_canceled();
        reply(id, ok());
    } else if (strcmp(t, "log") == 0) {
        const char *s = json_str(m, "text");
        if (s) { OutputDebugStringA(s); OutputDebugStringA("\n"); }
        reply(id, ok());
    } else {
        cJSON *o = cJSON_CreateObject();
        cJSON_AddStringToObject(o, "error", "comando sconosciuto");
        reply(id, o);
    }
    free(path);
    cJSON_Delete(m);
}
