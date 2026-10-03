; Installazione di MDFlash (Inno Setup 6)
; Compilare con: build.cmd installer   (oppure ISCC installer\mdflash.iss)

#define AppName "MDFlash"
#define AppVersion "2.0.0"
#define AppPublisher "Elecktra Studio"
#define AppURL "https://github.com/ShinRalexis"
#define DonateURL "https://liberapay.com/MetaDarko"
#define AppExe "MDFlash.exe"

[Setup]
AppId={{5B0E6C1D-8F2A-4C9B-9E3D-7A1F2B6C4D80}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}
AppUpdatesURL={#AppURL}
AppCopyright=Copyright (C) 2026 {#AppPublisher}, ShinRalexis
AppComments={#DonateURL}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} Setup
VersionInfoVersion={#AppVersion}.0
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; Per l'utente corrente senza permessi di amministratore; si può scegliere "per tutti"
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir=..\dist
OutputBaseFilename=MDFlash-Setup-{#AppVersion}
SetupIconFile=..\assets\mdflash.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
LicenseFile=..\LICENSE.txt
WizardStyle=modern
Compression=lzma2/ultra64
SolidCompression=yes
ChangesAssociations=yes
CloseApplications=yes
ShowLanguageDialog=yes
LanguageDetectionMethod=uilanguage

[Languages]
; La prima lingua è quella di riserva: se Windows non usa una di queste, inglese
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "japanese"; MessagesFile: "compiler:Languages\Japanese.isl"
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
Name: "chinesesimplified"; MessagesFile: "ChineseSimplified.isl"
Name: "russian"; MessagesFile: "compiler:Languages\Russian.isl"

[CustomMessages]
english.AssocGroup=File associations:
english.AssocTask=Open Markdown files (.md) with MDFlash
english.DocType=Markdown document
english.AppDesc=WYSIWYG Markdown editor for Windows
english.Support=Support MDFlash on Liberapay
english.NoWebView2=MDFlash uses Microsoft Edge WebView2 Runtime, which does not seem to be installed on this PC.%n%nThe Microsoft download page will open at the end of the setup.
italian.AssocGroup=Associazioni dei file:
italian.AssocTask=Apri i file Markdown (.md) con MDFlash
italian.DocType=Documento Markdown
italian.AppDesc=Editor Markdown WYSIWYG per Windows
italian.Support=Sostieni MDFlash su Liberapay
italian.NoWebView2=MDFlash usa Microsoft Edge WebView2 Runtime, che su questo PC non risulta installato.%n%nAl termine verrà aperta la pagina di download di Microsoft.
spanish.AssocGroup=Asociaciones de archivos:
spanish.AssocTask=Abrir los archivos Markdown (.md) con MDFlash
spanish.DocType=Documento Markdown
spanish.AppDesc=Editor de Markdown WYSIWYG para Windows
spanish.Support=Apoya MDFlash en Liberapay
spanish.NoWebView2=MDFlash usa Microsoft Edge WebView2 Runtime, que no parece estar instalado en este PC.%n%nAl terminar se abrirá la página de descarga de Microsoft.
french.AssocGroup=Associations de fichiers :
french.AssocTask=Ouvrir les fichiers Markdown (.md) avec MDFlash
french.DocType=Document Markdown
french.AppDesc=Éditeur Markdown WYSIWYG pour Windows
french.Support=Soutenir MDFlash sur Liberapay
french.NoWebView2=MDFlash utilise Microsoft Edge WebView2 Runtime, qui ne semble pas installé sur ce PC.%n%nLa page de téléchargement de Microsoft s'ouvrira à la fin.
german.AssocGroup=Dateizuordnungen:
german.AssocTask=Markdown-Dateien (.md) mit MDFlash öffnen
german.DocType=Markdown-Dokument
german.AppDesc=WYSIWYG-Markdown-Editor für Windows
german.Support=MDFlash auf Liberapay unterstützen
german.NoWebView2=MDFlash verwendet Microsoft Edge WebView2 Runtime, die auf diesem PC anscheinend nicht installiert ist.%n%nAm Ende wird die Downloadseite von Microsoft geöffnet.
japanese.AssocGroup=ファイルの関連付け:
japanese.AssocTask=Markdown ファイル (.md) を MDFlash で開く
japanese.DocType=Markdown ドキュメント
japanese.AppDesc=Windows 用 WYSIWYG Markdown エディター
japanese.Support=Liberapay で MDFlash を支援
japanese.NoWebView2=MDFlash は Microsoft Edge WebView2 Runtime を使用しますが、この PC にはインストールされていないようです。%n%n終了後に Microsoft のダウンロード ページを開きます。
korean.AssocGroup=파일 연결:
korean.AssocTask=Markdown 파일(.md)을 MDFlash로 열기
korean.DocType=Markdown 문서
korean.AppDesc=Windows용 WYSIWYG Markdown 편집기
korean.Support=Liberapay에서 MDFlash 후원
korean.NoWebView2=MDFlash는 Microsoft Edge WebView2 Runtime을 사용하지만 이 PC에는 설치되어 있지 않은 것 같습니다.%n%n설치가 끝나면 Microsoft 다운로드 페이지가 열립니다.
chinesesimplified.AssocGroup=文件关联:
chinesesimplified.AssocTask=使用 MDFlash 打开 Markdown 文件 (.md)
chinesesimplified.DocType=Markdown 文档
chinesesimplified.AppDesc=适用于 Windows 的所见即所得 Markdown 编辑器
chinesesimplified.Support=在 Liberapay 上支持 MDFlash
chinesesimplified.NoWebView2=MDFlash 使用 Microsoft Edge WebView2 Runtime,但此电脑似乎尚未安装。%n%n安装结束后将打开 Microsoft 下载页面。
russian.AssocGroup=Сопоставления файлов:
russian.AssocTask=Открывать файлы Markdown (.md) в MDFlash
russian.DocType=Документ Markdown
russian.AppDesc=WYSIWYG-редактор Markdown для Windows
russian.Support=Поддержать MDFlash на Liberapay
russian.NoWebView2=MDFlash использует Microsoft Edge WebView2 Runtime, но на этом компьютере он, похоже, не установлен.%n%nПосле установки откроется страница загрузки Microsoft.

[Tasks]
Name: "assoc"; Description: "{cm:AssocTask}"; GroupDescription: "{cm:AssocGroup}"
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\build\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\WebView2Loader.dll"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\build\app\*"; DestDir: "{app}\app"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\LICENSE.txt"; DestDir: "{app}"; Flags: ignoreversion

[InstallDelete]
; versioni precedenti dell'interfaccia: nessun file vecchio deve restare
Type: filesandordirs; Name: "{app}\app"

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"; AppUserModelID: "MDFlash.Editor"
Name: "{autoprograms}\{cm:Support}"; Filename: "{#DonateURL}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; Tipo di documento (icona dei file .md e comando di apertura)
Root: HKA; Subkey: "Software\Classes\MDFlash.md"; ValueType: string; ValueName: ""; ValueData: "{cm:DocType}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\MDFlash.md\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"",1"
Root: HKA; Subkey: "Software\Classes\MDFlash.md\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""
; "Apri con" per tutte le estensioni Markdown
Root: HKA; Subkey: "Software\Classes\.md\OpenWithProgids"; ValueType: string; ValueName: "MDFlash.md"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.markdown\OpenWithProgids"; ValueType: string; ValueName: "MDFlash.md"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.mdown\OpenWithProgids"; ValueType: string; ValueName: "MDFlash.md"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.mkd\OpenWithProgids"; ValueType: string; ValueName: "MDFlash.md"; ValueData: ""; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.mkdn\OpenWithProgids"; ValueType: string; ValueName: "MDFlash.md"; ValueData: ""; Flags: uninsdeletevalue
; Programma predefinito per .md, se l'utente lo ha scelto (Windows può chiedere conferma)
Root: HKA; Subkey: "Software\Classes\.md"; ValueType: string; ValueName: ""; ValueData: "MDFlash.md"; Tasks: assoc; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.markdown"; ValueType: string; ValueName: ""; ValueData: "MDFlash.md"; Tasks: assoc; Flags: uninsdeletevalue
; Elenco "Programmi predefiniti" di Windows
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#AppName}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".md"; ValueData: ""
Root: HKA; Subkey: "Software\Classes\Applications\{#AppExe}\SupportedTypes"; ValueType: string; ValueName: ".markdown"; ValueData: ""
Root: HKA; Subkey: "Software\MDFlash\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "{#AppName}"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\MDFlash\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "{cm:AppDesc}"
Root: HKA; Subkey: "Software\MDFlash\Capabilities\FileAssociations"; ValueType: string; ValueName: ".md"; ValueData: "MDFlash.md"
Root: HKA; Subkey: "Software\MDFlash\Capabilities\FileAssociations"; ValueType: string; ValueName: ".markdown"; ValueData: "MDFlash.md"
Root: HKA; Subkey: "Software\MDFlash\Capabilities\FileAssociations"; ValueType: string; ValueName: ".mdown"; ValueData: "MDFlash.md"
Root: HKA; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "MDFlash"; ValueData: "Software\MDFlash\Capabilities"; Flags: uninsdeletevalue

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent
Filename: "https://developer.microsoft.com/microsoft-edge/webview2/"; Flags: shellexec nowait; Check: NeedsWebView2

[Code]
{ WebView2 Runtime: Windows 11 lo include; su Windows 10 potrebbe mancare. }
function WebView2Installed(): Boolean;
var
  V: String;
begin
  Result :=
    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) or
    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V) or
    RegQueryStringValue(HKCU, 'Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', V);
  if Result then Result := (V <> '') and (V <> '0.0.0.0');
end;

function NeedsWebView2(): Boolean;
begin
  Result := not WebView2Installed();
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and NeedsWebView2() and not WizardSilent() then
    MsgBox(ExpandConstant('{cm:NoWebView2}'), mbInformation, MB_OK);
end;
