/* MDFlash: dichiarazioni comuni del programma host (Win32 + WebView2). */
#ifndef MDFLASH_APP_H
#define MDFLASH_APP_H

#define COBJMACROS
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0A00
#endif
#ifndef WINVER
#define WINVER 0x0A00
#endif
#define WIN32_LEAN_AND_MEAN
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif

#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shlwapi.h>
#include <commdlg.h>
#include <commctrl.h>
#include <dwmapi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

#include "WebView2.h"
#include "vendor/cJSON.h"

#define APP_NAME        L"MDFlash"
#define APP_VERSION     "2.0.0"
#define APP_VERSION_W   L"2.0.0"
#define APP_CLASS       L"MDFlashMainWindow"
#define APP_HOST        L"app.mdflash.example"
#define DRIVE_HOST_FMT  L"%c.drive.mdflash.example"
#define REG_KEY         L"Software\\MDFlash"

/* Messaggi privati della finestra principale. */
#define WM_APP_WEBMSG     (WM_APP + 1)  /* lParam: char* JSON (UTF-8), da liberare */
#define WM_APP_POSTJSON   (WM_APP + 2)  /* lParam: char* JSON da inoltrare alla pagina */
#define WM_APP_WEBVIEW_OK (WM_APP + 3)

/* ---------- Stato globale ---------- */
typedef struct AppState {
    HINSTANCE hinst;
    HWND hwnd;
    HMENU menu;
    ICoreWebView2Environment *env;
    ICoreWebView2Controller *controller;
    ICoreWebView2 *webview;
    BOOL pageReady;           /* la pagina ha inviato "ready" */
    BOOL fullscreen;
    BOOL topmost;
    BOOL darkChrome;          /* barra del titolo e menu scuri */
    WINDOWPLACEMENT prevPlacement;
    LONG_PTR prevStyle;
    DWORD closeRequestedAt;   /* GetTickCount del primo WM_CLOSE non ancora confermato */
    COLORREF bgColor;
    wchar_t exeDir[MAX_PATH];
    wchar_t dataDir[MAX_PATH];     /* %LOCALAPPDATA%\MDFlash */
    wchar_t roamingDir[MAX_PATH];  /* %APPDATA%\MDFlash (temi, versioni) */
    cJSON *pendingFiles;           /* file da aprire prima che la pagina sia pronta */
    BOOL secondary;                /* aperta con "Nuova finestra": niente sessione */
} AppState;

extern AppState g;

/* ---------- util.c ---------- */
wchar_t *utf8_to_wide(const char *s);           /* malloc */
char *wide_to_utf8(const wchar_t *s);           /* malloc */
char *wide_to_utf8_n(const wchar_t *s, int n);  /* malloc */
unsigned char *base64_decode(const char *in, size_t *outLen); /* malloc */
char *base64_encode(const unsigned char *in, size_t len);     /* malloc */
const char *json_str(const cJSON *obj, const char *key);      /* NULL se assente */
wchar_t *json_wstr(const cJSON *obj, const char *key);        /* malloc, NULL se assente */
int json_int(const cJSON *obj, const char *key, int def);
double json_num(const cJSON *obj, const char *key, double def);
BOOL json_bool(const cJSON *obj, const char *key, BOOL def);
void path_join(wchar_t *out, size_t cap, const wchar_t *a, const wchar_t *b);
void ensure_dir(const wchar_t *path);           /* crea anche i livelli intermedi */
unsigned long long filetime_to_ms(const FILETIME *ft);
char *last_error_utf8(DWORD err);               /* malloc */

