/* MDFlash: barra dei menu nativa.
 *
 * La struttura del menu arriva dalla pagina come JSON:
 *   [ { "label": "&File", "items": [ { "label": "Salva", "cmd": "file.save",
 *        "accel": "Ctrl+S", "checked": false, "enabled": true, "radio": false,
 *        "items": [...] }, { "sep": true } ] } ]
 * Così testi, scorciatoie e voci dinamiche (file recenti, temi) stanno in un
 * solo posto. L'ultima versione viene salvata su disco e riusata all'avvio,
 * per avere il menu già prima che la pagina finisca di caricare. */
#include "app.h"
#include <uxtheme.h>
#include <vssym32.h>

#define FIRST_ID 1000

static char **cmds = NULL;     /* cmds[id - FIRST_ID] */
static int cmdCount = 0, cmdCap = 0;
static wchar_t mnemonics[32];
static BOOL darkMenu = FALSE;
static COLORREF barBg = RGB(32, 32, 32), barFg = RGB(230, 230, 230), barHot = RGB(62, 62, 62);

static UINT add_cmd(const char *cmd)
{
    if (cmdCount == cmdCap) {
        cmdCap = cmdCap ? cmdCap * 2 : 128;
        cmds = (char **)realloc(cmds, sizeof(char *) * (size_t)cmdCap);
    }
    cmds[cmdCount] = _strdup(cmd ? cmd : "");
    return (UINT)(FIRST_ID + cmdCount++);
}

const char *menu_command_for_id(UINT id)
{
    if (id < FIRST_ID || id >= (UINT)(FIRST_ID + cmdCount)) return NULL;
    return cmds[id - FIRST_ID];
}

BOOL menu_has_mnemonic(wchar_t c)
{
    c = (wchar_t)towlower(c);
    for (int i = 0; mnemonics[i]; i++) if (mnemonics[i] == c) return TRUE;
    return FALSE;
}

static void fill_menu(HMENU menu, const cJSON *items)
{
    const cJSON *it;
    cJSON_ArrayForEach(it, items) {
        if (json_bool(it, "sep", FALSE)) { AppendMenuW(menu, MF_SEPARATOR, 0, NULL); continue; }
        const char *label = json_str(it, "label");
        const char *accel = json_str(it, "accel");
        char text[512];
        if (accel && *accel) snprintf(text, sizeof text, "%s\t%s", label ? label : "", accel);
        else snprintf(text, sizeof text, "%s", label ? label : "");
        wchar_t *w = utf8_to_wide(text);
        const cJSON *sub = cJSON_GetObjectItemCaseSensitive(it, "items");
        UINT flags = MF_STRING;
        if (!json_bool(it, "enabled", TRUE)) flags |= MF_GRAYED;
        if (json_bool(it, "checked", FALSE)) flags |= MF_CHECKED;
        if (cJSON_IsArray(sub)) {
            HMENU pop = CreatePopupMenu();
            fill_menu(pop, sub);
            AppendMenuW(menu, flags | MF_POPUP, (UINT_PTR)pop, w);
        } else {
            UINT id = add_cmd(json_str(it, "cmd"));
            AppendMenuW(menu, flags, id, w);
            if (json_bool(it, "radio", FALSE) && json_bool(it, "checked", FALSE)) {
                MENUITEMINFOW mi = { sizeof mi };
                mi.fMask = MIIM_FTYPE | MIIM_STATE;
                mi.fType = MFT_STRING | MFT_RADIOCHECK;
                mi.fState = MFS_CHECKED | ((flags & MF_GRAYED) ? MFS_GRAYED : 0);
                SetMenuItemInfoW(menu, id, FALSE, &mi);
            }
        }
        free(w);
    }
}

