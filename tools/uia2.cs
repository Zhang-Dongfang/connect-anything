using System;
using System.Text;
using System.Collections.Generic;
using System.Windows.Automation;

public class UiProbe {
  public static string Probe(int[] pids, int maxNodes) {
    var sb = new StringBuilder();
    AutomationElement root = AutomationElement.RootElement;
    AutomationElementCollection tops = root.FindAll(TreeScope.Children, Condition.TrueCondition);
    sb.AppendLine("top-level windows: " + tops.Count);
    foreach (AutomationElement w in tops) {
      int pid = 0;
      try { pid = w.Current.ProcessId; } catch { continue; }
      bool hit = false;
      foreach (int p in pids) { if (p == pid) { hit = true; break; } }
      if (!hit) continue;
      string wn = "", wc = "";
      try { wn = w.Current.Name; } catch {}
      try { wc = w.Current.ClassName; } catch {}
      sb.AppendLine("WINDOW pid=" + pid + " name='" + wn + "' class='" + wc + "'");
      int raw = 0, ctrl = 0, shown = 0;
      var stack = new Stack<KeyValuePair<AutomationElement,int>>();
      stack.Push(new KeyValuePair<AutomationElement,int>(w, 0));
      while (stack.Count > 0) {
        var t = stack.Pop();
        AutomationElement el = t.Key; int d = t.Value;
        raw++;
        bool isCtrl = false;
        try { isCtrl = el.Current.IsControlElement; } catch {}
        if (isCtrl) {
          ctrl++;
          if (shown < maxNodes) {
            shown++;
            string nm = "", cls = "", aid = "", ctn = "?";
            try { nm = el.Current.Name; } catch {}
            try { cls = el.Current.ClassName; } catch {}
            try { aid = el.Current.AutomationId; } catch {}
            try { ctn = el.Current.ControlType.ProgrammaticName.Replace("ControlType.", ""); } catch {}
            sb.AppendLine("  d" + d + " " + ctn + " name='" + nm + "' class='" + cls + "' auto='" + aid + "'");
          }
        }
        if (d >= 14) continue;
        try {
          AutomationElement ch = TreeWalker.RawViewWalker.GetFirstChild(el);
          while (ch != null) { stack.Push(new KeyValuePair<AutomationElement,int>(ch, d + 1)); ch = TreeWalker.RawViewWalker.GetNextSibling(ch); }
        } catch {}
      }
      sb.AppendLine("  rawNodes=" + raw + " controlNodes=" + ctrl);
    }
    return sb.ToString();
  }
}