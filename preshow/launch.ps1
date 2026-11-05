<#
  Side-Qlik pre-show launcher (Windows, PowerShell 5.1).

  0. Shows a start screen with two buttons: AUDIO TEST and LAUNCH PRE SHOW.
  1. Starts the deck's slideshow and holds it on PowerPoint's black screen.
  2. Puts a kiosk Chrome window with the pre-show page on the same monitor, on top of it.
  3. At show time the page fades to black and Chrome is closed. PowerPoint's black screen is underneath,
     then slide 1 starts fresh (its animations and timings begin at that moment, not ten minutes earlier).

  Nothing to press. Two ways out:
    Alt+F4 on the kiosk window  ends the pre-show early and goes to the deck, as if show time had come.
    Holding X for 1.5 seconds   stops everything: music, voice, the kiosk window and the slideshow.
  The deck file is never modified. Settings are passed in by Pre-Show.cmd.
#>
param(
  [string]$Deck   = '',                         # path to the .pptx; empty = the only .pptx next to this script
  [string]$ShowAt = '13:00',                    # clock time the talk starts (24h, laptop time; HH:mm or HH:mm:ss), or "+2" = two minutes from now
  [string]$Url    = 'https://demofest-blitz.vercel.app/preshow.html',
  [string]$Bg     = '000000',                   # unused by the current page (it fades to the deck background); kept for other decks
  [string]$Music  = '',                         # folder of background music; empty = the "music" folder next to this script
  [double]$MusicVolume = 0.5,                   # 0 to 1, on top of the laptop's own volume
  [string]$Set    = '10',                       # which question set plays: a name from "sets" in the question file (10, 15, test)
  [string]$Questions = '',                      # the question file; empty = questions.json next to this script
  [switch]$NoVoice,                             # turn the announcer off
  [switch]$NoMenu,                              # skip the start screen and launch straight away
  [double]$VoiceVolume = 1.0,                   # 0 to 1
  [switch]$Nudge                                # OFF by default. The laptop's policy locks the screen after 10 idle minutes. The script
                                                # already asks Windows to keep the display on, the way a video player does. If a rehearsal
                                                # shows the lock still arriving, -Nudge taps the unused F15 key every 4 minutes so Windows
                                                # sees activity. That sidesteps the auto-lock while the pre-show runs: the owner's call.
)
$ErrorActionPreference = 'Stop'

# ---- high-DPI from the first line. The audio players switch this process to high-DPI the moment one is created;
# doing it here, before any window exists, keeps every size and position in one consistent unit (real pixels).
Add-Type -Namespace PreShow -Name Dpi -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();'
[void][PreShow.Dpi]::SetProcessDPIAware()
$log = Join-Path $PSScriptRoot 'last-run.log'

# ---- one pre-show at a time. A second launch (an extra double-click, or the other shortcut) leaves at once and
# touches nothing: no second slideshow, no second browser, no second voice. The lock is held for as long as this
# script runs and frees itself when it ends, however it ends.
$script:gate = New-Object System.Threading.Mutex($false, 'SideQlikPreShow609')
$mine = $false
try { $mine = $script:gate.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $mine = $true }   # the last run was killed: the lock is ours
if (-not $mine) {
  Add-Content -Path $log -Value ("[{0:HH:mm:ss}] A second launch was ignored: the pre-show is already running." -f (Get-Date))
  exit 0
}
function Say($m) { $line = "[{0:HH:mm:ss}] {1}" -f (Get-Date), $m; Write-Host $line; Add-Content -Path $log -Value $line }
function Retry([scriptblock]$do, [int]$tries = 40) {           # PowerPoint answers "busy" (RPC_E_CALL_REJECTED) while it is loading; ask again
  for ($i = 1; ; $i++) { try { return (& $do) } catch { if ($i -ge $tries) { throw }; Start-Sleep -Milliseconds 250 } }
}
Set-Content -Path $log -Value "Pre-show run $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"

