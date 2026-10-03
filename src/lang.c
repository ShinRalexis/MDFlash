/* MDFlash: testi del programma C nelle lingue dell'interfaccia.
 * La lingua viene comunicata dalla pagina (comando setLanguage) e salvata nel
 * registro, così i messaggi che compaiono prima che la pagina sia pronta
 * (es. WebView2 mancante) sono già nella lingua giusta. */
#include "app.h"

enum { L_IT, L_EN, L_ES, L_FR, L_DE, L_JA, L_KO, L_ZH, L_RU, L_COUNT };
static const char *codes[L_COUNT] = { "it", "en", "es", "fr", "de", "ja", "ko", "zh", "ru" };
static int cur = -1;

static const wchar_t *T[S_COUNT][L_COUNT] = {
    [S_WV2_FAIL] = {
        L"Impossibile avviare il motore di visualizzazione WebView2 (errore 0x%08lX).",
        L"Could not start the WebView2 rendering engine (error 0x%08lX).",
        L"No se pudo iniciar el motor de visualización WebView2 (error 0x%08lX).",
        L"Impossible de démarrer le moteur d'affichage WebView2 (erreur 0x%08lX).",
        L"Die Anzeige-Engine WebView2 konnte nicht gestartet werden (Fehler 0x%08lX).",
        L"WebView2 表示エンジンを起動できませんでした (エラー 0x%08lX)。",
        L"WebView2 렌더링 엔진을 시작할 수 없습니다 (오류 0x%08lX).",
        L"无法启动 WebView2 显示引擎 (错误 0x%08lX)。",
        L"Не удалось запустить движок отображения WebView2 (ошибка 0x%08lX).",
    },
    [S_WV2_MISSING] = {
        L"MDFlash ha bisogno di Microsoft Edge WebView2 Runtime, che non risulta installato.\n\nVuoi aprire la pagina di download di Microsoft?",
        L"MDFlash needs Microsoft Edge WebView2 Runtime, which does not seem to be installed.\n\nOpen the Microsoft download page?",
        L"MDFlash necesita Microsoft Edge WebView2 Runtime, que no parece estar instalado.\n\n¿Abrir la página de descarga de Microsoft?",
        L"MDFlash a besoin de Microsoft Edge WebView2 Runtime, qui ne semble pas installé.\n\nOuvrir la page de téléchargement de Microsoft ?",
        L"MDFlash benötigt Microsoft Edge WebView2 Runtime, die anscheinend nicht installiert ist.\n\nDownloadseite von Microsoft öffnen?",
        L"MDFlash には Microsoft Edge WebView2 Runtime が必要ですが、インストールされていないようです。\n\nMicrosoft のダウンロード ページを開きますか?",
        L"MDFlash에는 Microsoft Edge WebView2 Runtime이 필요하지만 설치되어 있지 않은 것 같습니다.\n\nMicrosoft 다운로드 페이지를 여시겠습니까?",
        L"MDFlash 需要 Microsoft Edge WebView2 Runtime,但它似乎尚未安装。\n\n要打开 Microsoft 下载页面吗?",
        L"Для MDFlash нужен Microsoft Edge WebView2 Runtime, но он, похоже, не установлен.\n\nОткрыть страницу загрузки Microsoft?",
    },
    [S_LOADER_MISSING] = {
        L"File WebView2Loader.dll mancante accanto a MDFlash.exe. Reinstalla il programma.",
        L"WebView2Loader.dll is missing next to MDFlash.exe. Please reinstall the program.",
        L"Falta WebView2Loader.dll junto a MDFlash.exe. Vuelve a instalar el programa.",
        L"WebView2Loader.dll est absent à côté de MDFlash.exe. Réinstallez le programme.",
        L"WebView2Loader.dll fehlt neben MDFlash.exe. Bitte installieren Sie das Programm neu.",
        L"MDFlash.exe と同じ場所に WebView2Loader.dll がありません。プログラムを再インストールしてください。",
        L"MDFlash.exe 옆에 WebView2Loader.dll이 없습니다. 프로그램을 다시 설치하세요.",
        L"MDFlash.exe 旁缺少 WebView2Loader.dll。请重新安装本程序。",
        L"Рядом с MDFlash.exe нет файла WebView2Loader.dll. Переустановите программу.",
    },
    [S_NOT_RESPONDING] = {
        L"L'editor non risponde. Chiudere comunque MDFlash?\n\nLe modifiche non salvate potrebbero andare perse.",
        L"The editor is not responding. Close MDFlash anyway?\n\nUnsaved changes may be lost.",
        L"El editor no responde. ¿Cerrar MDFlash de todos modos?\n\nLos cambios no guardados podrían perderse.",
        L"L'éditeur ne répond pas. Fermer MDFlash quand même ?\n\nLes modifications non enregistrées pourraient être perdues.",
        L"Der Editor reagiert nicht. MDFlash trotzdem schließen?\n\nNicht gespeicherte Änderungen können verloren gehen.",
        L"エディターが応答していません。MDFlash を強制的に閉じますか?\n\n保存されていない変更は失われる可能性があります。",
        L"편집기가 응답하지 않습니다. 그래도 MDFlash를 닫으시겠습니까?\n\n저장하지 않은 변경 내용이 손실될 수 있습니다.",
        L"编辑器没有响应。仍要关闭 MDFlash 吗?\n\n未保存的更改可能会丢失。",
        L"Редактор не отвечает. Всё равно закрыть MDFlash?\n\nНесохранённые изменения могут быть потеряны.",
    },
    [S_PDF_FAIL] = {
        L"Creazione del PDF non riuscita (il file è aperto in un altro programma?)",
        L"Could not create the PDF (is the file open in another program?)",
        L"No se pudo crear el PDF (¿el archivo está abierto en otro programa?)",
        L"Impossible de créer le PDF (le fichier est-il ouvert dans un autre programme ?)",
        L"PDF konnte nicht erstellt werden (ist die Datei in einem anderen Programm geöffnet?)",
        L"PDF を作成できませんでした (ファイルが別のプログラムで開かれていませんか?)",
        L"PDF를 만들 수 없습니다 (파일이 다른 프로그램에서 열려 있습니까?)",
        L"无法创建 PDF(文件是否在其他程序中打开?)",
        L"Не удалось создать PDF (файл открыт в другой программе?)",
    },
    [S_PDF_UNAVAILABLE] = {
        L"Esportazione PDF non disponibile in questa versione di WebView2",
        L"PDF export is not available in this version of WebView2",
        L"La exportación a PDF no está disponible en esta versión de WebView2",
        L"L'export PDF n'est pas disponible dans cette version de WebView2",
        L"PDF-Export ist in dieser WebView2-Version nicht verfügbar",
        L"この WebView2 のバージョンでは PDF エクスポートを利用できません",
        L"이 WebView2 버전에서는 PDF 내보내기를 사용할 수 없습니다",
        L"此版本的 WebView2 不支持导出 PDF",
        L"Экспорт в PDF недоступен в этой версии WebView2",
    },
    [S_FILE_LOCKED] = {
        L"Impossibile scrivere il file (è aperto in un altro programma?)",
        L"Cannot write the file (is it open in another program?)",
        L"No se puede escribir el archivo (¿está abierto en otro programa?)",
        L"Impossible d'écrire le fichier (est-il ouvert dans un autre programme ?)",
        L"Datei kann nicht geschrieben werden (ist sie in einem anderen Programm geöffnet?)",
        L"ファイルに書き込めません (別のプログラムで開かれていませんか?)",
        L"파일을 쓸 수 없습니다 (다른 프로그램에서 열려 있습니까?)",
        L"无法写入文件(是否在其他程序中打开?)",
        L"Не удаётся записать файл (он открыт в другой программе?)",
    },
    [S_CLIPBOARD_BUSY] = {
        L"Appunti occupati da un altro programma", L"The clipboard is in use by another program",
        L"El portapapeles está en uso por otro programa", L"Le presse-papiers est utilisé par un autre programme",
        L"Die Zwischenablage wird von einem anderen Programm verwendet", L"クリップボードは別のプログラムが使用中です",
        L"다른 프로그램이 클립보드를 사용 중입니다", L"剪贴板正被其他程序使用", L"Буфер обмена занят другой программой",
    },
    [S_DIALOG_UNAVAILABLE] = {
        L"Finestra di dialogo non disponibile", L"Dialog not available", L"Cuadro de diálogo no disponible",
        L"Boîte de dialogue indisponible", L"Dialog nicht verfügbar", L"ダイアログを表示できません",
        L"대화 상자를 사용할 수 없습니다", L"无法打开对话框", L"Диалоговое окно недоступно",
    },
    [S_BAD_URL] = {
        L"Indirizzo non valido", L"Invalid address", L"Dirección no válida", L"Adresse non valide",
        L"Ungültige Adresse", L"無効なアドレスです", L"잘못된 주소입니다", L"地址无效", L"Неверный адрес",
    },
    [S_PANDOC_ERROR] = {
        L"Pandoc ha restituito un errore", L"Pandoc returned an error", L"Pandoc devolvió un error",
        L"Pandoc a renvoyé une erreur", L"Pandoc hat einen Fehler gemeldet", L"Pandoc がエラーを返しました",
        L"Pandoc에서 오류가 발생했습니다", L"Pandoc 返回了错误", L"Pandoc вернул ошибку",
    },
    [S_NET_ERROR] = {
        L"Errore di rete %lu", L"Network error %lu", L"Error de red %lu", L"Erreur réseau %lu", L"Netzwerkfehler %lu",
        L"ネットワーク エラー %lu", L"네트워크 오류 %lu", L"网络错误 %lu", L"Ошибка сети %lu",
    },
    [S_DOC_TYPE] = {
        L"Documento Markdown", L"Markdown document", L"Documento Markdown", L"Document Markdown", L"Markdown-Dokument",
        L"Markdown ドキュメント", L"Markdown 문서", L"Markdown 文档", L"Документ Markdown",
    },
    [S_APP_DESC] = {
        L"Editor Markdown WYSIWYG per Windows", L"WYSIWYG Markdown editor for Windows", L"Editor de Markdown WYSIWYG para Windows",
        L"Éditeur Markdown WYSIWYG pour Windows", L"WYSIWYG-Markdown-Editor für Windows", L"Windows 用 WYSIWYG Markdown エディター",
        L"Windows용 WYSIWYG Markdown 편집기", L"适用于 Windows 的所见即所得 Markdown 编辑器", L"WYSIWYG-редактор Markdown для Windows",
    },
};

