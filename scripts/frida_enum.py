import frida, json, time

SCRIPT = r"""
var mods = Process.enumerateModules();
var sqliteMods = [];
for (var i = 0; i < mods.length; i++) {
  var n = mods[i].name.toLowerCase();
  if (n.indexOf("sqlite") >= 0 || n.indexOf("wcdb") >= 0 || n.indexOf("sqlcipher") >= 0) sqliteMods.push(mods[i].name);
}
send({ moduleCount: mods.length, sqliteMods: sqliteMods });
var hits = [];
for (var i = 0; i < mods.length; i++) {
  var m = mods[i];
  var exps;
  try { exps = m.enumerateExports(); } catch (e) { continue; }
  for (var j = 0; j < exps.length; j++) {
    var l = exps[j].name.toLowerCase();
    if (l.indexOf("sqlite3_key") === 0 || l.indexOf("sqlite3_codec") === 0 || l.indexOf("sqlcipher") >= 0 || l.indexOf("pbkdf2") >= 0 || l.indexOf("codec_ctx") >= 0) {
      hits.push(m.name + "!" + exps[j].name);
      if (hits.length > 60) break;
    }
  }
}
send({ exports: hits });
"""

def main():
    dev = frida.get_local_device()
    procs = sorted([p for p in dev.enumerate_processes() if p.name.lower().startswith("weixin")], key=lambda p: p.pid)
    print("procs", [(p.pid, p.name) for p in procs])
    if not procs:
        return
    session = dev.attach(procs[0].pid)
    out = {}
    def on_msg(m, d):
        if m["type"] == "send":
            out.update(m["payload"])
        elif m["type"] == "error":
            print("SCRIPT ERROR", m.get("description"))
    sc = session.create_script(SCRIPT)
    sc.on("message", on_msg)
    sc.load()
    time.sleep(1.5)
    print(json.dumps(out, indent=1)[:8000])
    session.detach()

main()