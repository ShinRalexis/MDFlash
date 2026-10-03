# Fotografa la finestra di MDFlash (cornice e menu compresi) in un PNG.
# Uso: powershell -File tools\capture.ps1 -Out build\win.png
param([string]$Out = "build\win.png", [string]$Title = "MDFlash", [int]$ProcessId = 0, [int]$Width = 0, [int]$Height = 0, [switch]$Print)
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class Win {
  [DllImport("user32.dll")] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr hdc, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr ctx);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out RECT r, int s);
  public struct RECT { public int Left, Top, Right, Bottom; }
}
"@
# Misure tutte in pixel veri anche con lo schermo scalato (125%, 150%...)
[Win]::SetProcessDpiAwarenessContext([IntPtr](-4)) | Out-Null
if ($ProcessId) { $h = (Get-Process -Id $ProcessId).MainWindowHandle }
else { $h = [Win]::FindWindow("MDFlashMainWindow", [NullString]::Value) }
if ($h -eq [IntPtr]::Zero) { Write-Error "Finestra non trovata"; exit 1 }
if ($Width -and $Height) { [Win]::MoveWindow($h, 60, 40, $Width, $Height, $true) | Out-Null; Start-Sleep -Milliseconds 800 }
[Win]::SetForegroundWindow($h) | Out-Null
Start-Sleep -Milliseconds 300
$r = New-Object Win+RECT
[Win]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) | Out-Null
$w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
$bmp = New-Object System.Drawing.Bitmap $w, $hh
$g = [System.Drawing.Graphics]::FromImage($bmp)
if ($Print) {
  # PrintWindow disegna solo la finestra: anteprime della barra delle
  # applicazioni, tooltip o altre finestre sopra non finiscono nella foto.
  # Si disegna sull'intero rettangolo (bordi invisibili compresi) e poi si
  # ritaglia la parte visibile indicata da DWM.
  $o = New-Object Win+RECT
  [Win]::GetWindowRect($h, [ref]$o) | Out-Null
  $full = New-Object System.Drawing.Bitmap ($o.Right - $o.Left), ($o.Bottom - $o.Top)
  $gf = [System.Drawing.Graphics]::FromImage($full)
  $hdc = $gf.GetHdc()
  [Win]::PrintWindow($h, $hdc, 2) | Out-Null
  $gf.ReleaseHdc($hdc); $gf.Dispose()
  $g.DrawImage($full, (New-Object System.Drawing.Rectangle 0, 0, $w, $hh), ($r.Left - $o.Left), ($r.Top - $o.Top), $w, $hh, [System.Drawing.GraphicsUnit]::Pixel)
  $full.Dispose()
} else {
  $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
}
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"salvato $Out ($w x $hh)"
