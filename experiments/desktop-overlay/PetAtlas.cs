using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace DshPetOverlay;

/// <summary>One decoded sprite2d atlas plus a cache of its cropped cells.</summary>
internal sealed class PetAtlas
{
    private readonly BitmapSource _atlas;
    private readonly Dictionary<(int Row, int Column), BitmapSource> _cells = new();

    private PetAtlas(BitmapSource atlas, double cellWidth, double cellHeight)
    {
        _atlas = atlas;
        CellWidth = cellWidth;
        CellHeight = cellHeight;
    }

    public double CellWidth { get; }
    public double CellHeight { get; }

    /// <summary>Decode an atlas payload (PNG/WebP/JPEG) into a frozen bitmap.</summary>
    public static PetAtlas Load(byte[] bytes, double cellWidth, double cellHeight)
    {
        var image = LibWebP.IsWebP(bytes) ? LibWebP.Decode(bytes) : null;
        if (image is null)
        {
            using var stream = new MemoryStream(bytes);
            var bitmap = new BitmapImage();
            bitmap.BeginInit();
            bitmap.CacheOption = BitmapCacheOption.OnLoad;
            bitmap.CreateOptions = BitmapCreateOptions.IgnoreColorProfile;
            bitmap.StreamSource = stream;
            bitmap.EndInit();
            bitmap.Freeze();
            image = bitmap;
        }
        if (cellWidth <= 0) cellWidth = image.PixelWidth;
        if (cellHeight <= 0) cellHeight = image.PixelHeight;
        return new PetAtlas(image, cellWidth, cellHeight);
    }

    /// <summary>One frame cell, cropped once and cached.</summary>
    public BitmapSource Cell(int row, int column)
    {
        var key = (row, column);
        if (_cells.TryGetValue(key, out var cached)) return cached;
        var x = (int)Math.Round(column * CellWidth);
        var y = (int)Math.Round(row * CellHeight);
        var width = (int)Math.Round(CellWidth);
        var height = (int)Math.Round(CellHeight);
        if (x < 0 || y < 0 || x + width > _atlas.PixelWidth || y + height > _atlas.PixelHeight)
        {
            cached = _atlas;
        }
        else
        {
            cached = new CroppedBitmap(_atlas, new System.Windows.Int32Rect(x, y, width, height));
            cached.Freeze();
        }
        _cells[key] = cached;
        return cached;
    }

    public BitmapSource Whole => _atlas;
}
