<#
.SYNOPSIS
  Build the SnekPad firmware and flash it onto a pad over its USB console (Windows).

.DESCRIPTION
  1. Runs build_mpy.py to compile the firmware to .mpy files.
  2. Removes leftovers from the pad (old .py files that shadow a .mpy, .bak/.new files,
     editor and trash folders) and writes the new files, checking the size of each one.
  3. Restarts the pad and reads its start-up output, then reports PASS or FAIL.

  It needs no drive: the pad's own CircuitPython writes the files, so it works with the
  CIRCUITPY drive hidden (boot.py storage=False). It does NOT touch kmk/, lib/ or boot.py,
  and keeps config.json unless -ResetConfig is given.

.PARAMETER MpyCross
  Path to the mpy-cross build that matches the pad's CircuitPython version
  (`mpy-cross --version` must match boot_out.txt on the pad).

.PARAMETER Dev
  Development flash: creates /nowatchdog so the watchdog stays off while you work at the console.
  Without -Dev (the customer build) the file is removed and the watchdog is on.

.PARAMETER ResetConfig
  Also delete config.json, so the pad starts on the built-in profiles.

.PARAMETER Port
  The pad's console port (for example COM3). Found automatically when left out.
  The SnekPad app must not be holding that port; close the app's connection first if it does.

.EXAMPLE
  .\flash_pad.ps1 -MpyCross C:\tools\mpy-cross-windows-10.3.1.static.exe
#>
param(
    [Parameter(Mandatory = $true)][string]$MpyCross,
    [switch]$Dev,
    [switch]$ResetConfig,
    [string]$Port
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$build = Join-Path $here 'build'

# --- what goes on the pad -------------------------------------------------------------------
$files = 'firmware.mpy', 'config_loader.mpy', 'rgb_keys.mpy', 'encoder_modes.mpy', 'app_profiles.mpy', 'oled_ui.mpy', 'code.py', 'boot.py'
$modules = 'config_loader', 'rgb_keys', 'encoder_modes', 'app_profiles', 'oled_ui', 'firmware'
$junkDirs = '.Trash-1000', '.Trashes', '.fseventsd', '.vscode', 'System Volume Information'

# --- serial helpers -------------------------------------------------------------------------
$script:P = $null

function Find-Port {
    # the pad's console is interface 0 of the RP2040 (VID 2E8A); the app's data port is interface 2
    $dev = Get-CimInstance Win32_PnPEntity | Where-Object { $_.PNPDeviceID -match 'VID_2E8A&PID_101F&MI_00' -and $_.Name -match '\((COM\d+)\)' }
    if (-not $dev) { throw "No SnekPad console found. Plug the pad in, or pass -Port." }
    return ([regex]::Match(($dev | Select-Object -First 1).Name, '\((COM\d+)\)')).Groups[1].Value
}

function Open-Pad([string]$name) {
    for ($i = 0; $i -lt 10; $i++) {
        try { $t = New-Object System.IO.Ports.SerialPort $name, 115200; $t.DtrEnable = $true; $t.Open(); $script:P = $t; break }
        catch { Start-Sleep 2 }
    }
    if (-not $script:P) { throw "Can't open $name. Is another program (Thonny, a terminal, the app) using it?" }
    $script:P.Write([string][char]3); Start-Sleep -Milliseconds 300     # Ctrl-C twice: stop the firmware
    $script:P.Write([string][char]3); Start-Sleep -Milliseconds 500
    $script:P.Write([string][char]1); Start-Sleep -Milliseconds 500     # Ctrl-A: raw REPL
    $script:P.ReadExisting() | Out-Null
}

function Pad-Exec([string]$code, [int]$timeout = 30) {
    $script:P.Write($code); $script:P.Write([string][char]4)
    $buf = ''
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.Elapsed.TotalSeconds -lt $timeout) {
        $buf += $script:P.ReadExisting()
        if ($buf.Contains('OK') -and ([regex]::Matches($buf, [string][char]4)).Count -ge 2) { break }
        Start-Sleep -Milliseconds 15
    }
    $parts = $buf.Split([char]4)
    if ($parts.Count -lt 3) { throw "No reply from the pad: $buf" }
    if ($parts[1].Length -gt 0) { throw "Pad error: $($parts[1])" }
    $at = $parts[0].IndexOf('OK')       # a stray prompt character can come first
    if ($at -lt 0) { throw "Unexpected reply from the pad: $buf" }
    return $parts[0].Substring($at + 2)
}

