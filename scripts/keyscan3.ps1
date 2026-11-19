param([string]$ProcessName='Weixin', [int]$MaxMB=8192)
$acc='C:\Users\windo\xwechat_files\wxid_om5elt4emlbs22_a6a3\db_storage'

# SQLCipher stores the per-database salt as the first 16 bytes of the db file.
$salts = @()
Get-ChildItem $acc -Recurse -File -Include *.db -ErrorAction SilentlyContinue | Select-Object -First 12 | ForEach-Object {
  try {
    $fs=[IO.File]::Open($_.FullName,'Open','Read','ReadWrite'); $b=New-Object byte[] 16; [void]$fs.Read($b,0,16); $fs.Close()
    $hex=($b | ForEach-Object { $_.ToString('x2') }) -join ''
    $salts += [pscustomobject]@{ name=$_.Name; saltHex=$hex }
  } catch {}
}
"=== db salts (first 16 bytes = SQLCipher salt) ==="
$salts | ForEach-Object { '  {0,-24} {1}' -f $_.name, $_.saltHex }

$src = @"
using System; using System.Text; using System.Collections.Generic; using System.Runtime.InteropServices;
public class K3 {
  [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(int a, bool i, int p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool ReadProcessMemory(IntPtr h, IntPtr a, byte[] b, IntPtr s, out IntPtr r);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")] static extern IntPtr VirtualQueryEx(IntPtr h, IntPtr a, out MBI m, IntPtr l);
  [StructLayout(LayoutKind.Sequential)] public struct MBI { public IntPtr BaseAddress; public IntPtr AllocationBase; public uint AllocationProtect; public IntPtr RegionSize; public uint State; public uint Protect; public uint Type; }
  static bool Readable(uint p){ if((p&0x100)!=0) return false; if((p&0x01)!=0) return false; uint b=p&0xFF; return b==0x02||b==0x04||b==0x08||b==0x20||b==0x40||b==0x80; }
  public static Dictionary<string,int> FindSalts(int pid, string[] saltHexes, string[] saltRaw, out long scanned){
    var hits=new Dictionary<string,int>(); scanned=0;
    IntPtr h=OpenProcess(0x0400|0x0010,false,pid); if(h==IntPtr.Zero) return hits;
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
              // ASCII lowercase and uppercase salt hex
              for(int s=0;s<saltHexes.Length;s++){
                string lo=saltHexes[s]; string up=lo.ToUpperInvariant();
                string key="ascii_lower"; if(!hits.ContainsKey(key)) hits[key]=0;
                // naive search
                for(int i=0;i+32<=n;i++){
                  if(buf[i]==(byte)lo[0]){
                    bool ok=true;
                    for(int k=1;k<32;k++){ if(buf[i+k]!=(byte)lo[k]){ok=false;break;} }
                    if(ok) hits[key]++;
                  }
                  if(buf[i]==(byte)up[0]){
                    bool ok=true;
                    for(int k=1;k<32;k++){ if(buf[i+k]!=(byte)up[k]){ok=false;break;} }
                    if(ok) hits[key]++;
                  }
                }
              }
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
$hexes = @($salts | ForEach-Object { $_.saltHex } | Select-Object -Unique)
$hexes = @($hexes | Where-Object { $_ -match '^[0-9a-f]{32}$' })
"searching memory for $($hexes.Count) distinct salt strings (ascii hex, 32 chars)"
$scanned=[long]0
$hits=[K3]::FindSalts((Get-Process $ProcessName | Select-Object -First 1).Id, $hexes, @(), [ref]$scanned)
"scanned=$([math]::Round($scanned/1MB))MB"
foreach($k in $hits.Keys){ "  $k = $($hits[$k]) occurrences" }