using System.Runtime.InteropServices;
using System.Windows;

namespace DshPetOverlay;

/// <summary>Monitor work area in physical pixels; saved insets remain in DIPs.</summary>
internal sealed record DesktopMonitor(string Device, Rect WorkArea, double Scale)
{
    public static DesktopMonitor Locate(string? device, IntPtr window)
    {
        var selected = IntPtr.Zero;
        if (device is not null)
        {
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr monitor, IntPtr dc, ref NativeRect bounds, IntPtr data) =>
            {
                if (TryRead(monitor)?.Device != device) return true;
                selected = monitor;
                return false;
            }, IntPtr.Zero);
        }
        if (selected == IntPtr.Zero)
        {
            // Old placement files have only primary-monitor right/bottom insets.
            selected = device is null
                ? MonitorFromPoint(new NativePoint(), 1)
                : MonitorFromWindow(window, 2);
        }
        return Read(selected);
    }

    public static DesktopMonitor FromWindow(IntPtr window) => Read(MonitorFromWindow(window, 2));

    private static DesktopMonitor Read(IntPtr monitor)
    {
        var result = TryRead(monitor);
        if (result is not null) return result;
        App.Log("monitor unavailable; falling back to primary display");
        result = TryRead(MonitorFromPoint(new NativePoint(), 1));
        if (result is not null) return result;
        // Display topology can change between enumeration and querying. Keep
        // a usable placement until the next layout/DPI event can query again.
        App.Log("primary monitor unavailable; using primary screen metrics");
        return new DesktopMonitor(string.Empty,
            new Rect(0, 0, Math.Max(1, GetSystemMetrics(0)), Math.Max(1, GetSystemMetrics(1))), 1);
    }

    private static DesktopMonitor? TryRead(IntPtr monitor)
    {
        var info = new MonitorInfo { Size = Marshal.SizeOf<MonitorInfo>(), Device = string.Empty };
        if (!GetMonitorInfo(monitor, ref info)) return null;
        var dpiAvailable = GetDpiForMonitor(monitor, 0, out var dpiX, out _) == 0 && dpiX > 0;
        if (!dpiAvailable) App.Log("monitor DPI unavailable; using 100% scaling");
        var scale = dpiAvailable ? dpiX / 96.0 : 1;
        var work = info.Work;
        if (work.Right <= work.Left || work.Bottom <= work.Top) return null;
        return new DesktopMonitor(info.Device, new Rect(work.Left, work.Top, work.Right - work.Left, work.Bottom - work.Top), scale);
    }

    public Point WindowPosition(Size size, double spriteWidth, double panelExtra, double right, double bottom)
    {
        var width = size.Width * Scale;
        var height = size.Height * Scale;
        var center = WorkArea.Right - right * Scale - spriteWidth * Scale / 2;
        var left = Math.Max(WorkArea.Left, Math.Min(center - width / 2, WorkArea.Right - width));
        var top = WorkArea.Bottom - height - bottom * Scale + panelExtra * Scale;
        return new Point(left, Math.Max(WorkArea.Top, Math.Min(top, WorkArea.Bottom - height)));
    }

    public static Rect WindowBounds(IntPtr window)
    {
        if (!GetWindowRect(window, out var bounds)) throw new InvalidOperationException("Cannot read window bounds.");
        return new Rect(bounds.Left, bounds.Top, bounds.Right - bounds.Left, bounds.Bottom - bounds.Top);
    }

    public static void MoveWindow(IntPtr window, Point position)
    {
        // Use physical pixels across mixed-DPI monitors; WPF handles WM_DPICHANGED.
        SetWindowPos(window, IntPtr.Zero, (int)Math.Round(position.X), (int)Math.Round(position.Y), 0, 0, 0x0001 | 0x0004 | 0x0010);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint { public int X; public int Y; }
    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect { public int Left; public int Top; public int Right; public int Bottom; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct MonitorInfo
    {
        public int Size;
        public NativeRect Monitor;
        public NativeRect Work;
        public uint Flags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device;
    }
    private delegate bool MonitorCallback(IntPtr monitor, IntPtr dc, ref NativeRect bounds, IntPtr data);
    [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(IntPtr dc, IntPtr clip, MonitorCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(NativePoint point, uint flags);
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
    [DllImport("shcore.dll")] private static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr window, out NativeRect bounds);
    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int index);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
}
