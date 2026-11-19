# Semantic UI Automation driver: snapshot an app control tree, act by name/id, then verify.
# There is no coordinate, mouse or keyboard synthesis here on purpose: this tool only speaks the
# accessibility patterns Windows exposes (Invoke, Toggle, SelectionItem, Value, RangeValue).
param(
  [Parameter(Mandatory = $true)][string]$ProcessName,
  [ValidateSet('list', 'invoke', 'set', 'get')][string]$Mode = 'list',
  [string]$Name = '',
  [string]$AutoId = '',
  [int]$Index = 0,
  [string]$Value = '',
  [string]$Window = '',
  [int]$Limit = 300
)
$ErrorActionPreference = 'Stop'
# Node reads this stream as UTF-8; PowerShell 5.1 would otherwise emit the console OEM code page.
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$ALL = [System.Windows.Automation.Condition]::TrueCondition

function Find-Window {
  $procs = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue)
  $roots = $AE::RootElement.FindAll($TS::Children, $ALL)
  if ($Window) {
    foreach ($w in $roots) { if ($w.Current.Name -and $w.Current.Name -match $Window) { return $w } }
  }
  if (-not $procs.Count) { throw ("process '{0}' is not running" -f $ProcessName) }
  # Several instances can share a name; take the first one that actually owns controls.
  foreach ($p in $procs) {
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, [int]$p.Id)
    $own = $AE::RootElement.FindFirst($TS::Children, $cond)
    if ($own) { return $own }
  }
  # Hosted apps (UWP / ApplicationFrameHost): the window belongs to the host, the controls do not.
  foreach ($p in $procs) {
    $cond = New-Object System.Windows.Automation.PropertyCondition($AE::ProcessIdProperty, [int]$p.Id)
    foreach ($w in $roots) {
      try { if ($w.FindFirst($TS::Descendants, $cond)) { return $w } } catch { }
    }
  }
  $titles = @()
  foreach ($w in $roots) { if ($w.Current.Name) { $titles += $w.Current.Name } }
  throw ("no window found for '{0}'; visible windows: {1}. If this is a UWP/hosted app (the window belongs to ApplicationFrameHost), pass -Window <title regex> or bring the app to the foreground." -f $ProcessName, ($titles -join ' | '))
}
function Get-PatternNames($e) {
  $out = @()
  try { foreach ($pt in $e.GetSupportedPatterns()) { $out += $pt.ProgrammaticName.Replace('PatternIdentifiers.Pattern', '').Replace('Pattern', '') } } catch { }
  return $out
}

function Get-TextValue($e) {
  try {
    $vp = $e.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($vp) { return [string]$vp.Current.Value }
  } catch { }
  return ''
}

function Get-Snapshot($win, $limit) {
  $els = $win.FindAll($TS::Descendants, $ALL)
  $rows = @()
  $n = 0
  foreach ($e in $els) {
    if ($rows.Count -ge $limit) { break }
    $c = $e.Current
    $pats = Get-PatternNames $e
    $actions = @()
    if ($pats -contains 'Invoke') { $actions += 'invoke' }
    if ($pats -contains 'Toggle') { $actions += 'toggle' }
    if ($pats -contains 'SelectionItem') { $actions += 'select' }
    if ($pats -contains 'Value') { $actions += 'set' }
    if ($pats -contains 'RangeValue') { $actions += 'set' }
    if ($pats -contains 'ExpandCollapse') { $actions += 'expand' }
    $rows += [pscustomobject]@{
      ref = ('e' + $n)
      index = $n
      controlType = $c.ControlType.ProgrammaticName.Replace('ControlType.', '')
      name = $c.Name
      autoId = $c.AutomationId
      enabled = $c.IsEnabled
      offscreen = $c.IsOffscreen
      patterns = $pats
      actions = $actions
      value = (Get-TextValue $e)
    }
    $n++
  }
  return @{ rows = $rows; total = $els.Count; elements = $els }
}

function Get-Signature($rows) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($r in $rows) {
    [void]$sb.Append($r.controlType).Append('|').Append($r.name).Append('|').Append($r.value).Append('|').Append(($r.actions -join ',')).Append("`n")
  }
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $hash = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($sb.ToString()))
  return ([BitConverter]::ToString($hash) -replace '-', '').Substring(0, 16)
}

