param([string]$ProcessName='Weixin', [int]$MaxMB=2048, [int]$Context=160)
$acc='C:\Users\windo\xwechat_files\wxid_om5elt4emlbs22_a6a3\db_storage'
$salts = @()
Get-ChildItem $acc -Recurse -File -Include *.db -ErrorAction SilentlyContinue | Select-Object -First 12 | ForEach-Object {
  try { $fs=[IO.File]::Open($_.FullName,'Open','Read','ReadWrite'); $b=New-Object byte[] 16; [void]$fs.Read($b,0,16); $fs.Close()
    $salts += [pscustomobject]@{ db=$_.Name; salt=(($b | ForEach-Object { $_.ToString('x2') }) -join '') } } catch {}
}
$saltList = @($salts | ForEach-Object { $_.salt })
"salts: $($saltList.Count)"
$src = @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class K7 {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(int a, bool i, int p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, IntPtr s, out IntPtr r);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr a, out MBI m, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct MBI { public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect; public IntPtr RegionSize; public uint State; public uint Protect; public uint Type; }
  static bool Readable(uint p){ if((p&0x100)!=0) return false; if((p&0x01)!=0) return false; uint b=p&0xFF; return b==0x02||b==0x04||b==0x08||b==0x20||b==0x40||b==0x80; }
  static byte Lower(byte b){ return (b>=65 && b<=90) ? (byte)(b+32) : b; }
  public static string Run(int pid, string[] saltHex, int ctx, long maxBytes){
    var sb=new StringBuilder(); var counts=new int[saltHex.Length]; var ctxDone=new bool[saltHex.Length];
    byte[][] pats=new byte[saltHex.Length][];
    for(int s=0;s<saltHex.Length;s++){ pats[s]=Encoding.ASCII.GetBytes(saltHex[s].ToLowerInvariant()); }
    long scanned=0; int regions=0;
    IntPtr h=OpenProcess(0x0400|0x0010,false,pid);
    if(h==IntPtr.Zero) return "OpenProcess failed: "+Marshal.GetLastWin32Error();
    try{
      IntPtr addr=IntPtr.Zero; MBI m; int ms=Marshal.SizeOf(typeof(MBI)); var buf=new byte[8*1024*1024];
      while(VirtualQueryEx(h,addr,out m,(IntPtr)ms)!=IntPtr.Zero){
        long size=m.RegionSize.ToInt64(); if(size<=0) break; regions++;
        if(m.State==0x1000 && Readable(m.Protect) && (m.Protect & 0xCC)!=0){
          long off=0;
          while(off<size){
            int chunk=(int)Math.Min(buf.Length,size-off); IntPtr got;
            if(ReadProcessMemory(h,(IntPtr)(addr.ToInt64()+off),buf,(IntPtr)chunk,out got)){
              int n=got.ToInt32(); scanned+=n;
              for(int i=0;i+32<=n;i++){
                byte c=Lower(buf[i]);
                for(int s=0;s<pats.Length;s++){
                  if(pats[s][0]!=c) continue;
                  bool ok=true;
                  for(int k=1;k<32;k++){ if(Lower(buf[i+k])!=pats[s][k]){ok=false;break;} }
                  if(!ok) continue;
                  counts[s]++;
                  if(!ctxDone[s]){
                    ctxDone[s]=true;
                    int from=Math.Max(0,i-ctx); int to=Math.Min(n,i+32+ctx);
                    sb.Append("--- salt["+s+"] at 0x"+(addr.ToInt64()+off+i).ToString("X")+"\n");
                    sb.Append("  ascii: "+Encoding.ASCII.GetString(buf,from,to-from).Replace("\r",".").Replace("\n",".")+"\n");
                  }
                }
              }
              if(scanned>maxBytes) {
                var summ="scanned="+scanned+" regions="+regions+"\n";
                for(int s=0;s<counts.Length;s++) summ+="  salt["+s+"]="+counts[s]+" ctx="+ctxDone[s]+"\n";
                return summ+sb.ToString();
              }
            }
            off+=chunk;
          }
        }
        addr=(IntPtr)(addr.ToInt64()+size);
      }
    } finally { CloseHandle(h); }
    var s2="scanned="+scanned+" regions="+regions+"\n";
    for(int s=0;s<counts.Length;s++) s2+="  salt["+s+"]="+counts[s]+" ctx="+ctxDone[s]+"\n";
    return s2+sb.ToString();
  }
}
"@
Add-Type -TypeDefinition $src
$pid2 = (Get-Process $ProcessName | Select-Object -First 1).Id
$sw=[Diagnostics.Stopwatch]::StartNew()
$r = [K7]::Run($pid2, [string[]]$saltList, $Context, ([long]$MaxMB*1024*1024))
"elapsed $($sw.Elapsed.TotalSeconds.ToString('0.0'))s"
for ($i=0; $i -lt $salts.Count; $i++) { '  [' + $i + '] ' + $salts[$i].db }
$r