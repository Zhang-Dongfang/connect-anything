param([string]$ProcessName='Weixin', [int]$MaxMB=8192)
$src = @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class K2 {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(int a, bool i, int p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, IntPtr s, out IntPtr r);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr a, out MBI m, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct MBI { public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect; public IntPtr RegionSize; public uint State; public uint Protect; public uint Type; }
  static bool Readable(uint p){ if((p&0x100)!=0) return false; if((p&0x01)!=0) return false; uint b=p&0xFF; return b==0x02||b==0x04||b==0x08||b==0x20||b==0x40||b==0x80; }
  static bool IsHex(byte b){ return (b>=48&&b<=57)||(b>=65&&b<=70)||(b>=97&&b<=102); }
  public static Dictionary<string,List<string>> Scan(int pid, int maxBytes, out long scanned){
    var hits = new Dictionary<string,List<string>>();
    scanned=0;
    IntPtr h=OpenProcess(0x0400|0x0010,false,pid);
    if(h==IntPtr.Zero) return hits;
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
              for(int i=0;i+8<=n;i++){
                // collect hex runs of length>=32
                if(IsHex(buf[i]) && !IsHex(buf[i-1+ (i>0?0:1)])){ }
                if(IsHex(buf[i])){
                  int j=i; while(j<n && IsHex(buf[j])) j++;
                  int len=j-i;
                  if(len>=32 && len<=256){
                    string key="hex"+len;
                    string sample=Encoding.ASCII.GetString(buf,i,Math.Min(len,16));
                    string full=Encoding.ASCII.GetString(buf,i,len);
                    bool dup=false;
                    if(hits.ContainsKey(key)) foreach(var s in hits[key]) if(s==full){dup=true;break;}
                    if(!dup){ if(!hits.ContainsKey(key)) hits[key]=new List<string>(); if(hits[key].Count<3) hits[key].Add(full); }
                  }
                  i=j-1;
                }
              }
              if(scanned>(long)maxBytes*1024*1024) return hits;
            }
            off+=chunk;
          }
        }
        addr=(IntPtr)(addr.ToInt64()+size);
      }
    } finally { CloseHandle(h); }
    return hits;
  }
}
"@
Add-Type -TypeDefinition $src
foreach ($proc in (Get-Process $ProcessName)) {
  if ($proc.MainModule) {}
  $scanned=[long]0
  $hits = [K2]::Scan($proc.Id, $MaxMB, [ref]$scanned)
  if ($hits.Count -gt 0) {
    "--- pid=$($proc.Id) scanned=$([math]::Round($scanned/1MB))MB ---"
    foreach ($k in ($hits.Keys | Sort-Object)) { "  $k : count=$($hits[$k].Count) ex=$($hits[$k][0].Substring(0,24))..." }
  }
}