using System;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

public class CxaAcc {
  [DllImport("oleacc.dll")] public static extern int AccessibleObjectFromWindow(IntPtr h, uint id, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object ppv);
  [DllImport("user32.dll")] public static extern IntPtr FindWindowEx(IntPtr p, IntPtr c, string cls, string name);
  [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int m);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);

  static object Acc(IntPtr h) {
    Guid g = new Guid("618736E0-3C3D-11CF-810C-00AA00389B71");
    object o;
    int hr = AccessibleObjectFromWindow(h, 0xFFFFFFFC, ref g, out o);
    return hr == 0 ? o : null;
  }

  static object Prop(object o, string name) {
    if (o == null) return null;
    try { return o.GetType().InvokeMember(name, BindingFlags.GetProperty, null, o, null); } catch { return null; }
  }

  public static int ChildCount(IntPtr h) {
    object v = Prop(Acc(h), "accChildCount");
    return v == null ? -1 : Convert.ToInt32(v);
  }

  public static string ChildName(IntPtr h, int i) {
    object o = Acc(h); if (o == null) return null;
    try { return (string)o.GetType().InvokeMember("accName", BindingFlags.GetProperty, null, o, new object[] { i }); } catch { return null; }
  }

  public static string ChildRole(IntPtr h, int i) {
    object o = Acc(h); if (o == null) return null;
    try { return Convert.ToString(o.GetType().InvokeMember("accRole", BindingFlags.GetProperty, null, o, new object[] { i })); } catch { return null; }
  }

  public static string ChildClasses(IntPtr h) {
    var sb = new StringBuilder();
    IntPtr c = FindWindowEx(h, IntPtr.Zero, null, null);
    for (int i = 0; i < 30 && c != IntPtr.Zero; i++) {
      var n = new StringBuilder(256); GetClassName(c, n, 256);
      sb.Append(n.ToString()).Append((char)59);
      c = FindWindowEx(h, c, null, null);
    }
    return sb.ToString();
  }
}