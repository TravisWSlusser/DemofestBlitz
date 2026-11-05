<#
  Side-Qlik pre-show launcher (Windows, PowerShell 5.1).

  1. Starts the deck's slideshow and holds it on PowerPoint's black screen.
  2. Puts a kiosk Chrome window with the pre-show page on the same monitor, on top of it.
  3. At show time the page fades to black and Chrome is closed. PowerPoint's black screen is underneath,
     then slide 1 starts fresh (its animations and timings begin at that moment, not ten minutes earlier).

  Nothing to press. Alt+F4 on the kiosk window ends the pre-show early; the deck is revealed the same way.
  The deck file is never modified. Settings are passed in by Pre-Show.cmd.
#>
param(
  [string]$Deck   = '',                         # path to the .pptx; empty = the only .pptx next to this script
  [string]$ShowAt = '13:00',                    # clock time the talk starts (24h, laptop time; HH:mm or HH:mm:ss), or "+2" = two minutes from now
  [string]$Url    = 'https://demofest-blitz.vercel.app/preshow.html',
  [string]$Bg     = '000000'                    # colour the pre-show fades to in its last second (black matches PowerPoint's held screen)
)
$ErrorActionPreference = 'Stop'
$log = Join-Path $PSScriptRoot 'last-run.log'
function Say($m) { $line = "[{0:HH:mm:ss}] {1}" -f (Get-Date), $m; Write-Host $line; Add-Content -Path $log -Value $line }
function Retry([scriptblock]$do, [int]$tries = 40) {           # PowerPoint answers "busy" (RPC_E_CALL_REJECTED) while it is loading; ask again
  for ($i = 1; ; $i++) { try { return (& $do) } catch { if ($i -ge $tries) { throw }; Start-Sleep -Milliseconds 250 } }
}
Set-Content -Path $log -Value "Pre-show run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