void menu_build_from_json(const cJSON *def)
{
    if (!cJSON_IsArray(def)) return;
    for (int i = 0; i < cmdCount; i++) free(cmds[i]);
    cmdCount = 0;
    HMENU bar = CreateMenu();
    int m = 0;
    const cJSON *top;
    cJSON_ArrayForEach(top, def) {
        const char *label = json_str(top, "label");
        wchar_t *w = utf8_to_wide(label ? label : "");
        HMENU pop = CreatePopupMenu();
        fill_menu(pop, cJSON_GetObjectItemCaseSensitive(top, "items"));
        AppendMenuW(bar, MF_STRING | MF_POPUP, (UINT_PTR)pop, w);
        const wchar_t *amp = wcschr(w, L'&');
        if (amp && amp[1] && m < 31) mnemonics[m++] = (wchar_t)towlower(amp[1]);
        free(w);
    }
    mnemonics[m] = 0;
    HMENU old = g.menu;
    g.menu = bar;
    if (!g.fullscreen) SetMenu(g.hwnd, bar);
    if (old) DestroyMenu(old);
    DrawMenuBar(g.hwnd);
}

void menu_save_cache(const char *json)
{
    wchar_t p[MAX_PATH];
    path_join(p, MAX_PATH, g.dataDir, L"menu.json");
    FILE *f = _wfopen(p, L"wb");
    if (f) { fwrite(json, 1, strlen(json), f); fclose(f); }
}

void menu_load_cached(void)
{
    wchar_t p[MAX_PATH];
    path_join(p, MAX_PATH, g.dataDir, L"menu.json");
    FILE *f = _wfopen(p, L"rb");
    if (!f) return;
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    if (n > 0 && n < 4 * 1024 * 1024) {
        char *buf = (char *)malloc((size_t)n + 1);
        if (fread(buf, 1, (size_t)n, f) == (size_t)n) {
            buf[n] = 0;
            cJSON *def = cJSON_Parse(buf);
            if (def) { menu_build_from_json(def); cJSON_Delete(def); }
        }
        free(buf);
    }
    fclose(f);
}

/* ---------- barra dei menu scura ----------
 * Windows non disegna in scuro la barra dei menu. Si usano i messaggi non
 * documentati WM_UAHDRAWMENU / WM_UAHDRAWMENUITEM (la stessa tecnica di
 * Notepad++ e di altri programmi Win32) e, per i menu a tendina, la modalità
 * scura di uxtheme (funzioni esportate solo per numero ordinale). */

#define WM_UAHDRAWMENU      0x0091
#define WM_UAHDRAWMENUITEM  0x0092

typedef struct { HMENU hmenu; HDC hdc; DWORD dwFlags; } UAHMENU;
typedef union {
    struct { DWORD cx, cy; } rgsizeBar[2];
    struct { DWORD cx, cy; } rgsizePopup[4];
} UAHMENUITEMMETRICS;
typedef struct { DWORD rgcx[4]; DWORD fUpdateMaxWidths : 2; } UAHMENUPOPUPMETRICS;
typedef struct { int iPosition; UAHMENUITEMMETRICS umim; UAHMENUPOPUPMETRICS umpm; } UAHMENUITEM;
typedef struct { DRAWITEMSTRUCT dis; UAHMENU um; UAHMENUITEM umi; } UAHDRAWMENUITEM;

typedef int (WINAPI *SetPreferredAppModeFn)(int);
typedef void (WINAPI *FlushMenuThemesFn)(void);

void menu_set_dark(BOOL dark)
{
    darkMenu = dark;
    HMODULE ux = LoadLibraryExW(L"uxtheme.dll", NULL, LOAD_LIBRARY_SEARCH_SYSTEM32);
    if (ux) {
        SetPreferredAppModeFn setMode = (SetPreferredAppModeFn)(void *)GetProcAddress(ux, MAKEINTRESOURCEA(135));
        FlushMenuThemesFn flush = (FlushMenuThemesFn)(void *)GetProcAddress(ux, MAKEINTRESOURCEA(136));
        if (setMode) setMode(dark ? 2 /* ForceDark */ : 3 /* ForceLight */);
        if (flush) flush();
    }
    DrawMenuBar(g.hwnd);
}

