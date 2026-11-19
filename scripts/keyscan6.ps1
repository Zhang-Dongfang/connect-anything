param([Parameter(Mandatory=$true)][string]$Salt, [string]$ProcessName='Weixin', [int]$Context=200)
$src = @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class K6 {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(int a, bool i, int p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, IntPtr s, out IntPtr r);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr a, out MBI m, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct MBI { public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect; public IntPtr RegionSize; public uint State; public uint Protect; public uint Type; }
  static bool Readable(uint p){ if((p&0x100)!=0) return false; if((p&0x01)!=0) return false; uint b=p&0xFF; return b==0x02||b==0x04||b==0x08||b==0x20||b==0x40||b==0x80; }
  static byte Lower(byte b){ return (b>=65 && b<=90) ? (byte)(b+32) : b; }
  public static string Run(int pid, string saltHex, int ctx){
    var sb=new StringBuilder(); int found=0; string lo=saltHex.ToLowerInvariant();
    IntPtr h=OpenProcess(0x0400|0x0010,false,pid);
    if(h==IntPtr.Zero){ return "OpenProcess failed"; }
    try{
      IntPtr addr=IntPtr.Zero; MBI m; int ms=Marshal.SizeOf(typeof(MBI)); var buf=new byte[8*1024*1024];
      while(VirtualQueryEx(h,addr,out m,(IntPtr)ms)!=IntPtr.Zero){
        long size=m.RegionSize.ToInt64(); if(size<=0) break;
        if(m.State==0x1000 && Readable(m.Protect)){
          long off=0;
          while(off<size){
            int chunk=(int)Math.Min(buf.Length,size-off); IntPtr got;
            if(ReadProcessMemory(h,(IntPtr)(addr.ToInt64()+off),buf,(IntPtr)chunk,out got)){
              int n=got.ToInt32();
              for(int i=0;i+32<=n;i++){
                if(Lower(buf[i])!=(byte)lo[0]) continue;
                bool ok=true;
                for(int k=1;k<32;k++){ if(Lower(buf[i+k])!=(byte)lo[k]){ok=false;break;} }
                if(!ok) continue;
                found++;
                int from=Math.Max(0,i-ctx); int to=Math.Min(n,i+32+ctx);
                sb.Append("  at 0x" + (addr.ToInt64()+off+i).ToString("X") + "\n");
                sb.Append("  ascii: " + Encoding.ASCII.GetString(buf,from,to-from).Replace("\r",".").Replace("\n",".") + "\n");
                if(found>=3) return "count=" + found + " (capped)\n" + sb.ToString();
              }
            }
            off+=chunk;
          }
        }
        addr=(IntPtr)(addr.ToInt64()+size);
      }
    } finally { CloseHandle(h); }
    return "count=" + found + "\n" + sb.ToString();
  }
}
"@
Add-Type -TypeDefinition $src
$pid2 = (Get-Process $ProcessName | Select-Object -First 1).Id
$acc='C:\Users\windo\xwechat_files\wxid_om5elt4emlbs22_a6a3\db_storage'
$res = @()
Get-ChildItem $acc -Recurse -File -Include *.db -ErrorAction SilentlyContinue | Select-Object -First 12 | ForEach-Object {
  try {
    $fs=[IO.File]::Open($_.FullName,'Open','Read','ReadWrite'); $b=New-Object byte[] 16; [void]$fs.Read($b,0,16); $fs.Close()
    $salt=($b | ForEach-Object { $_.ToString('x2') }) -join ''
    $r=[K6]::Run($pid2, $salt, $Context)
    $res += [pscustomobject]@{ db=$_.Name; salt=$salt; result=$r }
  } catch {}
}
foreach ($x in $res) { "=== " + $x.db + " salt=" + $x.salt; $x.result }