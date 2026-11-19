param([Parameter(Mandatory=$true)][string]$ProcessName)
$sig = @"
using System;
using System.Runtime.InteropServices;
public class Mem {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out IntPtr read);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [StructLayout(LayoutKind.Sequential)] public struct MEMORY_BASIC_INFORMATION {
    public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect;
    public IntPtr RegionSize; public uint State; public uint Protect; public uint Type;
  }
  [DllImport("kernel32.dll")] public static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr addr, out MEMORY_BASIC_INFORMATION mbi, IntPtr len);
}
"@
Add-Type -TypeDefinition $sig
$pid2 = (Get-Process $ProcessName | Select-Object -First 1).Id
$PROCESS_QUERY_INFORMATION = 0x0400
$PROCESS_VM_READ = 0x0010
$h = [Mem]::OpenProcess(($PROCESS_QUERY_INFORMATION -bor $PROCESS_VM_READ), $false, $pid2)
if ($h -eq [IntPtr]::Zero) { "OpenProcess FAILED err=$([Runtime.InteropServices.Marshal]::GetLastWin32Error())"; exit 0 }
"OpenProcess OK for pid=$pid2"
$addr = [IntPtr]::Zero
$total = 0
$mbi = New-Object Mem+MEMORY_BASIC_INFORMATION
$regions = 0
while ([Mem]::VirtualQueryEx($h, $addr, [ref]$mbi, [IntPtr]::Size).ToInt64() -ne 0) {
  $regions++
  $size = $mbi.RegionSize.ToInt64()
  if ($size -le 0) { break }
  if ($mbi.State -eq 0x1000) { $total += $size }
  $addr = [IntPtr]::new($addr.ToInt64() + $size)
  if ($regions -gt 200000) { break }
}
"regions=$regions committedBytes=$([math]::Round($total/1MB,1))MB"
[Mem]::CloseHandle($h) | Out-Null