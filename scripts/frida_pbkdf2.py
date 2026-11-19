import frida, json, time, sys

DUR = int(sys.argv[1]) if len(sys.argv) > 1 else 30

HOOK = r"""
function findExport(modName, sym) {
  try {
    var m = Process.getModuleByName(modName);
    var a = m.getExportByName(sym);
    if (a) return a;
  } catch (e) {}
  try { if (Module.findGlobalExportByName) return Module.findGlobalExportByName(sym); } catch (e) {}
  try { if (Module.getGlobalExportByName) return Module.getGlobalExportByName(sym); } catch (e) {}
  return null;
}

var addr = findExport("bcrypt.dll", "BCryptDeriveKeyPBKDF2");
send({ stage: "lookup", found: addr ? addr.toString() : null });

if (addr) {
  Interceptor.attach(addr, {
    onEnter: function (args) {
      this.pwLen = args[2].toInt32();
      this.saltLen = args[4].toInt32();
      this.outLen = args[7].toInt32();
      this.pw = args[1]; this.salt = args[3]; this.out = args[6];
      this.iters = args[5].toUInt64();
    },
    onLeave: function (retval) {
      try {
        var iters = this.iters.toNumber();
        var salt = '';
        var s = new Uint8Array(this.salt.readByteArray(this.saltLen));
        for (var i = 0; i < s.length; i++) salt += ('0' + s[i].toString(16)).slice(-2);
        var key = '';
        var k = new Uint8Array(this.out.readByteArray(this.outLen));
        for (var i = 0; i < k.length; i++) key += ('0' + k[i].toString(16)).slice(-2);
        send({ call: true, iters: iters, saltHex: salt, keyHex: key, pwLen: this.pwLen, outLen: this.outLen });
      } catch (e) { send({ err: String(e) }); }
    }
  });
  send({ stage: "hooked" });
}
"""

def main():
    dev = frida.get_local_device()
    target = sorted([p for p in dev.enumerate_processes() if p.name.lower().startswith("weixin")], key=lambda p: p.pid)[0]
    print("pid", target.pid)
    session = dev.attach(target.pid)
    salts = {}
    def on_msg(m, d):
        if m["type"] == "send":
            p = m["payload"]
            if p.get("call"):
                salts[p["saltHex"]] = p
                print("PBKDF2 iters=%d salt=%s key=%s owLen=%d" % (p["iters"], p["saltHex"], p["keyHex"], p["outLen"]))
            else:
                print("info:", json.dumps(p))
        elif m["type"] == "error":
            print("ERR", m.get("description"), m.get("stack"))
    sc = session.create_script(HOOK)
    sc.on("message", on_msg)
    sc.load()
    time.sleep(DUR)
    print("unique salts:", len(salts))
    session.detach()

main()