/* ---------- fsops.c ---------- */
cJSON *fs_read_text(const wchar_t *path);       /* {text, encoding, bom, eol, mtime} o {error} */
cJSON *fs_write_text(const wchar_t *path, const char *utf8, const char *encoding, BOOL bom, const char *eol);
cJSON *fs_write_binary(const wchar_t *path, const unsigned char *data, size_t len);
cJSON *fs_stat(const wchar_t *path);
cJSON *fs_list_dir(const wchar_t *path);
cJSON *fs_list_tree(const wchar_t *root, int maxFiles);
cJSON *fs_search(const wchar_t *root, const char *query, BOOL caseSensitive, int maxResults);
cJSON *fs_copy(const wchar_t *src, const wchar_t *dst, BOOL overwrite);
cJSON *fs_rename(const wchar_t *src, const wchar_t *dst);
cJSON *fs_trash(const wchar_t *path);
cJSON *fs_mkdir(const wchar_t *path);
cJSON *fs_snapshot(const wchar_t *docPath, const char *utf8, int keep);
cJSON *fs_list_snapshots(const wchar_t *docPath);

/* ---------- webview.c ---------- */
void webview_create(void);
void webview_resize(void);
void webview_post_json(const char *json);       /* thread UI */
void webview_post_obj(cJSON *obj);              /* consuma obj */
void webview_post_event(const char *ev, cJSON *data); /* consuma data */
void webview_focus(void);
void webview_set_bg(COLORREF c);
void webview_print_pdf(const wchar_t *path, cJSON *opts, int replyId);
void webview_open_devtools(void);
void webview_set_zoom(double z);
double webview_get_zoom(void);
void post_json_from_thread(cJSON *obj);         /* qualsiasi thread: consuma obj */
void webview_remap_drives(void);

/* ---------- bridge.c ---------- */
void bridge_handle(const char *json);
void bridge_queue_files(int argc, wchar_t **argv, int start);
void bridge_open_files_now(cJSON *files);

/* ---------- menu.c ---------- */
void menu_build_from_json(const cJSON *def);
const char *menu_command_for_id(UINT id);
void menu_load_cached(void);
void menu_save_cache(const char *json);
LRESULT menu_dark_draw(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp, BOOL *handled);
void menu_set_dark(BOOL dark);
void menu_set_colors(COLORREF bg, COLORREF fg);
BOOL menu_has_mnemonic(wchar_t c);

/* ---------- native.c ---------- */
void native_set_dark_titlebar(BOOL dark);
void native_toggle_fullscreen(void);
void native_set_topmost(BOOL on);
void native_send_keys(const char *combo);
cJSON *native_clipboard_write(const char *text, const char *html);
cJSON *native_clipboard_read(void);
cJSON *native_file_dialog(const cJSON *args, BOOL save);
cJSON *native_folder_dialog(const cJSON *args);
int native_message_box(const cJSON *args);
cJSON *native_find_pandoc(void);
void native_run_pandoc_async(const cJSON *args, int replyId);
void native_http_async(const cJSON *args, int replyId);
cJSON *native_register_association(void);
cJSON *native_open_external(const wchar_t *target);
cJSON *native_show_in_folder(const wchar_t *path);
cJSON *native_list_themes(void);
void native_save_placement(void);
void native_load_placement(int nCmdShow);
DWORD reg_get_dword(const wchar_t *name, DWORD def);
void reg_set_dword(const wchar_t *name, DWORD v);
cJSON *native_export_docx(const wchar_t *path, const char *html);
cJSON *native_export_docx_ex(const wchar_t *path, const char *html, const cJSON *images);
void native_http_abort(int streamId);

/* ---------- lang.c ---------- */
enum {
    S_WV2_FAIL, S_WV2_MISSING, S_LOADER_MISSING, S_NOT_RESPONDING, S_PDF_FAIL, S_PDF_UNAVAILABLE,
    S_FILE_LOCKED, S_CLIPBOARD_BUSY, S_DIALOG_UNAVAILABLE, S_BAD_URL, S_PANDOC_ERROR, S_NET_ERROR,
    S_DOC_TYPE, S_APP_DESC, S_COUNT
};
const wchar_t *tr(int id);
char *tr_utf8(int id);       /* malloc */
void lang_set(const char *code);
void json_add_tr(cJSON *obj, const char *key, int id);

/* ---------- main.c ---------- */
void main_close_canceled(void);

#endif
