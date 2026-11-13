using System.Runtime.InteropServices;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace DshPetOverlay;

/// <summary>
/// Minimal WebP decode through the bundled libwebp decoder. WPF's Windows WebP
/// codec composes the atlas to Bgr32 and drops the alpha channel, so a
/// transparent pet turned into a black rectangle. libwebp returns straight BGRA
/// and keeps the alpha, which is what the overlay needs.
/// </summary>
internal static class LibWebP
{
    private const string Library = "libwebpdecoder.dll";

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr WebPDecodeBGRA(byte[] data, UIntPtr dataSize, out int width, out int height);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern void WebPFree(IntPtr pointer);

    [DllImport(Library, CallingConvention = CallingConvention.Cdecl)]
    private static extern int WebPGetDecoderVersion();

    /// <summary>True for a RIFF/WEBP payload.</summary>
    public static bool IsWebP(byte[] data)
        => data.Length >= 12
           && data[0] == (byte)'R' && data[1] == (byte)'I' && data[2] == (byte)'F' && data[3] == (byte)'F'
           && data[8] == (byte)'W' && data[9] == (byte)'E' && data[10] == (byte)'B' && data[11] == (byte)'P';

    /// <summary>Decode one WebP image to a frozen BGRA32 bitmap, or null.</summary>
    public static BitmapSource? Decode(byte[] data)
    {
        var pointer = IntPtr.Zero;
        try
        {
            pointer = WebPDecodeBGRA(data, (UIntPtr)data.Length, out var width, out var height);
            if (pointer == IntPtr.Zero || width <= 0 || height <= 0) return null;
            var stride = width * 4;
            var pixels = new byte[stride * height];
            Marshal.Copy(pointer, pixels, 0, pixels.Length);
            var bitmap = BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgra32, null, pixels, stride);
            bitmap.Freeze();
            return bitmap;
        }
        catch
        {
            return null;
        }
        finally
        {
            if (pointer != IntPtr.Zero) WebPFree(pointer);
        }
    }

    /// <summary>The linked decoder's version, for the startup log.</summary>
    public static int Version()
    {
        try { return WebPGetDecoderVersion(); }
        catch { return 0; }
    }
}