# ---- the start screen. Two buttons, in the deck's own dress:
#   AUDIO TEST       one soft chime through the speakers, to prove the laptop's sound is reaching the room.
#   LAUNCH PRE SHOW  starts the pre-show, on the second press: the first press only arms the button.
#                    A "+10" show time starts counting from that second press.
# A fourth line pairs the presenter's phone as the control room: the phone shows a code, it is typed here.
# Esc closes the window without starting anything. Returns 'launch' or 'cancel'.
function Show-StartScreen([string]$deckName, [string]$whenText, [object[]]$tracks, [string]$site) {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $green = [System.Drawing.Color]::FromArgb(0, 176, 80); $dark = [System.Drawing.Color]::FromArgb(11, 14, 15)
  $white = [System.Drawing.Color]::White; $soft = [System.Drawing.Color]::FromArgb(190, 196, 198)
  function Fam([string[]]$names) { foreach ($n in $names) { try { $f = New-Object System.Drawing.FontFamily $n; if ($f.Name -eq $n) { return $f } } catch {} }; return [System.Drawing.FontFamily]::GenericSansSerif }
  function Fnt($fam, [single]$pt) {
    foreach ($style in 'Regular', 'Bold') { try { return New-Object System.Drawing.Font($fam, $pt, [System.Drawing.FontStyle]$style, [System.Drawing.GraphicsUnit]::Point) } catch {} }
    return New-Object System.Drawing.Font('Segoe UI', $pt)
  }
  $heavy = Fam @('Encode Sans Condensed Black', 'Encode Sans Black', 'Segoe UI Black', 'Segoe UI')
  $plain = Fam @('Encode Sans Medium', 'Encode Sans', 'Segoe UI Semibold', 'Segoe UI')
  # the layout below is drawn for a 960 x 540 window at 100%. Fonts are in points and scale with the display by
  # themselves; S() scales the pixel positions and sizes to match (2x on a 200% laptop screen).
  $g0 = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero); $k = $g0.DpiX / 96.0; $g0.Dispose()
  function S([double]$n) { return [int][Math]::Round($n * $k) }

  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Session 609 Pre-Show'; $form.FormBorderStyle = 'None'; $form.StartPosition = 'CenterScreen'
  $form.ClientSize = New-Object System.Drawing.Size((S 960), (S 540)); $form.BackColor = $dark; $form.TopMost = $true; $form.KeyPreview = $true
  $form.AutoScaleMode = [System.Windows.Forms.AutoScaleMode]::None      # laid out in fixed pixels; Windows scales the whole window
  $bgPath = Join-Path $PSScriptRoot '..\assets\preshow\bg.jpg'
  if (Test-Path -LiteralPath $bgPath) { $form.BackgroundImage = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $bgPath).Path); $form.BackgroundImageLayout = 'Stretch' }
  function Lbl([string]$text, $font, $color, [int]$x, [int]$y) {
    $l = New-Object System.Windows.Forms.Label; $l.Text = $text; $l.Font = $font; $l.ForeColor = $color; $l.BackColor = [System.Drawing.Color]::Transparent
    $l.AutoSize = $true; $l.UseMnemonic = $false; $l.Location = New-Object System.Drawing.Point((S $x), (S $y)); $form.Controls.Add($l); return $l
  }
  function Btn([string]$text, [int]$x, [int]$w, $back, $fore, $border) {
    $b = New-Object System.Windows.Forms.Button; $b.Text = $text; $b.Font = Fnt $heavy 17; $b.Size = New-Object System.Drawing.Size((S $w), (S 62)); $b.Location = New-Object System.Drawing.Point((S $x), (S 404))
    $b.FlatStyle = 'Flat'; $b.BackColor = $back; $b.ForeColor = $fore; $b.FlatAppearance.BorderColor = $border; $b.FlatAppearance.BorderSize = (S 2)
    $b.Cursor = [System.Windows.Forms.Cursors]::Hand; $b.TabStop = $false; $b.UseMnemonic = $false; $form.Controls.Add($b); return $b
  }
  $h1 = Lbl '00. PRE-SHOW' (Fnt $heavy 20) $white 50 36
  [void](Lbl 'SESSION 609' (Fnt $plain 17) $green (50 + [int]($h1.PreferredWidth / $k) + 12) 40)
  $esc = Lbl 'ESC TO CLOSE' (Fnt $plain 10) $green 0 46; $esc.Location = New-Object System.Drawing.Point(((S 908) - $esc.PreferredWidth), (S 46)); $esc.Cursor = [System.Windows.Forms.Cursors]::Hand
  [void](Lbl 'READY WHEN YOU ARE' (Fnt $heavy 44) $white 42 176)
  $rows = @(@('DECK', $deckName.ToUpper()), @('DECK TAKES OVER', $whenText.ToUpper()), @('MUSIC', $(if ($tracks.Count) { "$($tracks.Count) TRACKS, SHUFFLED" } else { 'NO MUSIC FILES FOUND' })))
  for ($i = 0; $i -lt $rows.Count; $i++) { [void](Lbl $rows[$i][0] (Fnt $plain 11) $green 52 (270 + $i * 28)); [void](Lbl $rows[$i][1] (Fnt $plain 11) $white 250 (270 + $i * 28)) }
  # the fourth line pairs the presenter's phone as the control room (how that is trusted: see api/preshow.js)
  $hashFile = Join-Path $PSScriptRoot 'admin-phone.hash'
  [void](Lbl 'ADMIN PHONE' (Fnt $plain 11) $green 52 354)
  $pairLbl = Lbl $(if (Test-Path -LiteralPath $hashFile) { 'PAIRED. TO PAIR ANOTHER PHONE, TYPE ITS CODE:' } else { 'NOT PAIRED. TYPE THE CODE FROM YOUR PHONE:' }) (Fnt $plain 11) $white 250 354
  $tb = New-Object System.Windows.Forms.TextBox; $tb.Font = Fnt $plain 11; $tb.MaxLength = 6; $tb.CharacterCasing = 'Upper'; $tb.BorderStyle = 'FixedSingle'; $tb.TextAlign = 'Center'; $tb.TabStop = $false
  $tb.BackColor = $white; $tb.ForeColor = $dark; $tb.Location = New-Object System.Drawing.Point((S 712), (S 351)); $tb.Width = (S 96); $form.Controls.Add($tb)
  $bPair = New-Object System.Windows.Forms.Button; $bPair.Text = 'PAIR'; $bPair.Font = Fnt $heavy 10; $bPair.Size = New-Object System.Drawing.Size((S 92), (S 28)); $bPair.Location = New-Object System.Drawing.Point((S 816), (S 349))
  $bPair.FlatStyle = 'Flat'; $bPair.BackColor = [System.Drawing.Color]::FromArgb(24, 30, 32); $bPair.ForeColor = $white; $bPair.FlatAppearance.BorderColor = $white; $bPair.FlatAppearance.BorderSize = 1
  $bPair.Cursor = [System.Windows.Forms.Cursors]::Hand; $bPair.TabStop = $false; $bPair.UseMnemonic = $false; $form.Controls.Add($bPair)
  $bTest = Btn 'AUDIO TEST' 52 250 ([System.Drawing.Color]::FromArgb(24, 30, 32)) $white $white
  $bGo = Btn 'LAUNCH PRE SHOW' 318 340 $green $dark $green
  $status = Lbl 'AUDIO TEST PLAYS ONE SOFT CHIME THROUGH THE SPEAKERS.' (Fnt $plain 10) $soft 52 486

  # the test sound: a soft two-note chime (G5, then C6), each note a bell-like sine with a touch of its octave that
  # rings out and fades, about a second in all. It is built here in memory, so there is no file to find and nothing
  # to download.
  $rate = 22050; $n = [int]($rate * 1.15); $pcm = New-Object byte[] ($n * 2); $tau = 2 * [Math]::PI
  for ($i = 0; $i -lt $n; $i++) {
    $t = $i / $rate
    $x = [Math]::Min(1.0, $t / 0.008) * [Math]::Exp(-4.5 * $t) * ([Math]::Sin($tau * 783.99 * $t) + 0.22 * [Math]::Sin($tau * 1567.98 * $t))
    $u = $t - 0.16
    if ($u -gt 0) { $x += [Math]::Min(1.0, $u / 0.008) * [Math]::Exp(-4.5 * $u) * ([Math]::Sin($tau * 1046.5 * $u) + 0.22 * [Math]::Sin($tau * 2093.0 * $u)) }
    $v = [int]($x * 0.26 * [Math]::Min(1.0, ($n - 1 - $i) / ($rate * 0.05)) * 32767)
    $pcm[2 * $i] = [byte]($v -band 0xFF); $pcm[2 * $i + 1] = [byte](($v -shr 8) -band 0xFF)
  }
  $wav = New-Object System.IO.MemoryStream; $bw = New-Object System.IO.BinaryWriter $wav; $ascii = [System.Text.Encoding]::ASCII
  $bw.Write($ascii.GetBytes('RIFF')); $bw.Write([int](36 + $pcm.Length)); $bw.Write($ascii.GetBytes('WAVEfmt ')); $bw.Write([int]16)
  $bw.Write([int16]1); $bw.Write([int16]1); $bw.Write([int]$rate); $bw.Write([int]($rate * 2)); $bw.Write([int16]2); $bw.Write([int16]16)
  $bw.Write($ascii.GetBytes('data')); $bw.Write([int]$pcm.Length); $bw.Write($pcm); $bw.Flush()

  # what the button handlers need lives in one script-level table
  $script:ss = @{ result = 'cancel'; form = $form; status = $status; wav = $wav; player = (New-Object System.Media.SoundPlayer); count = 0
                  bTest = $bTest; bGo = $bGo; green = $green; armedAt = $null
                  tb = $tb; bPair = $bPair; pairLbl = $pairLbl; site = $site; hashFile = $hashFile; host = $(if ($site) { ([uri]$site).Host.ToUpper() } else { '' }) }
  # PAIR: ask the server which phone is behind the typed code and remember it (only a hash, nothing secret) on this laptop
  $script:ss.pairNow = {
    $s = $script:ss; $code = $s.tb.Text.Trim().ToUpper()
    if ($code -notmatch '^[A-Z0-9]{6}$') { $s.status.Text = 'ON YOUR PHONE OPEN ' + $s.host + '/ADMIN. TYPE THE SIX-CHARACTER CODE IT SHOWS, THEN PRESS PAIR.'; return }
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
      $r = Invoke-RestMethod -Uri "$($s.site)/api/preshow/pair?code=$code" -TimeoutSec 8
      if ("$($r.hash)" -notmatch '^[0-9a-f]{64}$') { throw 'no pairing' }
      Set-Content -LiteralPath $s.hashFile -Value $r.hash -Encoding ASCII
      $s.tb.Text = ''; $s.pairLbl.Text = 'PAIRED. TO PAIR ANOTHER PHONE, TYPE ITS CODE:'
      $s.status.Text = 'PHONE PAIRED. ITS DASHBOARD COMES ALIVE WHEN THE PRE-SHOW LAUNCHES.'
    } catch { $s.status.Text = 'THAT CODE WAS NOT FOUND OR HAS EXPIRED. CHECK THE PHONE AND TRY AGAIN.' }
  }
  $bPair.Add_Click({ & $script:ss.pairNow })
  $tb.Add_KeyDown({ param($sender, $e) if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Enter) { $e.SuppressKeyPress = $true; & $script:ss.pairNow } })
  $tb.Add_Enter({ $script:ss.status.Text = 'ON YOUR PHONE OPEN ' + $script:ss.host + '/ADMIN. TYPE THE CODE IT SHOWS, THEN PRESS PAIR.' })
  $bTest.Add_Click({
    $s = $script:ss
    try {
      $s.wav.Position = 0; $s.player.Stream = $s.wav; $s.player.Play(); $s.count++
      $s.status.Text = 'TEST CHIME ' + $s.count + ' SENT. IF YOU HEARD IT, THE SPEAKERS ARE CONNECTED. IF NOT, CHECK THE CABLE AND THE VOLUME.'
    } catch { $s.status.Text = ('THE TEST CHIME COULD NOT PLAY: ' + $_.Exception.Message).ToUpper() }
  })
  # LAUNCH takes two presses. The first only arms it: the button turns white and asks to be pressed again. The second
  # starts the show. One double-click cannot do both, because the second press has to come at least half a second
  # after the first. An armed button that is not pressed again goes back to normal after six seconds.
  $bGo.Add_Click({
    $s = $script:ss
    if (-not $s.armedAt) {
      $s.armedAt = Get-Date; $s.bGo.Text = 'PRESS AGAIN TO START'; $s.bGo.BackColor = [System.Drawing.Color]::White
      $s.status.Text = 'PRESS AGAIN TO START THE PRE-SHOW. LEAVE IT FOR SIX SECONDS AND NOTHING HAPPENS.'
    } elseif (((Get-Date) - $s.armedAt).TotalMilliseconds -ge 500) { $s.result = 'launch'; $s.form.Close() }
  })
  $arm = New-Object System.Windows.Forms.Timer; $arm.Interval = 200
  $arm.Add_Tick({
    $s = $script:ss
    if ($s.armedAt -and ((Get-Date) - $s.armedAt).TotalSeconds -ge 6) {
      $s.armedAt = $null; $s.bGo.Text = 'LAUNCH PRE SHOW'; $s.bGo.BackColor = $s.green
      $s.status.Text = 'LAUNCH WAS NOT CONFIRMED. NOTHING HAS STARTED.'
    }
  })
  $esc.Add_Click({ $script:ss.form.Close() })
  $form.Add_KeyDown({ param($sender, $e) if ($e.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $script:ss.form.Close() } })
  $form.Add_Shown({ $script:ss.form.Activate() })
  $arm.Start(); [void]$form.ShowDialog(); $arm.Stop(); $arm.Dispose(); $form.Dispose()
  return $script:ss.result
}

