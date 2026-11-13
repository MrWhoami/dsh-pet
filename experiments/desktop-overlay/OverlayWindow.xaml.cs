using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;

namespace DshPetOverlay;

/// <summary>
/// A frameless, per-pixel-transparent, always-on-top window that renders the
/// selected dsh-pet sprite and polls the same /api/pet/* routes the in-page
/// pet uses. It is independent of the DSH BrowserWindow: minimizing the app
/// does not hide it.
/// </summary>
public partial class OverlayWindow : Window
{
    private static readonly string[] RowOrder =
    {
        "idle", "running-right", "running-left", "waving", "jumping",
        "failed", "waiting", "running", "review",
    };

    private readonly OverlayOptions _options;
    private readonly PetApi _api;
    private readonly DispatcherTimer _pollTimer = new() { Interval = TimeSpan.FromSeconds(2) };
    private readonly DispatcherTimer _frameTimer = new();
    private readonly DispatcherTimer _bubbleTimer = new();
    private readonly DispatcherTimer _hoverShowTimer = new();
    private readonly DispatcherTimer _hoverHideTimer = new();

    private PetStateDto? _state;
    private PetDefDto? _definition;
    private PetAtlas? _atlas;
    private string? _loadedPetId;
    private string? _loadedAtlasUrl;
    private string? _animation;
    private PetTrackDto? _track;
    private int _frameIndex;
    private string? _sessionSignature;
    private bool _sessionsExpanded;

    private double _insetRight;
    private double _insetBottom;
    private string? _monitorDevice;
    private bool _placed;
    private bool _placing;
    private bool _moving;
    private bool _refreshing;
    private bool _loaded;
    private bool _closed;
    private CancellationTokenSource? _startupCancellation;
    private bool _dragged;
    private bool _pressedOnSprite;
    private Point _downPoint;

    internal OverlayWindow(OverlayOptions options)
    {
        _options = options;
        _api = new PetApi(options.BaseUrl);
        _insetRight = options.Right;
        _insetBottom = options.Bottom;
        var placement = LoadPlacement();
        if (placement is { } saved)
        {
            if (!options.RightSpecified) _insetRight = saved.Right;
            if (!options.BottomSpecified) _insetBottom = saved.Bottom;
            _monitorDevice = saved.Monitor;
        }
        InitializeComponent();
        _pollTimer.Tick += OnPollTick;
        _frameTimer.Tick += OnFrameTick;
        _bubbleTimer.Tick += OnBubbleTick;
        _bubbleTimer.Interval = TimeSpan.FromSeconds(6);
        _hoverShowTimer.Interval = TimeSpan.FromMilliseconds(220);
        _hoverShowTimer.Tick += (_, _) =>
        {
            _hoverShowTimer.Stop();
            ShowHoverPanel();
        };
        _hoverHideTimer.Interval = TimeSpan.FromMilliseconds(450);
        _hoverHideTimer.Tick += (_, _) =>
        {
            _hoverHideTimer.Stop();
            HideHoverPanel();
        };
        SpriteHost.MouseRightButtonUp += OnSpriteRightButtonUp;
        SizeChanged += (_, _) => { if (_placed) PlaceWindow(); };
    }

