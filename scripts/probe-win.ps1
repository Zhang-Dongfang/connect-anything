# Collect raw integration facts about a running app on Windows. Emits JSON on stdout.
# Verdict logic lives in src/probe.js, not here, so it stays unit-testable.
param([Parameter(Mandatory=$true)][string]$ProcessName, [int]$MaxNamed = 4000, [int]$MaxDepth = 12)
$ErrorActionPreference = 'SilentlyContinue'

$procs = @(Get-Process -Name $ProcessName)
$instances = @()
$pids = @()
foreach ($p in $procs) {
  $pids += $p.Id
  $path = $null; $ver = $null; $cmd = $null
  try { $path = $p.Path; $ver = $p.MainModule.FileVersionInfo.FileVersion } catch {}
  try { $cmd = (Get-CimInstance Win32_Process -Filter ('ProcessId=' + $p.Id)).CommandLine } catch {}
  $instances += [pscustomobject]@{ pid = $p.Id; path = $path; version = $ver; hasWindow = ($p.MainWindowHandle -ne 0); cmd = ($cmd -replace '\s+', ' ') }
}

$listeners = @()
if ($pids.Count -gt 0) {
  netstat -ano | Select-String 'LISTENING' | ForEach-Object {
    $f = @(($_ -split '\s+') | Where-Object { $_ })
    if ($f.Count -ge 5 -and $pids -contains [int]$f[4]) { $listeners += ($f[1] + '|' + $f[4]) }
  }
}
$listeners = @($listeners | Select-Object -Unique)

# Which registered URL protocols launch this executable?
$schemes = @()
$exeBases = @($instances | Where-Object { $_.path } | ForEach-Object { [IO.Path]::GetFileNameWithoutExtension($_.path) } | Select-Object -Unique)
$candidateKeys = @()
foreach ($b in $exeBases) { $candidateKeys += $b.ToLower() }
foreach ($b in @($ProcessName)) { $candidateKeys += $b.ToLower() }
foreach ($k in @($candidateKeys | Select-Object -Unique)) {
  foreach ($root in 'HKCU:\Software\Classes\', 'HKLM:\SOFTWARE\Classes\') {
    $cmdText = (Get-ItemProperty ($root + $k + '\shell\open\command')).'(default)'
    if ($cmdText) { $schemes += [pscustomobject]@{ scheme = $k; scope = $root.Split(':')[0]; command = $cmdText } }
  }
}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -Path (Join-Path $PSScriptRoot '..\tools\cxa-acc.cs')
$windows = @()
if ($pids.Count -gt 0) {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $tops = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
  foreach ($w in $tops) {
    $wpid = $w.Current.ProcessId
    if ($pids -notcontains $wpid) { continue }

    $descendants = 0; $namedControl = 0; $samples = @()
    try {
      $all = $w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
      $descendants = $all.Count
      foreach ($el in $all) {
        if ($namedControl -ge $MaxNamed) { break }
        $isCtrl = $false; $name = ''
        try { $isCtrl = $el.Current.IsControlElement } catch {}
        try { $name = $el.Current.Name } catch {}
        if ($isCtrl -and -not [string]::IsNullOrWhiteSpace($name)) {
          $namedControl++
          if ($samples.Count -lt 10) { $samples += $name }
        }
      }
    } catch {}

    # Legacy apps often expose their real controls through MSAA (oleacc) only.
    $msaaChildren = -1; $childClasses = @()
    try {
      $h = [IntPtr]::new([long]$w.Current.NativeWindowHandle)
      if ($h -ne [IntPtr]::Zero) {
        $msaaChildren = [CxaAcc]::ChildCount($h)
        $cls = [CxaAcc]::ChildClasses($h)
        if ($cls) { $childClasses = @($cls -split ';' | Where-Object { $_ }) }
      }
    } catch {}

    $windows += [pscustomobject]@{
      pid = $wpid; name = $w.Current.Name; className = $w.Current.ClassName
      hwnd = [long]$w.Current.NativeWindowHandle
      uiaDescendants = $descendants; uiaNamedControl = $namedControl
      uiaSamples = @($samples | Select-Object -Unique)
      msaaChildren = $msaaChildren; childClasses = @($childClasses | Select-Object -Unique)
    }
  }
}

$remoteDebug = @()
foreach ($i in $instances) {
  foreach ($m in [regex]::Matches($i.cmd, '--remote-debugging-port=(\d+)')) { $remoteDebug += $m.Groups[1].Value }
  foreach ($m in [regex]::Matches($i.cmd, '--remote-debugging-pipe')) { $remoteDebug += 'pipe' }
}
$cdpProbe = @()
foreach ($port in @($remoteDebug | Select-Object -Unique)) {
  if ($port -eq 'pipe') { continue }
  try {
    $r = Invoke-WebRequest ('http://127.0.0.1:' + $port + '/json/version') -TimeoutSec 2 -UseBasicParsing
    $cdpProbe += [pscustomobject]@{ port = [int]$port; ok = $true; body = $r.Content.Substring(0, [Math]::Min(200, $r.Content.Length)) }
  } catch { $cdpProbe += [pscustomobject]@{ port = [int]$port; ok = $false; body = $null } }
}
# WebView2 (Tauri, Edge, WinUI) hosts its Chromium runtime in msedgewebview2.exe children, so the
# app process itself never matches a Chromium name. Checking the children fixes a false negative
# that used to report "Not a Chromium app" for every Tauri app.
$webview2 = [pscustomobject]@{ detected = $false; pids = @() }
try {
  $appPids = @($instances | Where-Object { $_.pid } | ForEach-Object { [int]$_.pid })
  if ($appPids.Count -gt 0) {
    $wv = @(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" -ErrorAction SilentlyContinue)
    $hit = @($wv | Where-Object { $appPids -contains [int]$_.ParentProcessId } | ForEach-Object { [int]$_.ProcessId })
    if ($hit.Count -gt 0) { $webview2 = [pscustomobject]@{ detected = $true; pids = @($hit) } }
  }
} catch {}
[pscustomobject]@{
  platform = 'win32'
  processName = $ProcessName
  running = ($procs.Count -gt 0)
  instances = @($instances)
  listeners = @($listeners)
  schemes = @($schemes)
  windows = @($windows)
  cdpPorts = @($remoteDebug | Select-Object -Unique)
  cdpProbe = @($cdpProbe)
  webview2 = $webview2
} | ConvertTo-Json -Depth 8 -Compress