static int from_code(const char *c)
{
    if (!c) return -1;
    for (int i = 0; i < L_COUNT; i++) if (_strnicmp(c, codes[i], 2) == 0) return i;
    return -1;
}

static int from_system(void)
{
    switch (PRIMARYLANGID(GetUserDefaultUILanguage())) {
    case LANG_ITALIAN: return L_IT;
    case LANG_SPANISH: return L_ES;
    case LANG_FRENCH: return L_FR;
    case LANG_GERMAN: return L_DE;
    case LANG_JAPANESE: return L_JA;
    case LANG_KOREAN: return L_KO;
    case LANG_CHINESE: return L_ZH;
    case LANG_RUSSIAN: return L_RU;
    default: return L_EN;
    }
}

void lang_set(const char *code)
{
    int l = from_code(code);
    if (l < 0) return;
    cur = l;
    wchar_t w[8];
    MultiByteToWideChar(CP_UTF8, 0, codes[l], -1, w, 8);
    RegSetKeyValueW(HKEY_CURRENT_USER, REG_KEY, L"Language", REG_SZ, w, (DWORD)((wcslen(w) + 1) * sizeof(wchar_t)));
}

static void lang_init(void)
{
    wchar_t w[8];
    DWORD sz = sizeof w;
    if (RegGetValueW(HKEY_CURRENT_USER, REG_KEY, L"Language", RRF_RT_REG_SZ, NULL, w, &sz) == ERROR_SUCCESS) {
        char a[8];
        WideCharToMultiByte(CP_UTF8, 0, w, -1, a, 8, NULL, NULL);
        cur = from_code(a);
    }
    if (cur < 0) cur = from_system();
}

const wchar_t *tr(int id)
{
    if (cur < 0) lang_init();
    if (id < 0 || id >= S_COUNT) return L"";
    const wchar_t *s = T[id][cur];
    return s ? s : T[id][L_EN];
}

/* Versione UTF-8 (malloc), per i messaggi restituiti alla pagina */
char *tr_utf8(int id)
{
    return wide_to_utf8(tr(id));
}

void json_add_tr(cJSON *obj, const char *key, int id)
{
    char *s = tr_utf8(id);
    cJSON_AddStringToObject(obj, key, s ? s : "");
    free(s);
}