function Select-Target($rows, $autoId, $name, $index) {
  $pool = @($rows | Where-Object { -not $_.offscreen })
  if ($pool.Count -eq 0) { $pool = @($rows) }
  $cands = @()
  if ($autoId) { $cands = @($pool | Where-Object { $_.autoId -eq $autoId }) }
  if ($cands.Count -eq 0 -and $name) {
    $cands = @($pool | Where-Object { $_.name -eq $name })
    if ($cands.Count -eq 0) { $cands = @($pool | Where-Object { $_.name -and $_.name.IndexOf($name, [StringComparison]::OrdinalIgnoreCase) -ge 0 }) }
  }
  if ($cands.Count -eq 0) { return $null }
  if ($index -lt 0 -or $index -ge $cands.Count) { return $null }
  return $cands[$index]
}
$result = [ordered]@{ ok = $false; mode = $Mode; app = $ProcessName }
try {
  $win = Find-Window
  $result.windowName = $win.Current.Name
  $snap = Get-Snapshot $win $Limit
  if (@($snap.rows).Count -eq 0) {
    # Modern UWP/WinUI apps expose an empty tree while suspended in the background.
    # SetFocus is a semantic request to the window, not a synthetic click.
    try { $win.SetFocus() } catch { }
    Start-Sleep -Milliseconds 500
    $snap = Get-Snapshot $win $Limit
  }
  if (@($snap.rows).Count -eq 0) {
    $msg = "window " + [char]39 + $win.Current.Name + [char]39 + " exposes no controls right now (app suspended in the background?): bring it to the foreground and retry"
    throw $msg
  }
  $rows = @($snap.rows)
  if ($Mode -eq 'list') {
    $result.ok = $true
    $result.total = $snap.total
    $result.shown = $rows.Count
    $result.truncated = ($snap.total -gt $rows.Count)
    $result.elements = @($rows)
    $result.signature = Get-Signature $rows
    $result.actionable = @($rows | Where-Object { $_.actions.Count -gt 0 }).Count
  } else {
    $target = Select-Target $rows $AutoId $Name $Index
    if (-not $target) {
      if ($AutoId) { throw ("no element matched autoId '{0}'" -f $AutoId) }
      throw ("no element matched name '{0}'" -f $Name)
    }
    $targetEl = $snap.elements.Item([int]$target.index)
    $result.target = $target
    $sigBefore = Get-Signature $rows
    $result.before = @{ name = $target.name; value = $target.value; enabled = $target.enabled; signature = $sigBefore }
    switch ($Mode) {
      'get' { }
      'invoke' {
        if ($target.actions -contains 'invoke') {
          $ip = $targetEl.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
          $result.pattern = 'Invoke'
          $ip.Invoke()
        } elseif ($target.actions -contains 'toggle') {
          $tp = $targetEl.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
          $result.pattern = 'Toggle'
          $tp.Toggle()
        } elseif ($target.actions -contains 'select') {
          $sp = $targetEl.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
          $result.pattern = 'SelectionItem'
          $sp.Select()
        } else {
          throw ("element has no semantic action (patterns: {0}); a self-drawn surface can only be driven by computer use" -f ($target.patterns -join ', '))
        }
      }
      'set' {
        if ($target.patterns -contains 'Value') {
          $vp = $targetEl.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
          $result.pattern = 'Value'
          $vp.SetValue($Value)
        } elseif ($target.patterns -contains 'RangeValue') {
          $rp = $targetEl.GetCurrentPattern([System.Windows.Automation.RangeValuePattern]::Pattern)
          $result.pattern = 'RangeValue'
          $rp.SetValue([double]$Value)
        } else {
          throw ("element does not accept text (patterns: {0})" -f ($target.patterns -join ', '))
        }
      }
    }
    if ($Mode -ne 'get') { Start-Sleep -Milliseconds 400 }
    # A close/quit action destroys the window; that is success, not a failed read.
    try { $after = Get-Snapshot $win $Limit } catch { $after = @{ rows = @(); total = 0 } }
    if (@($after.rows).Count -eq 0) {
      $result.ok = $true
      $result.windowClosed = $true
      $result.changed = $true
      $result.verified = $true
      $result.note = 'window is gone after the action - treated as applied'
      $result | ConvertTo-Json -Depth 6 -Compress
      exit 0
    }
    $afterRows = @($after.rows)
    $sigAfter = Get-Signature $afterRows
    $again = @()
    if ($target.autoId) { $again = @($afterRows | Where-Object { $_.autoId -eq $target.autoId }) }
    if ($again.Count -eq 0 -and $target.name) { $again = @($afterRows | Where-Object { $_.name -eq $target.name }) }
    $result.after = @{ signature = $sigAfter; element = $(if ($again.Count -gt 0) { $again[0] } else { $null }) }
    if ($Mode -eq 'get') {
      $result.ok = $true
      if ($again.Count -gt 0) {
        if ($again[0].value) { $result.text = $again[0].value } else { $result.text = $again[0].name }
      } else { $result.text = $target.value }
    } else {
      $result.ok = $true
      $result.changed = ($sigAfter -ne $sigBefore)
      $result.verified = $result.changed
      if (-not $result.changed) { $result.note = 'action was sent but nothing observable changed in the control tree - treat it as not done' }
    }
  }
} catch {
  $result.ok = $false
  $result.error = $_.Exception.Message
}
$json = $result | ConvertTo-Json -Depth 6 -Compress
[Console]::Out.Write($json)