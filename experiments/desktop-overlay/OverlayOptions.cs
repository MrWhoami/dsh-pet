using System.Globalization;

namespace DshPetOverlay;

/// <summary>Command-line options for one overlay process.</summary>
internal sealed class OverlayOptions
{
    /// <summary>Base URL of the running dsh web host (loopback).</summary>
    public string BaseUrl { get; private set; } = "http://127.0.0.1:59712";

    /// <summary>Optional pet id override; the host's selected pet wins by default.</summary>
    public string? PetId { get; private set; }

    /// <summary>Optional sprite height override in device-independent px.</summary>
    public double? Size { get; private set; }

    /// <summary>Horizontal inset from the work-area right edge.</summary>
    public double Right { get; private set; } = 48;

    /// <summary>Vertical inset from the work-area bottom edge.</summary>
    public double Bottom { get; private set; } = 96;

    /// <summary>True when --right was given; the saved placement otherwise wins.</summary>
    public bool RightSpecified { get; private set; }

    /// <summary>True when --bottom was given; the saved placement otherwise wins.</summary>
    public bool BottomSpecified { get; private set; }

    /// <summary>Optional local atlas file (demo fallback when the WebP alpha is not decodable).</summary>
    public string? AtlasFile { get; private set; }

    /// <summary>Host pid; the overlay exits when that process is gone.</summary>
    public int? ParentPid { get; private set; }

    /// <summary>Protocol advertised by the Host; >= 2 means the ready route must exist.</summary>
    public int HostProtocol { get; private set; }

    /// <summary>Debug: pin the hover panel open after startup (screenshot/test only).</summary>
    public bool ShowPanel { get; private set; }

    /// <summary>Debug: append one fabricated session bubble for a stack screenshot.</summary>
    public bool FakeSession { get; private set; }

    /// <summary>Debug: start with the session stack expanded.</summary>
    public bool ExpandSessions { get; private set; }

    /// <summary>Debug: render the window to this PNG after startup, then keep running.</summary>
    public string? SnapshotPath { get; private set; }

    /// <summary>Debug: override the first bubble's title for a screenshot.</summary>
    public string? DemoTitle { get; private set; }

    /// <summary>Parse "--base URL --host-protocol N --pet ID --size N --right N --bottom N --atlas PATH --parent-pid PID --show-panel --fake-session --expand-sessions --snapshot PATH --demo-title TEXT".</summary>
    public static OverlayOptions Parse(string[] args)
    {
        var options = new OverlayOptions();
        for (var i = 0; i < args.Length; i++)
        {
            var arg = args[i];
            string? Next() => i + 1 < args.Length ? args[++i] : null;
            switch (arg)
            {
                case "--base":
                    options.BaseUrl = (Next() ?? options.BaseUrl).TrimEnd('/');
                    break;
                case "--pet":
                    options.PetId = Next();
                    break;
                case "--atlas":
                    options.AtlasFile = Next();
                    break;
                case "--parent-pid" when int.TryParse(Next(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var parent):
                    options.ParentPid = parent;
                    break;
                case "--host-protocol" when int.TryParse(Next(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var hostProtocol):
                    options.HostProtocol = hostProtocol;
                    break;
                case "--show-panel":
                    options.ShowPanel = true;
                    break;
                case "--fake-session":
                    options.FakeSession = true;
                    break;
                case "--expand-sessions":
                    options.ExpandSessions = true;
                    break;
                case "--snapshot":
                    options.SnapshotPath = Next();
                    break;
                case "--demo-title":
                    options.DemoTitle = Next();
                    break;
                case "--size" when double.TryParse(Next(), NumberStyles.Float, CultureInfo.InvariantCulture, out var size):
                    options.Size = size;
                    break;
                case "--right" when double.TryParse(Next(), NumberStyles.Float, CultureInfo.InvariantCulture, out var right):
                    options.Right = right;
                    options.RightSpecified = true;
                    break;
                case "--bottom" when double.TryParse(Next(), NumberStyles.Float, CultureInfo.InvariantCulture, out var bottom):
                    options.Bottom = bottom;
                    options.BottomSpecified = true;
                    break;
            }
        }
        return options;
    }
}