try {
  # ---- the deck
  if (-not $Deck) {
    $cands = @(Get-ChildItem -Path $PSScriptRoot -Filter *.pptx -File | Where-Object { $_.Name -notlike '~$*' })
    if ($cands.Count -ne 1) { throw "Put exactly one .pptx next to launch.ps1, or set DECK in Pre-Show.cmd. Found $($cands.Count)." }
    $Deck = $cands[0].FullName
  }
  if (-not (Test-Path -LiteralPath $Deck)) { throw "Deck not found: $Deck" }
  $Deck = (Resolve-Path -LiteralPath $Deck).Path

  # ---- the questions. They live in a file on this laptop (questions.json next to this script; it is not in the public
  # repo) and are handed to the server when this show is claimed, a few lines further down. -Set says which ordered
  # list of them plays. A file that is there but cannot be used stops the launch: better than the wrong questions.
  $cards = @(); $qFile = if ($Questions) { $Questions } else { Join-Path $PSScriptRoot 'questions.json' }
  if (Test-Path -LiteralPath $qFile) {
    try {
      $bank = Get-Content -LiteralPath $qFile -Raw -Encoding UTF8 | ConvertFrom-Json
      $byId = @{}; foreach ($q in $bank.bank) { $byId["$($q.id)"] = $q }
      $ids = @($bank.sets.$Set)
      if (-not $ids.Count -or -not $ids[0]) { throw "there is no set called '$Set'" }
      foreach ($id in $ids) {
        $q = $byId["$id"]; if (-not $q) { throw "set '$Set' lists '$id', which is not in the bank" }
        $c = $bank.categories."$($q.cat)"
        $cards += @{ q = "$($q.q)"; a = @($q.a | ForEach-Object { "$_" }); ok = [int]$q.ok; d = [int]$q.d; fact = "$($q.fact)"; kind = "$($q.kind)"
                     cat = $(if ($c) { "$($c.name)" } else { "$($q.cat)" }); short = $(if ($c) { "$($c.short)" } else { "$($q.cat)" }) }
      }
    } catch { throw "The question file could not be used ($qFile): $($_.Exception.Message)" }
    Say "Questions: set '$Set', $($cards.Count) rounds."
  } else { Say "No question file at $qFile. The built-in sample questions will play." }

  # ---- the start screen: AUDIO TEST or LAUNCH PRE SHOW. Nothing else happens until LAUNCH is pressed.
  $relative = $ShowAt -match '^\+(\d+(\.\d+)?)$'
  $whenText = if ($relative) { "$($Matches[1]) minutes after you press launch" } else { 'at ' + (Get-Date $ShowAt).ToString('h:mm tt') + " on this laptop's clock" }
  if ($cards.Count) { $whenText += "  ·  $($cards.Count) questions" }
  if (-not $relative -and (Get-Date $ShowAt) -lt (Get-Date).AddSeconds(20)) { throw "Show time $((Get-Date $ShowAt).ToString('HH:mm:ss')) is already here or past. Set SHOWAT to a later time." }
  if (-not $NoMenu) {
    $menuDir = if ($Music) { $Music } else { Join-Path $PSScriptRoot 'music' }
    $menuTracks = @(); if (Test-Path -LiteralPath $menuDir) { $menuTracks = @(Get-ChildItem -LiteralPath $menuDir -File | Where-Object { $_.Extension -match '^\.(mp3|wav|m4a|aac|wma|flac)$' }) }
    $choice = Show-StartScreen (Split-Path $Deck -Leaf) $whenText $menuTracks (([uri]$Url).GetLeftPart([UriPartial]::Authority))
    if ($choice -ne 'launch') { Say 'The start screen was closed without launching.'; exit 0 }
    Say 'LAUNCH PRE SHOW pressed.'
  }

  # ---- the show time (a "+N" time is counted from here, that is, from the launch button)
  if ($ShowAt -match '^\+(\d+(\.\d+)?)$') { $target = (Get-Date).AddMinutes([double]$Matches[1]) } else { $target = Get-Date $ShowAt }
  if ($target -lt (Get-Date).AddSeconds(20)) { throw "Show time $($target.ToString('HH:mm:ss')) is already here or past. Set SHOWAT to a later time." }
  $atMs = [long]([DateTimeOffset]$target).ToUnixTimeMilliseconds()
  Say "Show starts at $($target.ToString('HH:mm:ss')). Deck: $Deck"

  # ---- the game server's clock. The big screen and the phones count down on it, so this script does too:
  # (asked of the preview show, so that nothing has looked up this show before it is claimed, just below)
  # otherwise a laptop clock that is a few seconds off would cut to the deck early or late.
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  $site = ([uri]$Url).GetLeftPart([UriPartial]::Authority)
  $script:srvOffsetMs = 0.0; $SPIN = 8.0; $ASK = 17.0; $ANS = 8.0; $FIN = 20.0; $sampleN = 6; $bestRtt = [double]::MaxValue
  for ($i = 0; $i -lt 3; $i++) {
    try {
      $t0 = Get-Date; $st = Invoke-RestMethod -Uri "$site/api/preshow/state?show=preview" -TimeoutSec 8; $t1 = Get-Date
      $rtt = ($t1 - $t0).TotalMilliseconds
      if ($rtt -lt $bestRtt) {                                     # the quickest round trip is the best clock sample
        $bestRtt = $rtt
        $srv = [DateTimeOffset]::FromUnixTimeMilliseconds([long]$st.now).LocalDateTime
        $script:srvOffsetMs = ($srv - $t1).TotalMilliseconds + $rtt / 2
        $SPIN = $st.spin / 1000; $ASK = $st.ask / 1000; $ANS = $st.answer / 1000; $FIN = $st.final / 1000; $sampleN = [int]$st.n
      }
    } catch { if ($i -eq 2 -and $bestRtt -eq [double]::MaxValue) { Say "Could not reach the game server: $($_.Exception.Message)" } }
  }
  if ($bestRtt -ne [double]::MaxValue) { Say ("Game server reached. Its clock is {0:N0} ms from this laptop's." -f $script:srvOffsetMs) }
  function SNow { (Get-Date).AddMilliseconds($script:srvOffsetMs) }

  # ---- hand this show to the paired admin phone (see "the control room" in api/preshow.js). A show can be claimed
  # once, and this happens before its id is ever on screen. With no phone paired a throwaway hash is used, so the
  # show still cannot be claimed by anyone else.
  $hashFile = Join-Path $PSScriptRoot 'admin-phone.hash'; $adminHash = ''
  if (Test-Path -LiteralPath $hashFile) { $adminHash = "$(Get-Content -LiteralPath $hashFile -TotalCount 1)".Trim() }
  $phone = $adminHash -match '^[0-9a-f]{64}$'
  if (-not $phone) { $rb = New-Object byte[] 32; [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($rb); $adminHash = -join ($rb | ForEach-Object { $_.ToString('x2') }) }
  try {
    $claim = @{ show = "$atMs"; hash = $adminHash }
    if ($cards.Count) { $claim.cards = $cards }                     # this show's questions go to the server with the claim
    $claimJson = [Text.Encoding]::UTF8.GetBytes(($claim | ConvertTo-Json -Depth 6 -Compress))
    $cr = Invoke-RestMethod -Method Post -Uri "$site/api/preshow/claim" -ContentType 'application/json; charset=utf-8' -Body $claimJson -TimeoutSec 12
    if ($cr.ok -and $phone) { Say 'The paired admin phone now controls this show.' } elseif ($cr.ok) { Say 'No admin phone is paired. The show is closed to outside control.' } else { Say 'This show had already been claimed by another device.' }
    if ($cards.Count -and [int]$cr.cards -ne $cards.Count) { throw "the server holds $([int]$cr.cards) of this show's $($cards.Count) questions" }
    if ($cards.Count) { Say "The server has this show's $($cards.Count) questions." }
  } catch {
    if ($cards.Count) { throw "The questions could not be handed to the game server, so the pre-show was not started. ($($_.Exception.Message))" }
    Say "Could not register the admin phone: $($_.Exception.Message)"
  }

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
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vk);
  public static bool XDown() { return (GetAsyncKeyState(0x58) & 0x8000) != 0; }
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
  # ---- music: every audio file in the music folder, shuffled, played from this laptop. Nothing is streamed or uploaded.
  # It fades in, moves to the next track when one ends, and is silent just over a second before the deck takes over.
  $mp = $null; $tracks = @(); $script:ti = -1; $script:trackStart = Get-Date
  $musicDir = if ($Music) { $Music } else { Join-Path $PSScriptRoot 'music' }
  if (Test-Path -LiteralPath $musicDir) {
    $tracks = @(Get-ChildItem -LiteralPath $musicDir -File | Where-Object { $_.Extension -match '^\.(mp3|wav|m4a|aac|wma|flac)$' } | Sort-Object { Get-Random })
  }
  if ($tracks.Count) {
    try { Add-Type -AssemblyName PresentationCore, WindowsBase; $mp = New-Object System.Windows.Media.MediaPlayer }
    catch { Say "Music unavailable: $($_.Exception.Message)" }
  } else { Say "No music files in $musicDir. The pre-show runs without music." }
  function NextTrack {
    $script:ti = ($script:ti + 1) % $tracks.Count
    $f = $tracks[$script:ti]
    try { $mp.Stop(); $mp.Open([uri]$f.FullName); $mp.Volume = 0; $mp.Play(); $script:trackStart = Get-Date; Say "Music: $($f.BaseName)" }
    catch { Say "Could not play $($f.Name): $($_.Exception.Message)" }
  }
  if ($mp) { NextTrack }

  # ---- the announcer: an ElevenLabs voice. The server writes each line from the live leaderboard and returns the audio;
  # this script only asks for it on a schedule and plays it, dipping the music underneath. Schedule, in server time:
  # a welcome just after the start, a standings update at an answer reveal roughly every two minutes (every fourth
  # round), and the winner over the closing countdown. Each request says when the line will start playing, so the
  # server can put its captions on the big screen and the phones at that moment.
  # Each line is requested several seconds early because the
  # expressive voice model takes a moment; one that fails or arrives too late is simply skipped.
  $plan = New-Object System.Collections.ArrayList; $vp = $null
  $script:voiceOn = $false; $script:voiceStart = Get-Date; $script:duck = 1.0
  if (-not $NoVoice) {
    try { Add-Type -AssemblyName PresentationCore, WindowsBase; $vp = New-Object System.Windows.Media.MediaPlayer }
    catch { Say "Voice unavailable: $($_.Exception.Message)" }
  }
  if ($vp) {
    $s0 = SNow; $CYC = $SPIN + $ASK + $ANS; $N = if ($cards.Count) { $cards.Count } else { $sampleN }
    if (($target - $s0).TotalSeconds -gt 70) { [void]$plan.Add(@{ kind = 'welcome'; fetch = $s0.AddSeconds(1); play = $s0.AddSeconds(5); late = 8 }) }
    for ($j = 2; $j -lt $N; $j += 4) {                               # counting rounds back from the last one
      $rev = $target.AddSeconds(-($FIN + $ANS + $j * $CYC))        # the moment card j-from-the-end shows its answer
      if ($rev -lt $s0.AddSeconds(30)) { break }
      [void]$plan.Add(@{ kind = 'mid'; fetch = $rev.AddSeconds(-9); play = $rev.AddSeconds(0.7); late = 6 })
    }
    [void]$plan.Add(@{ kind = 'final'; fetch = $target.AddSeconds(-($FIN + 7)); play = $target.AddSeconds(-$FIN + 0.8); late = 3 })
    Say "Announcer: $($plan.Count) lines planned."
  }

  $nextNudge = (Get-Date).AddSeconds(240)
  if ($Nudge) { Say 'Nudge is on: an F15 key tap every 4 minutes keeps the idle lock away.' }
  $abort = $false; $xSince = $null
  while ((SNow) -lt $target) {
    for ($k = 0; $k -lt 4 -and -not $abort; $k++) {                # 200 ms a turn, looking at the X key every 50
      Start-Sleep -Milliseconds 50
      if ([PreShowWin]::XDown()) { if (-not $xSince) { $xSince = Get-Date } elseif (((Get-Date) - $xSince).TotalSeconds -ge 1.5) { $abort = $true } }
      else { $xSince = $null }
    }
    if ($abort) { Say 'X was held down: stopping the pre-show.'; break }
    if (-not (KioskProcs)) { Say 'Kiosk closed by hand; revealing the deck now.'; break }
    $sn = SNow
    foreach ($a in $plan) {
      if (-not $a.task -and $sn -ge $a.fetch -and $sn -lt $a.play.AddSeconds($a.late)) {
        $a.file = Join-Path $env:TEMP ("preshow-voice-$atMs-$($a.kind)-$($plan.IndexOf($a)).mp3")
        $a.wc = New-Object System.Net.WebClient
        $a.task = $a.wc.DownloadFileTaskAsync([uri]"$site/api/preshow/announce?show=$atMs&kind=$($a.kind)&play=$(([DateTimeOffset]$a.play).ToUnixTimeMilliseconds())", $a.file)
      }
      if ($a.task -and -not $a.done -and $sn -ge $a.play) {
        if ($a.task.IsCompleted) {
          $a.done = $true
          if ($a.task.Status -eq 'RanToCompletion' -and (Test-Path -LiteralPath $a.file) -and (Get-Item -LiteralPath $a.file).Length -gt 2000) {
            $words = ''; try { $words = [uri]::UnescapeDataString($a.wc.ResponseHeaders['X-Voice-Text']) } catch {}
            try { $vp.Stop(); $vp.Open([uri]$a.file); $vp.Volume = $VoiceVolume; $vp.Play(); $script:voiceStart = Get-Date; $script:voiceOn = $true; Say "Voice ($($a.kind)): $words" }
            catch { Say "Voice ($($a.kind)) could not play: $($_.Exception.Message)" }
          } else {
            $why = 'no audio came back'; try { $why = $a.task.Exception.InnerException.Message } catch {}
            Say "Voice ($($a.kind)) skipped: $why"
          }
        } elseif ($sn -gt $a.play.AddSeconds($a.late)) { $a.done = $true; try { $a.wc.CancelAsync() } catch {}; Say "Voice ($($a.kind)) skipped: too slow." }
      }
    }
    if ($script:voiceOn) {
      $spoke = ((Get-Date) - $script:voiceStart).TotalSeconds
      try { if (($vp.NaturalDuration.HasTimeSpan -and $vp.Position -ge $vp.NaturalDuration.TimeSpan.Subtract([TimeSpan]::FromMilliseconds(200))) -or $spoke -gt 25) { $script:voiceOn = $false } }
      catch { $script:voiceOn = $false }
    }
    $duckTo = if ($script:voiceOn) { 0.22 } else { 1.0 }                                 # music drops to about a fifth under the voice
    $script:duck = $script:duck + [Math]::Max(-0.3, [Math]::Min(0.3, $duckTo - $script:duck))
    if ($mp) {
      $left = ($target - $sn).TotalSeconds; $played = ((Get-Date) - $script:trackStart).TotalSeconds
      $v = $MusicVolume * [Math]::Min(1, $played / 2)                         # two-second fade in
      if ($left -lt 6) { $v = $v * [Math]::Max(0, ($left - 1.2) / 4.8) }      # fade out; silent 1.2 s before the deck
      $ended = $false
      try {
        $mp.Volume = $v * $script:duck
        if ($mp.NaturalDuration.HasTimeSpan) { $ended = $mp.Position -ge $mp.NaturalDuration.TimeSpan.Subtract([TimeSpan]::FromMilliseconds(350)) }
        elseif ($played -gt 8 -and $mp.Position.TotalSeconds -lt 0.5) { $ended = $true }   # a file that never started
      } catch {}
      if ($ended -and $left -gt 8) { NextTrack }
    }
    if ($Nudge -and (Get-Date) -ge $nextNudge) {
      [PreShowWin]::keybd_event(0x7E, 0, 0, [UIntPtr]::Zero); [PreShowWin]::keybd_event(0x7E, 0, 2, [UIntPtr]::Zero)   # F15 down, up
      $nextNudge = (Get-Date).AddSeconds(240)
    }
  }
  if ($mp) { try { $mp.Stop(); $mp.Close() } catch {} }
  if ($vp) { try { $vp.Stop(); $vp.Close() } catch {} }
  if ($abort) {                                                    # the full stop: no deck, back to the desktop
    KioskProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    try { $ssw.View.Exit() } catch {}
    Say 'Pre-show stopped. The slideshow was closed; the deck itself is untouched.'
    exit 0
  }

  # By now the page has let its words fade and shows only the deck's background. Start slide 1 while the slideshow is
  # still hidden under the browser, then lift it above the browser and give it the keyboard, and only then close the
  # browser. Same background on both, so the title simply arrives; no other window can flash through.
  Retry { $ssw.View.GotoSlide(1, -1) } 8 | Out-Null                # slide 1 from the top: animations and timings start now
  try { if ($ssw.View.State -ne 1) { $ssw.View.State = 1 } } catch {}
  Start-Sleep -Milliseconds 350                                    # let PowerPoint paint the slide before it is shown
  [PreShowWin]::Raise($hwnd, $true)
  $sf = [PreShowWin]::Focus($hwnd)
  KioskProcs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 300
  if (-not $sf) { $sf = [PreShowWin]::Focus($hwnd) }
  [PreShowWin]::Raise($hwnd, $false)                               # no longer pinned: Alt+Tab and Esc behave as usual
  Say "Showtime. The deck has the screen (keyboard focus on the slideshow: $sf)."
}
catch {
  Say "FAILED: $($_.Exception.Message)"
  try { $script:gate.ReleaseMutex() } catch {}                      # the error box below must not keep the next launch out
  try { Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show("Pre-show could not start:`n`n$($_.Exception.Message)", 'Side-Qlik Pre-Show') | Out-Null } catch {}
  exit 1
}