try {
  # ---- the deck
  if (-not $Deck) {
    $cands = @(Get-ChildItem -Path $PSScriptRoot -Filter *.pptx -File | Where-Object { $_.Name -notlike '~$*' })
    if ($cands.Count -ne 1) { throw "Put exactly one .pptx next to launch.ps1, or set DECK in Pre-Show.cmd. Found $($cands.Count)." }
    $Deck = $cands[0].FullName
  }
  if (-not (Test-Path -LiteralPath $Deck)) { throw "Deck not found: $Deck" }
  $Deck = (Resolve-Path -LiteralPath $Deck).Path

  # ---- the show time
  if ($ShowAt -match '^\+(\d+(\.\d+)?)$') { $target = (Get-Date).AddMinutes([double]$Matches[1]) } else { $target = Get-Date $ShowAt }
  if ($target -lt (Get-Date).AddSeconds(20)) { throw "Show time $($target.ToString('HH:mm:ss')) is already here or past. Set SHOWAT to a later time." }
  $atMs = [long]([DateTimeOffset]$target).ToUnixTimeMilliseconds()
  Say "Show starts at $($target.ToString('HH:mm:ss')). Deck: $Deck"

  Add-Type @"
using System; using System.Runtime.InteropServices;
public static class PreShowWin {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hgt, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr FindWindow(string cls, string title);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint flags);
  // Ten minutes with nobody touching the laptop: keep the display and the machine awake while this script is running.
  public static void StayAwake() { SetThreadExecutionState(0x80000000 | 0x00000002 | 0x00000001); }
  static readonly IntPtr TOPMOST = new IntPtr(-1), NOTOPMOST = new IntPtr(-2);
  const uint NOMOVE_NOSIZE_SHOW = 0x0002 | 0x0001 | 0x0040;
  // Put a window above everything, with or without keeping it pinned there.
  public static void Raise(IntPtr h, bool pin) {
    SetWindowPos(h, TOPMOST, 0, 0, 0, 0, NOMOVE_NOSIZE_SHOW);
    if (!pin) SetWindowPos(h, NOTOPMOST, 0, 0, 0, 0, NOMOVE_NOSIZE_SHOW);
  }
  // Windows refuses to let a background program take the keyboard focus. A tap of Alt plus attaching to the
  // current foreground thread lifts that lock, so the window really becomes the active one (the clicker needs that).
  public static bool Focus(IntPtr h) {
    for (int i = 0; i < 6 && GetForegroundWindow() != h; i++) {
      uint pid, me = GetCurrentThreadId();
      uint fg = GetWindowThreadProcessId(GetForegroundWindow(), out pid), tg = GetWindowThreadProcessId(h, out pid);
      keybd_event(0x12, 0, 0, UIntPtr.Zero); keybd_event(0x12, 0, 2, UIntPtr.Zero);
      AttachThreadInput(me, fg, true); AttachThreadInput(me, tg, true);
      BringWindowToTop(h); SetForegroundWindow(h);
      AttachThreadInput(me, fg, false); AttachThreadInput(me, tg, false);
      System.Threading.Thread.Sleep(60);
    }
    return GetForegroundWindow() == h;
  }
}
"@

  [PreShowWin]::StayAwake()

  # ---- 1. PowerPoint: find or open the deck, run its slideshow, hold it on black
  $app = $null
  try { $app = [Runtime.InteropServices.Marshal]::GetActiveObject('PowerPoint.Application') } catch {}
  if (-not $app) { $app = New-Object -ComObject PowerPoint.Application; Retry { $app.Visible = -1 } | Out-Null }
  $leaf = Split-Path $Deck -Leaf
  $pres = Retry { foreach ($p in @($app.Presentations)) { if ($p.FullName -ieq $Deck -or $p.Name -ieq $leaf) { return $p } }; return $null }
  if (-not $pres) { $pres = Retry { $app.Presentations.Open($Deck) }; Say 'Deck opened.' } else { Say 'Deck was already open in PowerPoint.' }
  $ssw = $null
  if ((Retry { $app.SlideShowWindows.Count }) -gt 0) { try { $ssw = $pres.SlideShowWindow } catch {} }
  if (-not $ssw) { $ssw = Retry { $pres.SlideShowSettings.Run() } }
  Start-Sleep -Milliseconds 400
  Retry { $ssw.View.State = 3 } | Out-Null                         # ppSlideShowBlackScreen: nothing on slide 1 plays or advances yet
  $hwnd = [IntPtr]::Zero
  for ($i = 0; $i -lt 20 -and $hwnd -eq [IntPtr]::Zero; $i++) {
    # PowerPoint's slideshow window has the class "screenClass". ([NullString]: a plain $null would become "" and match nothing.)
    $hwnd = [PreShowWin]::FindWindow('screenClass', [NullString]::Value)
    if ($hwnd -eq [IntPtr]::Zero) { Start-Sleep -Milliseconds 250 }
  }
  if ($hwnd -eq [IntPtr]::Zero) { throw 'Could not find the slideshow window.' }
  $r = New-Object PreShowWin+RECT
  [PreShowWin]::GetWindowRect($hwnd, [ref]$r) | Out-Null
  $W = $r.Right - $r.Left; $H = $r.Bottom - $r.Top
  Say "Slideshow is up and held on black at ($($r.Left),$($r.Top)) ${W}x${H}."

  # ---- 2. kiosk browser on the same screen, on top
  $browser = $null
  foreach ($e in 'chrome.exe', 'msedge.exe') {
    $p = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$e" -ErrorAction SilentlyContinue).'(default)'
    if ($p -and (Test-Path $p)) { $browser = $p; break }
  }
  if (-not $browser) { throw 'Neither Chrome nor Edge was found.' }
  $prof = Join-Path $env:TEMP 'sideqlik-preshow-profile'           # its own clean profile: no sign-in, no autofill, easy to find and close
  $sep = if ($Url.Contains('?')) { '&' } else { '?' }
  $full = "$Url${sep}at=$atMs&bg=$Bg"
  $bargs = @('--kiosk', '--new-window', '--no-first-run', '--no-default-browser-check', '--disable-session-crashed-bubble',
             '--disable-infobars', '--autoplay-policy=no-user-gesture-required', "--user-data-dir=`"$prof`"",
             "--window-position=$($r.Left),$($r.Top)", "--window-size=$W,$H", "`"$full`"")
  function KioskProcs { Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" | Where-Object { $_.CommandLine -like '*sideqlik-preshow-profile*' } }
  KioskProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }   # a leftover from an earlier run
  $bp = Start-Process -FilePath $browser -ArgumentList $bargs -PassThru
  Say "Pre-show on screen ($([IO.Path]::GetFileName($browser)))."

  # If the kiosk window landed on a different monitor than the slideshow, move it over the slideshow.
  $kw = [IntPtr]::Zero
  for ($i = 0; $i -lt 40 -and $kw -eq [IntPtr]::Zero; $i++) { Start-Sleep -Milliseconds 250; try { $kw = (Get-Process -Id $bp.Id -ErrorAction Stop).MainWindowHandle } catch {} }
  if ($kw -ne [IntPtr]::Zero) {
    $k = New-Object PreShowWin+RECT; [PreShowWin]::GetWindowRect($kw, [ref]$k) | Out-Null
    $cx = ($k.Left + $k.Right) / 2; $cy = ($k.Top + $k.Bottom) / 2
    if ($cx -lt $r.Left -or $cx -gt $r.Right -or $cy -lt $r.Top -or $cy -gt $r.Bottom) {
      [PreShowWin]::SetWindowPos($kw, [IntPtr]::Zero, $r.Left, $r.Top, $W, $H, 0x0040) | Out-Null
      Say 'Kiosk window moved onto the slideshow monitor.'
    }
    [PreShowWin]::Raise($kw, $true)                                # pinned on top: a stray window cannot cover the pre-show
    $kf = [PreShowWin]::Focus($kw)
    Say "Pre-show window on top (focused: $kf)."
  } else { Say 'Could not find the kiosk window to pin it on top.' }

  # ---- 3. wait for show time (or for the kiosk window to be closed by hand), then reveal the deck
  while ((Get-Date) -lt $target) {
    Start-Sleep -Milliseconds 200
    if (-not (KioskProcs)) { Say 'Kiosk closed by hand; revealing the deck now.'; break }
  }
  # The page is solid black by now and so is the held slideshow. Lift the slideshow above the browser first (black over
  # black, nothing to see), give it the keyboard, and only then close the browser: no other window can flash through.
  [PreShowWin]::Raise($hwnd, $true)
  $sf = [PreShowWin]::Focus($hwnd)
  KioskProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Retry { $ssw.View.GotoSlide(1, -1) } 8 | Out-Null                # slide 1 from the top: animations and timings start now
  try { if ($ssw.View.State -ne 1) { $ssw.View.State = 1 } } catch {}
  Start-Sleep -Milliseconds 300
  if (-not $sf) { $sf = [PreShowWin]::Focus($hwnd) }
  [PreShowWin]::Raise($hwnd, $false)                               # no longer pinned: Alt+Tab and Esc behave as usual
  Say "Showtime. The deck has the screen (keyboard focus on the slideshow: $sf)."
}
catch {
  Say "FAILED: $($_.Exception.Message)"
  try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show("Pre-show could not start:`n`n$($_.Exception.Message)", 'Side-Qlik Pre-Show') | Out-Null } catch {}
  exit 1
}
