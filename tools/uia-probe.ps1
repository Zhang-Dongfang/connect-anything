Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$procIds = (Get-Process Weixin, WeChat -ErrorAction SilentlyContinue).Id
$tops = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
"top-level windows total: $($tops.Count)"
foreach ($w in $tops) {
  $wpid = $w.Current.ProcessId
  if ($procIds -notcontains $wpid) { continue }
  "WINDOW pid=$wpid name='$($w.Current.Name)' class='$($w.Current.ClassName)' auto='$($w.Current.AutomationId)' rect='$($w.Current.BoundingRectangle)'"
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue(@($w, 0))
  $count = 0
  while ($queue.Count -gt 0 -and $count -lt 150) {
    $item = $queue.Dequeue(); $el = $item[0]; $d = $item[1]
    if ($d -gt 0) {
      $count++
      ('  ' * $d) + "- [$($el.Current.ControlType.ProgrammaticName -replace 'ControlType.','')] name='$($el.Current.Name)' class='$($el.Current.ClassName)' auto='$($el.Current.AutomationId)'"
    }
    if ($d -ge 4) { continue }
    try { foreach ($ch in $el.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)) { $queue.Enqueue(@($ch, $d + 1)) } } catch {}
  }
  "  (...children shown: $count)"
}