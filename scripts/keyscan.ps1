param([Parameter(Mandatory=$true)][string]$ProcessName, [int]$MaxMB = 4096)
$src = @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;

public class KeyScan {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(int access, bool inherit, int pid);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, IntPtr size, out IntPtr read);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr addr, out MEMORY_BASIC_INFORMATION mbi, IntPtr len);

  [StructLayout(LayoutKind.Sequential)] public struct MEMORY_BASIC_INFORMATION {
    public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect;
    public IntPtr RegionSize; public uint State; public uint Protect; public uint Type;
  }

  static bool Readable(uint p) {
    if ((p & 0x100) != 0) return false; // PAGE_GUARD
    if ((p & 0x01) != 0) return false;  // PAGE_NOACCESS
    uint b = p & 0xFF;
    return b == 0x02 || b == 0x04 || b == 0x08 || b == 0x20 || b == 0x40 || b == 0x80;
  }
  static bool IsHex(byte b) { return (b >= 48 && b <= 57) || (b >= 65 && b <= 70) || (b >= 97 && b <= 102); }

  public static List<string> Scan(int pid, int maxBytes, out long scanned, out int regions) {
    var found = new List<string>();
    scanned = 0; regions = 0;
    IntPtr h = OpenProcess(0x0400 | 0x0010, false, pid);
    if (h == IntPtr.Zero) throw new Exception("OpenProcess failed: " + Marshal.GetLastWin32Error());
    try {
      IntPtr addr = IntPtr.Zero;
      MEMORY_BASIC_INFORMATION mbi;
      int mbiSize = Marshal.SizeOf(typeof(MEMORY_BASIC_INFORMATION));
      var buf = new byte[8 * 1024 * 1024];
      while (VirtualQueryEx(h, addr, out mbi, (IntPtr)mbiSize) != IntPtr.Zero) {
        regions++;
        long size = mbi.RegionSize.ToInt64();
        if (size <= 0) break;
        if (mbi.State == 0x1000 && Readable(mbi.Protect)) {
          long off = 0;
          while (off < size) {
            int chunk = (int)Math.Min(buf.Length, size - off);
            IntPtr got;
            if (ReadProcessMemory(h, (IntPtr)(addr.ToInt64() + off), buf, (IntPtr)chunk, out got)) {
              int n = got.ToInt32();
              scanned += n;
              // pattern: 'x' , 0x27 , 64 hex , 32 hex , 0x27
              for (int i = 0; i + 3 + 96 + 1 <= n; i++) {
                if (buf[i] == (byte)0x27 && buf[i+1] == (byte)0x78) { // 'x
                  int j = i + 2; int k = 0;
                  while (k < 96 && j < n && IsHex(buf[j])) { j++; k++; }
                  if (k == 96 && j < n && buf[j] == (byte)0x27) {
                    found.Add(Encoding.ASCII.GetString(buf, i + 2, 96));
                  }
                }
              }
              if (scanned > (long)maxBytes * 1024 * 1024) return found;
            }
            off += chunk;
          }
        }
        addr = (IntPtr)(addr.ToInt64() + size);
      }
    } finally { CloseHandle(h); }
    return found;
  }
}
"@
Add-Type -TypeDefinition $src
$p = Get-Process $ProcessName | Select-Object -First 1
"scanning pid=$($p.Id) $ProcessName (cap ${MaxMB}MB)"
$sw = [Diagnostics.Stopwatch]::StartNew()
$scanned = [long]0; $regions = 0
$res = [KeyScan]::Scan($p.Id, $MaxMB, [ref]$scanned, [ref]$regions)
"regions=$regions scanned=$([math]::Round($scanned/1MB))MB in $($sw.Elapsed.TotalSeconds.ToString('0.0'))s"
"candidates found: $($res.Count)"
$res | Select-Object -Unique | ForEach-Object { '  len=' + $_.Length + ' prefix=' + $_.Substring(0,8) + '...' }