function Pad-Put([string]$local, [string]$remote) {
    $bytes = [IO.File]::ReadAllBytes($local)
    $b64 = [Convert]::ToBase64String($bytes)
    Pad-Exec "import os, binascii`nfh = open('$remote.new', 'wb')`n" | Out-Null
    for ($i = 0; $i -lt $b64.Length; $i += 400) {
        $chunk = $b64.Substring($i, [Math]::Min(400, $b64.Length - $i))
        Pad-Exec "fh.write(binascii.a2b_base64('$chunk'))`n" | Out-Null
    }
    $r = Pad-Exec "fh.close()`ntry:`n    os.remove('$remote')`nexcept OSError:`n    pass`nos.rename('$remote.new', '$remote')`nprint(os.stat('$remote')[6])`n"
    if ([int]$r.Trim() -ne $bytes.Length) { throw "Size mismatch for $remote (pad $($r.Trim()), file $($bytes.Length))" }
    Write-Host ("  wrote {0,-20} {1,6} bytes" -f $remote, $bytes.Length)
}

# --- 1. build -------------------------------------------------------------------------------
Write-Host "Building..."
& python (Join-Path $here 'build_mpy.py') --mpy-cross $MpyCross
if ($LASTEXITCODE) { throw "build_mpy.py failed" }
foreach ($f in $files) { if (-not (Test-Path (Join-Path $build $f))) { throw "Build is missing $f" } }

# --- 2. flash -------------------------------------------------------------------------------
if (-not $Port) { $Port = Find-Port }
Write-Host "Pad console: $Port"
Open-Pad $Port
try {
    $info = (Pad-Exec "print(open('/boot_out.txt').read().split('\n')[0])`n").Trim()
    Write-Host "Pad runs: $info"

    Write-Host "Cleaning..."
    $removed = Pad-Exec @"
import os
def rm(p):
    try:
        st = os.stat(p)
    except OSError:
        return
    if st[0] & 0x4000:
        for n in os.listdir(p):
            rm(p + '/' + n)
        os.rmdir(p)
    else:
        os.remove(p)
    print('  removed', p)
for d in ($(($junkDirs | ForEach-Object { "'$_'" }) -join ', ')):
    rm('/' + d)
for m in ($(($modules | ForEach-Object { "'$_'" }) -join ', ')):
    rm('/' + m + '.py')
for n in os.listdir('/'):
    if n.endswith('.bak') or n.endswith('.new'):
        rm('/' + n)
"@
    if ($removed.Trim()) { Write-Host $removed.TrimEnd() } else { Write-Host "  nothing to remove" }
    if ($ResetConfig) { Pad-Exec "import os`ntry:`n    os.remove('/config.json')`n    print('removed config.json')`nexcept OSError:`n    pass`n" | ForEach-Object { if ($_.Trim()) { Write-Host "  $($_.Trim())" } } }

    Write-Host "Writing..."
    foreach ($f in $files) { Pad-Put (Join-Path $build $f) "/$f" }

    if ($Dev) {
        Pad-Exec "open('/nowatchdog', 'w').close()`n" | Out-Null
        Write-Host "Dev build: watchdog off (/nowatchdog)"
    } else {
        Pad-Exec "import os`ntry:`n    os.remove('/nowatchdog')`nexcept OSError:`n    pass`n" | Out-Null
        Write-Host "Customer build: watchdog on"
    }

    Pad-Exec "import os`ntry:`n    os.sync()`nexcept Exception:`n    pass`n" | Out-Null
    $extra = (Pad-Exec "import os`nprint(' '.join(sorted(os.listdir('/'))))`n").Trim()
    Write-Host "On the pad: $extra"

    # --- 3. restart and check ---------------------------------------------------------------
    Write-Host "Restarting..."
    $script:P.Write([string][char]2); Start-Sleep -Milliseconds 300     # Ctrl-B: leave raw REPL
    $script:P.Write([string][char]4)                                    # Ctrl-D: restart
    Start-Sleep -Seconds 10
    $out = $script:P.ReadExisting()
}
finally {
    if ($script:P) { $script:P.Close() }
}

$checks = [ordered]@{
    'firmware started'    = ($out -match 'snekpad firmware starting')
    'OLED ready'          = ($out -match 'oled_ui ready')
    'knob ready'          = ($out -match 'encoder_modes ready')
    'LEDs ready'          = ($out -match 'rgb_keys ready')
    'no crash'            = (-not ($out -match 'Traceback|firmware stopped|MemoryError'))
    'watchdog as chosen'  = $(if ($Dev) { $out -match 'watchdog off' } else { $out -match 'watchdog on' })
}
$ram = [regex]::Match($out, 'free RAM: (\d+)')
Write-Host ""
$ok = $true
foreach ($k in $checks.Keys) {
    Write-Host ("  [{0}] {1}" -f $(if ($checks[$k]) { 'PASS' } else { 'FAIL' }), $k)
    if (-not $checks[$k]) { $ok = $false }
}
if ($ram.Success) { Write-Host "  free RAM at start: $($ram.Groups[1].Value) bytes" }
if (-not $ok) { Write-Host "`n--- pad output ---`n$out"; throw "Flash finished but the pad did not start cleanly" }
Write-Host "`nPASS: the pad is flashed and running."
