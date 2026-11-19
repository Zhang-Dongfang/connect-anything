param([string]$ProcessName='Weixin', [int]$MaxMB=8192, [int]$Context=192)
$src = @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class K4 {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(int a, bool i, int p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, IntPtr s, out IntPtr r);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr a, out MBI m, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct MBI { public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect; public IntPtr RegionSize; public uint State; public uint Protect; public uint Type; }
  static bool Readable(uint p){ if((p&0x100)!=0) return false; if((p&0x01)!=0) return false; uint b=p&0xFF; return b==0x02||b==0x04||b==0x08||b==0x20||b==0x40||b==0x80; }
  public static List<string> Contexts(int pid, string saltHex, int ctx, out long scanned){
    var outp=new List<string>(); scanned=0;
    string lo=saltHex.ToLowerInvariant();
    IntPtr h=OpenProcess(0x0400|0x0010,false,pid); if(h==IntPtr.Zero) return outp;
    try{
      IntPtr addr=IntPtr.Zero; MBI m; int ms=Marshal.SizeOf(typeof(MBI)); var buf=new byte[8*1024*1024];
      while(VirtualQueryEx(h,addr,out m,(IntPtr)ms)!=IntPtr.Zero){
        long size=m.RegionSize.ToInt64(); if(size<=0) break;
        if(m.State==0x1000 && Readable(m.Protect)){
          long off=0;
          while(off<size){
            int chunk=(int)Math.Min(buf.Length,size-off); IntPtr got;
            if(ReadProcessMemory(h,(IntPtr)(addr.ToInt64()+off),buf,(IntPtr)chunk,out got)){
              int n=got.ToInt32(); scanned+=n;
              for(int i=0;i+32<=n;i++){
                bool ok=true;
                for(int k=0;k<32;k++){ if(buf[i+k]!=(byte)lo[k]){ok=false;break;} }
                if(ok){
                  int from=Math.Max(0,i-ctx); int to=Math.Min(n,i+32+ctx);
                  var sb=new StringBuilder();
                  sb.Append("addr=" + (addr.ToInt64()+off+i).ToString("X") + "\n");
                  sb.Append("  ascii: " + Encoding.ASCII.GetString(buf,from,to-from).Replace("\r",".").Replace("\n",".") + "\n");
                  var hx=new StringBuilder();
                  for(int j=from;j<to;j++){ hx.Append(buf[j].ToString("x2")); if((j-from+1)%96==0) hx.Append("\n         "); else hx.Append(' '); }
                  sb.Append("  hex  : " + hx.ToString());
                  outp.Add(sb.ToString());
                  if(outp.Count>=6) return outp;
                }
              }
            }
            off+=chunk;
          }
        }
        addr=(IntPtr)(addr.ToInt64()+size);
      }
    } finally { CloseHandle(h); }
    return outp;
  }
}
"@
Add-Type -TypeDefinition $src
$target='790410686c210164844740ce71be91b5'
$scanned=[long]0
$res=[K4]::Contexts((Get-Process $ProcessName | Select-Object -First 1).Id, $target, $Context, [ref]$scanned)
"contact.db salt occurrences with context: $($res.Count) (scanned $([math]::Round($scanned/1MB))MB)"
$res | ForEach-Object { $_ }