    private static void Log(string message)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(Path.GetTempPath(), "dsh-pet-overlay.log"),
                $"{DateTime.Now:O} {message}{Environment.NewLine}");
        }
        catch
        {
            // Logging must never take the overlay down.
        }
    }

    private static bool IsProcessAlive(int pid)
    {
        try
        {
            using var process = System.Diagnostics.Process.GetProcessById(pid);
            return !process.HasExited;
        }
        catch
        {
            return false;
        }
    }

    private static string PlacementPath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "DshPetOverlay",
        "placement.json");

    private static (double Right, double Bottom, string? Monitor)? LoadPlacement()
    {
        try
        {
            if (!File.Exists(PlacementPath)) return null;
            return ParsePlacement(File.ReadAllText(PlacementPath));
        }
        catch
        {
            return null;
        }
    }

    private static (double Right, double Bottom, string? Monitor)? ParsePlacement(string json)
    {
        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;
        if (!root.TryGetProperty("right", out var right) || !root.TryGetProperty("bottom", out var bottom)) return null;
        return (right.GetDouble(), bottom.GetDouble(),
            root.TryGetProperty("monitor", out var monitor) && monitor.ValueKind == JsonValueKind.String ? monitor.GetString() : null);
    }

    private void SavePlacement()
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(PlacementPath)!);
            File.WriteAllText(PlacementPath, JsonSerializer.Serialize(new
            {
                right = Math.Round(_insetRight, 1),
                bottom = Math.Round(_insetBottom, 1),
                monitor = _monitorDevice,
            }));
        }
        catch
        {
            // Placement is best-effort; a locked profile must not break the pet.
        }
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        if (_loaded) return;
        _loaded = true;
        // Leave headroom under the Host's 15-second watchdog, including ready.
        using var startup = new CancellationTokenSource(TimeSpan.FromSeconds(10));
        _startupCancellation = startup;
        try
        {
            for (var attempt = 0; attempt < 3; attempt++)
            {
                using var request = CancellationTokenSource.CreateLinkedTokenSource(startup.Token);
                request.CancelAfter(TimeSpan.FromSeconds(3));
                try { await RefreshCoreAsync(initial: true, request.Token); }
                catch (Exception error) { Log("startup attempt failed: " + error.Message); }
                if (_closed || _atlas is not null) break;
                if (attempt < 2) await Task.Delay(200, startup.Token);
            }
            if (_closed) return;
            if (_atlas is null || _loadedPetId is null)
            {
                Log("not ready: no atlas");
                Fail(3);
                return;
            }
            _placed = true;
            PlaceWindow();
            // Hide the page pet only after the companion has decoded the first frame
            // and can display it. A 404 means the Host predates the ready route
            // (legacy Host hides the page pet on `running`) only when the Host
            // did not advertise protocol 2; if it did, the route is missing and
            // we must close instead of leaving two pets.
            if (_options.SnapshotPath is null)
            {
                var ready = await _api.MarkReadyAsync(startup.Token);
                if (ready == false || (ready is null && _options.HostProtocol >= 2))
                {
                    Log("ready signal failed");
                    Fail(3);
                    return;
                }
            }
            if (_closed) return;
            Opacity = 1;
            ApplyVisibility();
            if (_options.ShowPanel || _options.SnapshotPath is not null)
            {
                HoverPanel.Visibility = Visibility.Visible;
                PlaceWindow();
            }
            if (_options.SnapshotPath is { Length: > 0 } snapshot)
            {
                SaveSnapshot(snapshot);
                Close();
                return;
            }
            _pollTimer.Start();
            var webp = LibWebP.Version();
            Log($"ready base={_options.BaseUrl} pet={_loadedPetId} webp={webp >> 16}.{(webp >> 8) & 0xff}.{webp & 0xff} visible={IsVisible} opacity={Opacity}");
        }
        catch (Exception error)
        {
            Log("load failed: " + error);
            if (!_closed) Fail(3);
        }
        finally { _startupCancellation = null; }
    }

    private void Fail(int exitCode)
    {
        Environment.ExitCode = exitCode; // 2: unsupported pet; 3: loading failure.
        Close();
    }

    private void SaveSnapshot(string path)
    {
        try
        {
            UpdateLayout();
            var width = Math.Max(1, (int)Math.Ceiling(ActualWidth));
            var height = Math.Max(1, (int)Math.Ceiling(ActualHeight));
            var original = Root.Background;
            Root.Background = new SolidColorBrush(Color.FromRgb(184, 167, 143));
            var bitmap = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
            bitmap.Render(Root);
            Root.Background = original;
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(bitmap));
            var full = Path.GetFullPath(path);
            var directory = Path.GetDirectoryName(full);
            if (!string.IsNullOrEmpty(directory)) Directory.CreateDirectory(directory);
            using var stream = File.Create(full);
            encoder.Save(stream);
            Log($"snapshot {full} {width}x{height}");
        }
        catch (Exception error)
        {
            Log("snapshot failed: " + error);
        }
    }

    private void OnClosed(object? sender, EventArgs e)
    {
        _closed = true;
        _startupCancellation?.Cancel();
        _pollTimer.Stop();
        _frameTimer.Stop();
        _bubbleTimer.Stop();
        _hoverShowTimer.Stop();
        _hoverHideTimer.Stop();
        _api.Dispose();
    }

    private async void OnPollTick(object? sender, EventArgs e)
    {
        await RefreshAsync(initial: false);
    }

    /// <summary>Fetch the state and reconcile the sprite, animation and bubble.</summary>
    private Task RefreshAsync(bool initial) => RefreshCoreAsync(initial, CancellationToken.None);

    private async Task RefreshCoreAsync(bool initial, CancellationToken cancellationToken)
    {
        if (_closed) return;
        if (_options.ParentPid is int parentPid && !IsProcessAlive(parentPid))
        {
            Log("parent process is gone; closing");
            Close();
            return;
        }
        if (_refreshing) return;
        _refreshing = true;
        try
        {
            var state = await _api.GetStateAsync(cancellationToken);
            if (state is null || _closed) return;
            _state = state;

            var petId = _options.PetId ?? state.Pet?.Id ?? _loadedPetId;
            if (petId is null) return;

            var petChanged = petId != _loadedPetId || _atlas is null;
            if (petChanged)
            {
                var definition = await LoadDefinitionAsync(petId, cancellationToken);
                if (_closed) return;
                if (definition?.Renderer == "live2d" || definition?.Gameplay is { ValueKind: JsonValueKind.Object })
                {
                    Log($"unsupported pet {petId}: Live2D or gameplay requires the page renderer");
                    Fail(2);
                    return;
                }
                if (definition?.AtlasUrl is null) throw new InvalidOperationException("Pet definition or atlas URL unavailable.");
                var bytes = _options.AtlasFile is { Length: > 0 } atlasFile && File.Exists(atlasFile)
                    ? await File.ReadAllBytesAsync(atlasFile, cancellationToken)
                    : await _api.GetBytesAsync(definition.AtlasUrl, cancellationToken);
                if (_closed) return;
                if (bytes is null)
                {
                    throw new InvalidOperationException($"Atlas fetch failed: {definition.AtlasUrl}");
                }
                var cell = definition.Cell;
                _atlas = definition.Renderer == "frames2d"
                    ? PetAtlas.Load(bytes, 0, 0)
                    : PetAtlas.Load(bytes, cell?.Width ?? 0, cell?.Height ?? 0);
                _definition = definition;
                _loadedPetId = petId;
                _loadedAtlasUrl = definition.AtlasUrl;
                ApplySpriteSize();
                Log($"atlas loaded pet={petId} {_atlas.Whole.PixelWidth}x{_atlas.Whole.PixelHeight} renderer={definition.Renderer}");
            }

            ApplySpriteSize();

            var animation = string.IsNullOrEmpty(state.Animation) ? "idle" : state.Animation;
            if (!string.Equals(animation, _animation, StringComparison.Ordinal) || initial || petChanged)
            {
                StartTrack(animation);
            }

            UpdateSessionBubbles(state);
            UpdateStats(state);
            if (_placed) ApplyVisibility();
        }
        catch (Exception error)
        {
            Log("refresh failed: " + error.Message);
            if (initial) throw;
            if (!_closed && (_options.PetId ?? _state?.Pet?.Id) != _loadedPetId) Fail(3);
        }
        finally
        {
            _refreshing = false;
        }
    }

    private void ApplyVisibility()
    {
        if (_state?.Display?.Visible == false) Hide();
        else if (!IsVisible) Show();
    }

    private async Task<PetDefDto?> LoadDefinitionAsync(string petId, CancellationToken cancellationToken)
    {
        var pets = await _api.GetPetsAsync(cancellationToken);
        return pets.FirstOrDefault(pet => string.Equals(pet.Id, petId, StringComparison.Ordinal));
    }

    /// <summary>Size the sprite from the persisted display size (cell height = size).</summary>
    private void ApplySpriteSize()
    {
        if (_atlas is null) return;
        var height = _options.Size ?? _state?.Display?.Size ?? 160;
        height = Math.Clamp(height, 32, 1024);
        var width = height * (_atlas.CellWidth / Math.Max(1, _atlas.CellHeight));
        SpriteImage.Width = width;
        SpriteImage.Height = height;
        SpriteHost.Width = width;
        SpriteHost.Height = height;
        if (_placed) PlaceWindow();
    }

    private void PlaceWindow()
    {
        if (!_placed || _placing || _moving || _closed) return;
        _placing = true;
        try
        {
            var handle = new WindowInteropHelper(this).Handle;
            var monitor = DesktopMonitor.Locate(_monitorDevice, handle);
            _monitorDevice = monitor.Device;
            var workHeight = monitor.WorkArea.Height / monitor.Scale;
            _insetRight = Math.Clamp(_insetRight, 0, monitor.WorkArea.Width / monitor.Scale);
            _insetBottom = Math.Clamp(_insetBottom, 0, workHeight);
            UpdateLayout();
            // Reserve the sprite, panel and transient feedback before allowing
            // the session list to scroll, keeping the collapse button reachable.
            var feedbackHeight = Bubble.Visibility == Visibility.Visible ? Bubble.ActualHeight + Bubble.Margin.Top + Bubble.Margin.Bottom : 0;
            SessionScroll.MaxHeight = Math.Max(0, workHeight - SpriteHost.ActualHeight - PanelExtra() - feedbackHeight);
            UpdateLayout();
            // Grow around the sprite's center and keep its bottom fixed as the
            // panel opens, except when clamping to this monitor's work area.
            var position = monitor.WindowPosition(new Size(ActualWidth, ActualHeight), SpriteHost.ActualWidth,
                PanelExtra(), _insetRight, _insetBottom);
            DesktopMonitor.MoveWindow(handle, position);
        }
        finally
        {
            _placing = false;
        }
    }

    protected override void OnDpiChanged(DpiScale oldDpi, DpiScale newDpi)
    {
        base.OnDpiChanged(oldDpi, newDpi);
        Dispatcher.BeginInvoke(() => PlaceWindow(), DispatcherPriority.Loaded);
    }

    private double PanelExtra() => HoverPanel.Visibility == Visibility.Visible
        ? HoverPanel.ActualHeight + HoverPanel.Margin.Top
        : 0;

    private void StartTrack(string animation)
    {
        _frameTimer.Stop();
        _animation = animation;
        _track = null;
        if (_definition?.Renderer != "frames2d" && _definition?.Tracks is not null)
        {
            _definition.Tracks.TryGetValue(animation, out _track);
            if (_track is null) _definition.Tracks.TryGetValue("idle", out _track);
        }
        _frameIndex = 0;
        if (_track is null || _track.CellIndices().Length == 0)
        {
            // Non-sprite renderers (frames2d/live2d) fall back to the first
            // still the registry serves, so the overlay never goes blank.
            if (_atlas is not null) SpriteImage.Source = _atlas.Whole;
            return;
        }
        ApplyFrame();
        ScheduleNextFrame();
    }

    private void ApplyFrame()
    {
        if (_atlas is null || _track is null) return;
        var cells = _track.CellIndices();
        if (cells.Length == 0) return;
        var row = Array.IndexOf(RowOrder, _animation ?? "idle");
        if (row < 0) row = 0;
        var column = cells[Math.Clamp(_frameIndex, 0, cells.Length - 1)];
        SpriteImage.Source = _atlas.Cell(row, column);
    }

    private void ScheduleNextFrame()
    {
        _frameTimer.Stop();
        if (_track is null) return;
        var durations = _track.Durations;
        var count = _track.CellIndices().Length;
        if (durations is null || durations.Length == 0 || count <= 0) return;
        var index = Math.Clamp(_frameIndex, 0, durations.Length - 1);
        var duration = Math.Clamp(durations[index], 30, 5000);
        _frameTimer.Interval = TimeSpan.FromMilliseconds(duration);
        _frameTimer.Start();
    }

    private void OnFrameTick(object? sender, EventArgs e)
    {
        if (_track is null) return;
        var count = _track.CellIndices().Length;
        if (count <= 0) return;
        _frameIndex++;
        if (_frameIndex >= count)
        {
            if (_track.Loop)
            {
                _frameIndex = 0;
            }
            else if (!string.IsNullOrEmpty(_track.Fallback))
            {
                StartTrack(_track.Fallback);
                return;
            }
            else
            {
                _frameIndex = count - 1;
                ApplyFrame();
                _frameTimer.Stop();
                return;
            }
        }
        ApplyFrame();
        ScheduleNextFrame();
    }

    private void ShowBubble(string text)
    {
        // Interaction feedback (feed / rename / pet): one transient bubble above
        // the session stack, independent of the per-session status bubbles.
        BubbleText.Text = BoundedBubbleText(text);
        Bubble.Visibility = Visibility.Visible;
        if (_placed) PlaceWindow();
        _bubbleTimer.Stop();
        _bubbleTimer.Start();
    }

    private void OnBubbleTick(object? sender, EventArgs e)
    {
        _bubbleTimer.Stop();
        Bubble.Visibility = Visibility.Collapsed;
        if (_placed) PlaceWindow();
    }

    /// <summary>
    /// Rebuild the status-bubble stack: one bubble per active top-level
    /// session, the GUI's current session first. Collapsed (the default) shows
    /// the current session plus a "+N" badge; the badge expands the stack and
    /// the "收起" control collapses it, matching the in-page gesture. The
    /// signature avoids rebuilding on every 2 s poll when nothing changed.
    /// </summary>
    private sealed record BubbleEntry(string Body, string? Title);

    private void UpdateSessionBubbles(PetStateDto state)
    {
        if (state.StatusBubbles == "off")
        {
            SessionStack.Children.Clear();
            _sessionSignature = null;
            if (_placed) PlaceWindow();
            return;
        }
        var entries = state.Sessions?
            .Select(session =>
            {
                var body = string.IsNullOrWhiteSpace(session.Whisper)
                    ? session.Bubble?.Trim()
                    : session.Whisper!.Trim();
                var title = string.IsNullOrWhiteSpace(session.Title) ? null : session.Title.Trim();
                return new BubbleEntry(body ?? string.Empty, title);
            })
            .Where(entry => !string.IsNullOrWhiteSpace(entry.Body))
            .ToList() ?? new List<BubbleEntry>();
        if (entries.Count == 0 && !string.IsNullOrWhiteSpace(state.Bubble))
        {
            entries.Add(new BubbleEntry(state.Bubble.Trim(), null));
        }
        if (_options.FakeSession && entries.Count == 1)
        {
            entries.Add(new BubbleEntry("正在整理第二份报告", "第二个任务"));
        }
        if (_options.ExpandSessions) _sessionsExpanded = true;
        if (!string.IsNullOrWhiteSpace(_options.DemoTitle) && entries.Count > 0)
        {
            entries[0] = entries[0] with { Title = _options.DemoTitle!.Trim() };
        }
        if (entries.Count <= 1) _sessionsExpanded = false;
        var shown = _sessionsExpanded ? entries : entries.Take(1).ToList();
        var signature = (_sessionsExpanded ? "E" : "C") + "|"
            + string.Join('\u001f', shown.Select(entry => entry.Body + "\u001e" + (entry.Title ?? string.Empty)))
            + "|" + entries.Count;
        if (signature == _sessionSignature) return;
        _sessionSignature = signature;
        SessionStack.Children.Clear();
        foreach (var entry in shown)
        {
            SessionStack.Children.Add(CreateSessionBubble(entry.Body, entry.Title));
        }
        if (entries.Count > 1)
        {
            SessionStack.Children.Add(CreateSessionToggle(entries.Count, () =>
            {
                _sessionsExpanded = !_sessionsExpanded;
                _sessionSignature = null;
                if (_state is not null) UpdateSessionBubbles(_state);
            }));
        }
        if (_placed) PlaceWindow();
    }

    private static string BoundedBubbleText(string text)
    {
        var runes = text.EnumerateRunes().Take(121).ToArray();
        return string.Concat(runes.Take(120).Select(rune => rune.ToString()))
            + (runes.Length > 120 ? "..." : "");
    }

    private static Border CreateSessionBubble(string text, string? title)
    {
        var content = new StackPanel();
        if (!string.IsNullOrWhiteSpace(title))
        {
            content.Children.Add(new TextBlock
            {
                Text = string.Concat(title.EnumerateRunes().Take(80).Select(rune => rune.ToString())),
                Foreground = new SolidColorBrush(Color.FromRgb(157, 180, 255)),
                FontFamily = new FontFamily("Microsoft YaHei UI, Segoe UI"),
                FontSize = 10.5,
                FontWeight = FontWeights.SemiBold,
                TextTrimming = TextTrimming.CharacterEllipsis,
                MaxWidth = 272,
                Margin = new Thickness(0, 0, 0, 2),
            });
        }
        content.Children.Add(new TextBlock
        {
            Text = BoundedBubbleText(text),
            Foreground = new SolidColorBrush(Color.FromRgb(244, 247, 255)),
            FontFamily = new FontFamily("Microsoft YaHei UI, Segoe UI"),
            FontSize = 12.5,
            LineHeight = 18,
            TextWrapping = TextWrapping.Wrap,
            MaxWidth = 272,
        });
        return new Border
        {
            Style = (Style)Application.Current.FindResource("BubbleBorder"),
            HorizontalAlignment = HorizontalAlignment.Center,
            MaxWidth = 300,
            Margin = new Thickness(0, 0, 0, 4),
            Child = content,
        };
    }

    private Button CreateSessionToggle(int count, Action toggle)
    {
        var expanded = _sessionsExpanded;
        var button = new Button
        {
            // The style lives in this window's resources, not the application's.
            Style = (Style)FindResource("SessionToggle"),
            Content = expanded ? "收起" : $"+{count - 1}",
            ToolTip = expanded ? "收起会话气泡" : $"展开其余 {count - 1} 个会话",
        };
        button.Click += (_, _) => toggle();
        return button;
    }

    /// <summary>Project the pet name, affinity rank/points and treat stock into the hover panel.</summary>
    private void UpdateStats(PetStateDto state)
    {
        PanelName.Text = state.Name ?? state.Pet?.DisplayName ?? string.Empty;
        var affinity = state.Affinity;
        var treats = state.Treats;
        if (affinity is null || treats is null)
        {
            PanelRank.Text = string.Empty;
            PanelTreats.Text = string.Empty;
            PanelPoints.Text = string.Empty;
            return;
        }
        PanelRank.Text = affinity.Rank ?? string.Empty;
        PanelTreats.Text = $"小鱼干 ×{treats.Stocked}";
        PanelPoints.Text = $"亲密度 {affinity.Points}";
        if (_placed && HoverPanel.Visibility == Visibility.Visible) PlaceWindow();
    }

    private async Task PetAsync()
    {
        try
        {
            var response = await _api.InteractAsync("pet");
            if (response is null) return;
            Log("petted: " + response);
            using (var document = JsonDocument.Parse(response))
            {
                var reaction = document.RootElement.TryGetProperty("reaction", out var value) ? value.GetString() : null;
                if (!string.IsNullOrWhiteSpace(reaction)) ShowBubble(reaction!);
            }
            await RefreshAsync(initial: false);
        }
        catch (Exception error)
        {
            Log("interact failed: " + error.Message);
        }
    }

    private void OnSpriteMouseEnter(object sender, MouseEventArgs e) => ScheduleHoverShow();

    private void OnSpriteMouseLeave(object sender, MouseEventArgs e) => ScheduleHoverHide();

    private void OnHoverPanelMouseEnter(object sender, MouseEventArgs e)
    {
        _hoverShowTimer.Stop();
        _hoverHideTimer.Stop();
    }

    private void OnHoverPanelMouseLeave(object sender, MouseEventArgs e) => ScheduleHoverHide();

    private void ScheduleHoverShow()
    {
        _hoverHideTimer.Stop();
        _hoverShowTimer.Stop();
        _hoverShowTimer.Start();
    }

    private void ScheduleHoverHide()
    {
        _hoverShowTimer.Stop();
        _hoverHideTimer.Stop();
        _hoverHideTimer.Start();
    }

    private void ShowHoverPanel()
    {
        if (!SpriteHost.IsMouseOver && !HoverPanel.IsMouseOver) return;
        if (HoverPanel.Visibility == Visibility.Visible) return;
        HoverPanel.Visibility = Visibility.Visible;
        if (_placed) PlaceWindow();
    }

    private void HideHoverPanel()
    {
        if (HoverPanel.Visibility != Visibility.Visible) return;
        HoverPanel.Visibility = Visibility.Collapsed;
        if (_placed) PlaceWindow();
    }

    private async void OnFeedClick(object sender, RoutedEventArgs e)
    {
        try
        {
            var response = await _api.InteractAsync("feed");
            if (response is null)
            {
                ShowBubble("现在还不能喂食");
                return;
            }
            using var document = JsonDocument.Parse(response);
            var reaction = document.RootElement.TryGetProperty("reaction", out var value) ? value.GetString() : null;
            ShowBubble(string.IsNullOrWhiteSpace(reaction) ? "喂食完成" : reaction!);
        }
        catch (Exception error)
        {
            Log("feed failed: " + error.Message);
        }
    }

    private async void OnRenameClick(object sender, RoutedEventArgs e)
    {
        var current = _state?.Name ?? string.Empty;
        var name = PromptForName(current);
        if (name is null || name == current) return;
        try
        {
            var stored = await _api.SetNameAsync(name);
            if (stored is null)
            {
                ShowBubble("改名没有成功");
                return;
            }
            ShowBubble($"以后就叫{stored}啦");
            await RefreshAsync(initial: false);
        }
        catch (Exception error)
        {
            Log("rename failed: " + error.Message);
        }
    }

    private void OnHideClick(object sender, RoutedEventArgs e)
    {
        HideHoverPanel();
        Close();
    }

    private string? PromptForName(string current)
    {
        var dialog = new Window
        {
            Title = "给宠物改名",
            Owner = this,
            Width = 320,
            SizeToContent = SizeToContent.Height,
            WindowStyle = WindowStyle.ToolWindow,
            ResizeMode = ResizeMode.NoResize,
            WindowStartupLocation = WindowStartupLocation.CenterOwner,
            ShowInTaskbar = false,
            Topmost = true,
            Background = new SolidColorBrush(Color.FromRgb(15, 20, 35)),
        };
        var panel = new StackPanel { Margin = new Thickness(16) };
        panel.Children.Add(new TextBlock
        {
            Text = "新的名字",
            Foreground = Brushes.White,
            FontSize = 12,
            Margin = new Thickness(0, 0, 0, 6),
        });
        var input = new TextBox
        {
            Text = current,
            FontSize = 13,
            Padding = new Thickness(6, 4, 6, 4),
            Background = new SolidColorBrush(Color.FromRgb(28, 36, 58)),
            Foreground = Brushes.White,
            BorderBrush = new SolidColorBrush(Color.FromRgb(80, 100, 160)),
        };
        panel.Children.Add(input);
        var buttons = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            HorizontalAlignment = HorizontalAlignment.Right,
            Margin = new Thickness(0, 12, 0, 0),
        };
        var cancel = new Button { Content = "取消", Width = 72, IsCancel = true, Margin = new Thickness(0, 0, 8, 0) };
        var ok = new Button { Content = "确定", Width = 72, IsDefault = true };
        buttons.Children.Add(cancel);
        buttons.Children.Add(ok);
        panel.Children.Add(buttons);
        dialog.Content = panel;
        string? result = null;
        ok.Click += (_, _) =>
        {
            result = input.Text.Trim();
            dialog.Close();
        };
        dialog.Loaded += (_, _) =>
        {
            input.Focus();
            input.SelectAll();
        };
        dialog.ShowDialog();
        return string.IsNullOrWhiteSpace(result) ? null : result;
    }

    private void OnWindowMouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.OriginalSource is not DependencyObject source) return;
        if (!IsInsideSprite(source))
        {
            _pressedOnSprite = false;
            return;
        }
        _pressedOnSprite = true;
        _downPoint = e.GetPosition(this);
        _dragged = false;
        SpriteHost.CaptureMouse();
        e.Handled = true;
    }

    private bool IsInsideSprite(DependencyObject source)
    {
        for (DependencyObject? node = source; node is not null; node = VisualTreeHelper.GetParent(node))
        {
            if (ReferenceEquals(node, SpriteHost)) return true;
        }
        return false;
    }

    protected override void OnMouseMove(MouseEventArgs e)
    {
        base.OnMouseMove(e);
        if (!_pressedOnSprite || e.LeftButton != MouseButtonState.Pressed || _dragged) return;
        var current = e.GetPosition(this);
        if (Math.Abs(current.X - _downPoint.X) < 4 && Math.Abs(current.Y - _downPoint.Y) < 4) return;
        _dragged = true;
        SpriteHost.ReleaseMouseCapture();
        _moving = true;
        try
        {
            DragMove();
        }
        catch (InvalidOperationException)
        {
            // DragMove throws when the button was released between events.
        }
        finally
        {
            _moving = false;
        }
        _pressedOnSprite = false;
        if (_closed) return;
        var handle = new WindowInteropHelper(this).Handle;
        var monitor = DesktopMonitor.FromWindow(handle);
        _monitorDevice = monitor.Device;
        var bounds = DesktopMonitor.WindowBounds(handle);
        var petRight = bounds.Left + (bounds.Width + SpriteHost.ActualWidth * monitor.Scale) / 2;
        var petBottom = bounds.Bottom - PanelExtra() * monitor.Scale;
        _insetRight = Math.Max(0, (monitor.WorkArea.Right - petRight) / monitor.Scale);
        _insetBottom = Math.Max(0, (monitor.WorkArea.Bottom - petBottom) / monitor.Scale);
        PlaceWindow();
        SavePlacement();
        Log($"dragged right={_insetRight:0} bottom={_insetBottom:0}");
    }

    protected override void OnMouseLeftButtonUp(MouseButtonEventArgs e)
    {
        base.OnMouseLeftButtonUp(e);
        SpriteHost.ReleaseMouseCapture();
        var pressedOnSprite = _pressedOnSprite;
        _pressedOnSprite = false;
        if (_dragged)
        {
            _dragged = false;
            return;
        }
        if (!pressedOnSprite || _state is null) return;
        var position = e.GetPosition(SpriteHost);
        if (new Rect(SpriteHost.RenderSize).Contains(position)) _ = PetAsync();
    }

    private void OnSpriteRightButtonUp(object sender, MouseButtonEventArgs e)
    {
        e.Handled = true;
        var menu = new ContextMenu();
        var reset = new MenuItem { Header = "重置位置" };
        reset.Click += (_, _) =>
        {
            _insetRight = _options.Right;
            _insetBottom = _options.Bottom;
            PlaceWindow();
            SavePlacement();
        };
        var pet = new MenuItem { Header = "摸摸它" };
        pet.Click += (_, _) => _ = PetAsync();
        var quit = new MenuItem { Header = "退出桌面宠物" };
        quit.Click += (_, _) => Close();
        menu.Items.Add(pet);
        menu.Items.Add(reset);
        menu.Items.Add(new Separator());
        menu.Items.Add(quit);
        menu.PlacementTarget = SpriteHost;
        menu.IsOpen = true;
    }

    private void OnSourceInitialized(object? sender, EventArgs e)
    {
        var handle = new WindowInteropHelper(this).Handle;
        var style = GetWindowLong(handle, GwlExStyle);
        SetWindowLong(handle, GwlExStyle, (style | WsExToolWindow) & ~WsExAppWindow);
    }

    private const int GwlExStyle = -20;
    private const int WsExToolWindow = 0x00000080;
    private const int WsExAppWindow = 0x00040000;

    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", EntryPoint = "SetWindowLongW")]
    private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);
}
