<#
  Side-Qlik pre-show launcher (Windows, PowerShell 5.1).

  1. Opens the deck straight into slideshow mode, so slide one is already on the screen.
  2. Puts a kiosk Chrome window with the pre-show page on the same screen, on top of it.
  3. At show time, closes Chrome. The slideshow is already underneath, so the cut is instant.

  Nothing to press. Alt+F4 on the kiosk window ends the pre-show early (the slideshow is revealed the same way).
  Settings live in Pre-Show.cmd next to this file; this script takes them as parameters.
#>
param(
  [string]$Deck   = '',                         # path to the .pptx; empty = the only .pptx next to this script
  [string]$ShowAt = '13:00',                    # clock time the talk starts (24h, laptop time), or "+2" = two minutes from now
  [string]$Url    = 'https://demofest-blitz.vercel.app/preshow.html',
  [string]$Bg     = '10172A'                    # hex colour the pre-show fades to in its last second: match slide one
)
$ErrorActionPreference = 'Stop'
function Say($m) { Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $m) }

# ---- the deck
if (-not $Deck) {
  $cands = Get-ChildItem -Path $PSScriptRoot -Filter *.pptx -File | Where-Object { $_.Name -notlike '~$*' }
  if ($cands.Count -ne 1) { throw "Put exactly one .pptx next to launch.ps1 or pass -Deck. Found $($cands.Count)." }
  $Deck = $cands[0].FullName
}
$Deck = (Resolve-Path $Deck).Path
if (-not (Test-Path $Deck)) { throw "Deck not found: $Deck" }

# ---- the show time
if ($ShowAt -match '^\+(\d+(\.\d+)?)$') { $target = (Get-Date).AddMinutes([double]$Matches[1]) }
else { $target = Get-Date $ShowAt }
if ($target -lt (Get-Date).AddSeconds(5)) { throw "Show time $($target.ToString('HH:mm')) is already past. Set -ShowAt to a later time." }
$atMs = [long]([DateTimeOffset]$target).ToUnixTimeMilliseconds()
Say "Show starts at $($target.ToString('HH:mm:ss')). Deck: $Deck"

# ---- Win32 helpers: where is the slideshow window, and bring windows forward
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class PreShowWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
}
"@

# ---- 1. PowerPoint into slideshow
$ppExe = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\powerpnt.exe').'(default)'
Start-Process -FilePath $ppExe -ArgumentList "/s `"$Deck`""
$app = $null
for ($i = 0; $i -lt 120 -and -not $app; $i++) {
  Start-Sleep -Milliseconds 500
  try { $a = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application'); if ($a.SlideShowWindows.Count -ge 1) { $app = $a } } catch {}
}
if (-not $app) { throw 'PowerPoint did not start the slideshow within 60 s.' }
$ssw = $app.SlideShowWindows.Item(1)
Start-Sleep -Seconds 2                                   # let the slideshow window settle on its monitor
$hwnd = [IntPtr]$ssw.HWND
$r = New-Object PreShowWin+RECT
[PreShowWin]::GetWindowRect($hwnd, [ref]$r) | Out-Null
$W = $r.Right - $r.Left; $H = $r.Bottom - $r.Top
Say "Slideshow is up at ($($r.Left),$($r.Top)) ${W}x${H}"

# ---- 2. kiosk browser on the same screen, on top
$browser = $null
foreach ($e in 'chrome.exe', 'msedge.exe') {
  $p = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$e" -ErrorAction SilentlyContinue).'(default)'
  if ($p -and (Test-Path $p)) { $browser = $p; break }
}
if (-not $browser) { throw 'Neither Chrome nor Edge was found.' }
$prof = Join-Path $env:TEMP 'sideqlik-preshow-profile'       # its own clean profile: no sign-in, no autofill, easy to find and close
$sep = if ($Url.Contains('?')) { '&' } else { '?' }
$full = "$Url${sep}at=$atMs&bg=$Bg"
$bargs = @('--kiosk', '--new-window', '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble',
          '--disable-infobars', '--autoplay-policy=no-user-gesture-required', "--user-data-dir=`"$prof`"",
          "--window-position=$($r.Left),$($r.Top)", "--window-size=$W,$H", "`"$full`"")
$bp = Start-Process -FilePath $browser -ArgumentList $bargs -PassThru
Say "Pre-show on screen ($([IO.Path]::GetFileName($browser)))."

# ---- 3. wait for show time (or for the kiosk window to be closed by hand), then reveal the slideshow
function KioskProcs { Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*sideqlik-preshow-profile*" } }
while ((Get-Date) -lt $target) {
  Start-Sleep -Milliseconds 250
  if (-not (KioskProcs)) { Say 'Kiosk closed by hand; revealing the slideshow now.'; break }
}
KioskProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 150
try { $ssw.Activate() } catch {}
[PreShowWin]::SetForegroundWindow($hwnd) | Out-Null
Say 'Showtime. The deck has the screen.'