void menu_set_colors(COLORREF bg, COLORREF fg)
{
    barBg = bg;
    barFg = fg;
    /* colore di evidenziazione: lo sfondo schiarito del 12% circa */
    int r = GetRValue(bg), gg = GetGValue(bg), b = GetBValue(bg);
    barHot = RGB(r + (255 - r) * 12 / 100, gg + (255 - gg) * 12 / 100, b + (255 - b) * 12 / 100);
}

static void paint_bar_line(HWND hwnd)
{
    /* Riga chiara di 1 pixel che Windows lascia sotto la barra dei menu */
    MENUBARINFO mbi = { sizeof mbi };
    if (!GetMenuBarInfo(hwnd, OBJID_MENU, 0, &mbi)) return;
    RECT rcClient, rcWin;
    GetClientRect(hwnd, &rcClient);
    MapWindowPoints(hwnd, NULL, (POINT *)&rcClient, 2);
    GetWindowRect(hwnd, &rcWin);
    OffsetRect(&rcClient, -rcWin.left, -rcWin.top);
    RECT line = rcClient;
    line.bottom = line.top;
    line.top--;
    HDC hdc = GetWindowDC(hwnd);
    HBRUSH br = CreateSolidBrush(barBg);
    FillRect(hdc, &line, br);
    DeleteObject(br);
    ReleaseDC(hwnd, hdc);
}

LRESULT menu_dark_draw(HWND hwnd, UINT msg, WPARAM wp, LPARAM lp, BOOL *handled)
{
    *handled = FALSE;
    if (!darkMenu) return 0;
    switch (msg) {
    case WM_UAHDRAWMENU: {
        UAHMENU *um = (UAHMENU *)lp;
        MENUBARINFO mbi = { sizeof mbi };
        GetMenuBarInfo(hwnd, OBJID_MENU, 0, &mbi);
        RECT rcWin;
        GetWindowRect(hwnd, &rcWin);
        RECT rc = mbi.rcBar;
        OffsetRect(&rc, -rcWin.left, -rcWin.top);
        rc.top -= 1; /* copre anche il bordo superiore */
        HBRUSH br = CreateSolidBrush(barBg);
        FillRect(um->hdc, &rc, br);
        DeleteObject(br);
        *handled = TRUE;
        return 0;
    }
    case WM_UAHDRAWMENUITEM: {
        UAHDRAWMENUITEM *d = (UAHDRAWMENUITEM *)lp;
        wchar_t text[256] = L"";
        MENUITEMINFOW mii = { sizeof mii };
        mii.fMask = MIIM_STRING;
        mii.dwTypeData = text;
        mii.cch = 255;
        GetMenuItemInfoW(d->um.hmenu, (UINT)d->umi.iPosition, TRUE, &mii);
        UINT st = d->dis.itemState;
        COLORREF bg = barBg;
        if (st & (ODS_HOTLIGHT | ODS_SELECTED)) bg = barHot;
        HBRUSH br = CreateSolidBrush(bg);
        FillRect(d->um.hdc, &d->dis.rcItem, br);
        DeleteObject(br);
        DWORD flags = DT_CENTER | DT_SINGLELINE | DT_VCENTER;
        if (st & ODS_NOACCEL) flags |= DT_HIDEPREFIX;
        SetBkMode(d->um.hdc, TRANSPARENT);
        COLORREF fg = barFg;
        if (st & (ODS_INACTIVE | ODS_GRAYED | ODS_DISABLED)) fg = RGB(140, 140, 140);
        SetTextColor(d->um.hdc, fg);
        DrawTextW(d->um.hdc, text, -1, &d->dis.rcItem, flags);
        *handled = TRUE;
        return 0;
    }
    case WM_NCPAINT:
    case WM_NCACTIVATE: {
        LRESULT r = DefWindowProcW(hwnd, msg, wp, lp);
        paint_bar_line(hwnd);
        *handled = TRUE;
        return r;
    }
    }
    return 0;
}
