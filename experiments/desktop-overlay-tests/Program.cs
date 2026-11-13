using System.IO;
using System.Net;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using DshPetOverlay;

// Exercise the real window and JSON client with deterministic HTTP responses.
internal static class Program
{
    private const BindingFlags PrivateInstance = BindingFlags.Instance | BindingFlags.NonPublic;

    [STAThread]
    private static void Main()
    {
        SynchronizationContext.SetSynchronizationContext(new DispatcherSynchronizationContext());
        var app = new App { ShutdownMode = ShutdownMode.OnExplicitShutdown };
        app.InitializeComponent();
        var createBubble = typeof(OverlayWindow).GetMethod("CreateSessionBubble", BindingFlags.Static | BindingFlags.NonPublic)!;
        foreach (var title in new[] { new string('A', 79) + "😀tail", string.Concat(Enumerable.Repeat("😀", 81)) })
        {
            var bubble = (Border)createBubble.Invoke(null, new object[] { "Working", title })!;
            var rendered = ((TextBlock)((StackPanel)bubble.Child).Children[0]).Text;
            var expected = string.Concat(title.EnumerateRunes().Take(80).Select(rune => rune.ToString()));
            Check(rendered == expected, "session title preserves Unicode scalar values up to 80 code points");
        }
        CheckMonitorPlacement();
        var optionsType = typeof(OverlayWindow).Assembly.GetType("DshPetOverlay.OverlayOptions")!;
        var options = Activator.CreateInstance(optionsType, true)!;
        var window = (OverlayWindow)Activator.CreateInstance(typeof(OverlayWindow), PrivateInstance, null, new[] { options }, null)!;
        Set(window, "_loaded", true); // Drive refresh explicitly, without the startup handshake/timers.
        foreach (var text in new[] { new string('A', 119) + "😀tail", string.Concat(Enumerable.Repeat("😀", 120)) })
        {
            var expected = string.Concat(text.EnumerateRunes().Take(120).Select(rune => rune.ToString()))
                + (text.EnumerateRunes().Count() > 120 ? "..." : "");
            var bubble = (Border)createBubble.Invoke(null, new object[] { text, "Title" })!;
            Check(((TextBlock)((StackPanel)bubble.Child).Children[1]).Text == expected, "session body truncates at Unicode boundaries");
            Call(window, "ShowBubble", text);
            Check(((TextBlock)window.FindName("BubbleText")).Text == expected, "feedback truncates at Unicode boundaries");
        }
        Call(window, "OnBubbleTick", window, EventArgs.Empty);
        var api = Field(window, "_api");
        ((HttpClient)Field(api, "_http")).Dispose();
        var handler = new PetResponses();
        Set(api, "_http", new HttpClient(handler) { BaseAddress = new Uri("http://localhost/") });
        try
        {
            Refresh(window, true);
            Check(Field(window, "_atlas") is not null, "fractional frame durations decode");
            Check(!(bool)Field(window, "_closed"), "fractional affinity and treats decode");
            var firstTrack = Field(window, "_track");
            var firstImage = ((Image)window.FindName("SpriteImage")).Source;
            Check(handler.DesktopQuerySeen, "desktop poll requests local GUI ordering");

            handler.PetId = "second";
            Refresh(window);
            Check(!ReferenceEquals(firstTrack, Field(window, "_track")), "same-animation pet switch resets track");
            Check(!ReferenceEquals(firstImage, ((Image)window.FindName("SpriteImage")).Source), "pet switch draws first frame");
            handler.CellWidth = 2;
            handler.PetId = "wide";
            handler.Size = 800;
            Refresh(window);
            var wideSprite = (Image)window.FindName("SpriteImage");
            Check(wideSprite.Width == 1600 && wideSprite.Height == 800, "wide sprites retain their aspect ratio at large sizes");
            handler.Size = 160;

            handler.Renderer = "frames2d";
            handler.PetId = "still";
            Refresh(window);
            Check(!((DispatcherTimer)Field(window, "_frameTimer")).IsEnabled, "static frame stops previous animation timer");
            var still = (BitmapSource)((Image)window.FindName("SpriteImage")).Source;
            Check(still.PixelWidth == 512 && still.PixelHeight == 512, "frames2d displays the whole JPEG despite fallback cell geometry");

            handler.Size = 1024;
            Refresh(window);
            Check(((Image)window.FindName("SpriteImage")).Height == 1024, "maximum persisted size is preserved");
            handler.Size = 32;
            Refresh(window);
            Check(((Image)window.FindName("SpriteImage")).Height == 32, "minimum persisted size is preserved");
            handler.Size = 160;
            Refresh(window);

            var rename = (Task<string?>)Call(api, "SetNameAsync", "new name", CancellationToken.None)!;
            Check(rename.GetAwaiter().GetResult() is null, "HTTP 200 rejected rename is not success");
            handler.RenameResponse = "{\"ok\":true}";
            rename = (Task<string?>)Call(api, "SetNameAsync", "new name", CancellationToken.None)!;
            Check(rename.GetAwaiter().GetResult() is null, "rename requires a stored name");
            handler.RenameResponse = "{\"ok\":true,\"name\":\"stored name\"}";
            rename = (Task<string?>)Call(api, "SetNameAsync", "new name", CancellationToken.None)!;
            Check(rename.GetAwaiter().GetResult() == "stored name", "rename uses the host-confirmed name");

            var stack = (StackPanel)window.FindName("SessionStack");
            Check(stack.Children.Count == 1, "session bubble renders");
            handler.StatusBubbles = "off";
            Refresh(window);
            Check(stack.Children.Count == 0, "status bubble switch clears stack");
            handler.StatusBubbles = "auto";
            Refresh(window);
            Check(stack.Children.Count == 1, "status bubble switch restores stack");

            Call(window, "ApplyVisibility");
            Check(window.IsVisible, "visible setting shows window");
            Set(window, "_placed", true);
            handler.SessionCount = 12;
            handler.LongBubbles = true;
            Refresh(window);
            Set(window, "_sessionsExpanded", true);
            Set(window, "_sessionSignature", null!);
            Refresh(window);
            window.UpdateLayout();
            var scroll = (ScrollViewer)window.FindName("SessionScroll");
            Check(scroll is not null && scroll.ScrollableHeight > 0, "expanded session stack scrolls within available height");
            Check(window.ActualHeight <= SystemParameters.WorkArea.Height + 1, "expanded bubbles keep pet controls on screen");
            var dragLeft = window.Left + 20;
            Set(window, "_moving", true);
            window.Left = dragLeft;
            Refresh(window);
            Check(Math.Abs(window.Left - dragLeft) < 1, "polling does not reposition an ongoing drag");
            Set(window, "_moving", false);
            var sprite = (FrameworkElement)window.FindName("SpriteHost");
            var down = new MouseButtonEventArgs(Mouse.PrimaryDevice, Environment.TickCount, MouseButton.Left)
            {
                RoutedEvent = UIElement.MouseLeftButtonDownEvent,
                Source = sprite,
            };
            Call(window, "OnWindowMouseLeftButtonDown", window, down);
            Check(ReferenceEquals(Mouse.Captured, sprite), "sprite owns click capture");
            sprite.ReleaseMouseCapture();

            handler.Visible = false;
            Refresh(window);
            Check(!window.IsVisible, "hidden setting hides window");
            handler.Visible = true;
            Refresh(window);
            Check(window.IsVisible, "summon shows window again");

            handler.Renderer = "live2d";
            handler.PetId = "model";
            Refresh(window);
            Check((bool)Field(window, "_closed"), "unsupported renderer exits for browser fallback");
            Check(Environment.ExitCode == 2, "unsupported renderer has a distinct failure code");
            Environment.ExitCode = 0;
            CheckStartupAndClose(optionsType);
            CheckStartupFailures(optionsType);
            Console.WriteLine("All desktop overlay regressions passed.");
        }
        finally
        {
            if (!(bool)Field(window, "_closed")) window.Close();
            app.Shutdown();
        }
    }

    private static object Field(object target, string name) => target.GetType().GetField(name, PrivateInstance)!.GetValue(target)!;
    private static void Set(object target, string name, object value) => target.GetType().GetField(name, PrivateInstance)!.SetValue(target, value);
    private static object? Call(object target, string name, params object[] args) => target.GetType().GetMethod(name, PrivateInstance | BindingFlags.Public)!.Invoke(target, args);

    private static void CheckMonitorPlacement()
    {
        var monitorType = typeof(OverlayWindow).Assembly.GetType("DshPetOverlay.DesktopMonitor")!;
        var fallback = monitorType.GetMethod("Read", BindingFlags.Static | BindingFlags.NonPublic)!.Invoke(null, new object[] { new IntPtr(-1) })!;
        var fallbackArea = (Rect)monitorType.GetProperty("WorkArea")!.GetValue(fallback)!;
        Check(fallbackArea.Width > 0 && fallbackArea.Height > 0, "removed monitor falls back to a usable primary display");
        var monitor = Activator.CreateInstance(monitorType, "secondary", new Rect(-2560, 0, 2560, 1440), 2.0)!;
        var position = (Point)Call(monitor, "WindowPosition", new Size(300, 400), 160.0, 100.0, 196.0, 196.0)!;
        Check(position == new Point(-852, 448), "secondary monitor placement uses physical pixels and DPI-scaled insets");
        position = (Point)Call(monitor, "WindowPosition", new Size(300, 400), 160.0, 100.0, 2000.0, 2000.0)!;
        Check(position == new Point(-2560, 0), "placement clamps to the selected monitor");
        var parser = typeof(OverlayWindow).GetMethod("ParsePlacement", BindingFlags.Static | BindingFlags.NonPublic)!;
        var legacy = ((double Right, double Bottom, string? Monitor))parser.Invoke(null, new object[] { "{\"right\":48,\"bottom\":96}" })!;
        Check(legacy == (48, 96, null), "legacy placement retains primary-monitor insets");
        var saved = ((double Right, double Bottom, string? Monitor))parser.Invoke(null, new object[] { "{\"right\":48,\"bottom\":96,\"monitor\":\"secondary\"}" })!;
        Check(saved.Monitor == "secondary", "saved placement retains the monitor identity");
    }

    private static void CheckStartupAndClose(Type optionsType)
    {
        var options = Activator.CreateInstance(optionsType, true)!;
        var window = (OverlayWindow)Activator.CreateInstance(typeof(OverlayWindow), PrivateInstance, null, new[] { options }, null)!;
        var api = Field(window, "_api");
        ((HttpClient)Field(api, "_http")).Dispose();
        var handler = new PetResponses { Visible = false };
        Set(api, "_http", new HttpClient(handler) { BaseAddress = new Uri("http://localhost/") });
        try
        {
            window.Show();
            PumpUntil(() => ((DispatcherTimer)Field(window, "_pollTimer")).IsEnabled);
            Check(handler.ReadyCount == 1 && !window.IsVisible, "real startup performs handshake and honors hidden state");
            handler.Visible = true;
            Refresh(window);
            PumpUntil(() => window.IsVisible);
            Check(handler.ReadyCount == 1, "summon does not repeat startup handshake");
            window.Close();
            Check(!((DispatcherTimer)Field(window, "_pollTimer")).IsEnabled
                && !((DispatcherTimer)Field(window, "_frameTimer")).IsEnabled, "close stops polling and animation");
            Refresh(window);
            Check(!window.IsVisible, "refresh after close cannot resurrect the window");
        }
        finally
        {
            if (!(bool)Field(window, "_closed")) window.Close();
        }
    }

    private static void CheckStartupFailures(Type optionsType)
    {
        foreach (var scenario in new[] { "retry", "failure", "gameplay", "switch", "slow" })
        {
            var options = Activator.CreateInstance(optionsType, true)!;
            var window = (OverlayWindow)Activator.CreateInstance(typeof(OverlayWindow), PrivateInstance, null, new[] { options }, null)!;
            var api = Field(window, "_api");
            ((HttpClient)Field(api, "_http")).Dispose();
            var handler = new PetResponses {
                Failures = scenario == "retry" ? 1 : scenario == "failure" ? 10 : 0,
                Gameplay = scenario == "gameplay", Slow = scenario == "slow",
            };
            Set(api, "_http", new HttpClient(handler) { BaseAddress = new Uri("http://localhost/") });
            try
            {
                window.Show();
                PumpUntil(() => (bool)Field(window, "_closed") || handler.ReadyCount > 0, 12);
                if (scenario == "switch")
                {
                    handler.Gameplay = true;
                    handler.PetId = "gameplay-pet";
                    Refresh(window);
                    Check((bool)Field(window, "_closed") && Environment.ExitCode == 2, "switching to gameplay closes the companion for page fallback");
                }
                else if (scenario == "retry")
                    Check(handler.StateCount == 2 && handler.ReadyCount == 1, "transient startup failure retries successfully");
                else
                    Check((bool)Field(window, "_closed") && handler.ReadyCount == 0
                        && Environment.ExitCode == (scenario == "gameplay" ? 2 : 3), "startup " + scenario + " exits with reason before ready");
            }
            finally
            {
                if (!(bool)Field(window, "_closed")) window.Close();
                Environment.ExitCode = 0;
            }
        }
    }

    private static void PumpUntil(Func<bool> condition, int seconds = 5)
    {
        var frame = new DispatcherFrame();
        var deadline = DateTime.UtcNow.AddSeconds(seconds);
        var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(10) };
        timer.Tick += (_, _) =>
        {
            if (condition() || DateTime.UtcNow >= deadline) frame.Continue = false;
        };
        timer.Start();
        Dispatcher.PushFrame(frame);
        timer.Stop();
        Check(condition(), "asynchronous window transition completed");
    }

    private static void Refresh(OverlayWindow window, bool initial = false)
    {
        var task = (Task)Call(window, "RefreshAsync", initial)!;
        var frame = new DispatcherFrame();
        var dispatcher = window.Dispatcher;
        _ = task.ContinueWith(_ => dispatcher.BeginInvoke(() => frame.Continue = false));
        Dispatcher.PushFrame(frame);
        task.GetAwaiter().GetResult();
    }

    private static void Check(bool condition, string message)
    {
        if (!condition) throw new InvalidOperationException(message);
        Console.WriteLine("PASS " + message);
    }

    private sealed class PetResponses : HttpMessageHandler
    {
        public string PetId = "first";
        public string Renderer = "sprite2d";
        public string StatusBubbles = "auto";
        public bool Visible = true;
        public bool DesktopQuerySeen;
        public double Size = 160;
        public int SessionCount = 1;
        public bool LongBubbles;
        public int CellWidth = 1;
        public string RenameResponse = "{\"ok\":false,\"error\":\"name-too-long\"}";
        public int ReadyCount;
        public int StateCount;
        public int Failures;
        public bool Gameplay;
        public bool Slow;

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            HttpContent content;
            switch (request.RequestUri!.AbsolutePath)
            {
                case "/api/pet/state":
                    StateCount++;
                    if (Slow) await Task.Delay(Timeout.Infinite, cancellationToken);
                    if (Failures-- > 0) return new HttpResponseMessage(HttpStatusCode.ServiceUnavailable);
                    DesktopQuerySeen = request.RequestUri.Query == "?desktop=1";
                    content = new StringContent(JsonSerializer.Serialize(new
                    {
                        pet = new { id = PetId }, animation = "idle", display = new { visible = Visible, size = Size },
                        affinity = new { points = 0.5, pets = 3_000_000_000d, feeds = 0, turns = 0 },
                        treats = new { stocked = 0.5, max = 20.5 },
                        statusBubbles = StatusBubbles, sessions = Enumerable.Range(0, SessionCount).Select(i => new { bubble = LongBubbles ? new string('鲸', 120) : "Working", title = "Project " + i }).ToArray(),
                    }));
                    break;
                case "/api/pet/pets":
                    content = new StringContent(JsonSerializer.Serialize(new[] { new
                    {
                        gameplay = Gameplay ? new { work = new { tickMs = 10000 } } : null,
                        id = PetId, renderer = Renderer, atlasUrl = "/atlas.png", cell = new { width = Renderer == "frames2d" ? 192 : CellWidth, height = Renderer == "frames2d" ? 208 : 1 },
                        tracks = new { idle = new { frames = new[] { 0, 1 }, durations = new[] { 62.5, 125.5 }, loop = true } },
                    } }));
                    break;
                case "/api/pet/set-name":
                    content = new StringContent(RenameResponse);
                    break;
                case "/api/pet/overlay/ready":
                    ReadyCount++;
                    content = new StringContent("{\"ok\":true}");
                    break;
                default:
                    var width = Renderer == "frames2d" ? 512 : 2;
                    var height = Renderer == "frames2d" ? 512 : 9;
                    var bitmap = BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgr32, null, new byte[width * height * 4], width * 4);
                    BitmapEncoder encoder = Renderer == "frames2d" ? new JpegBitmapEncoder() : new PngBitmapEncoder();
                    encoder.Frames.Add(BitmapFrame.Create(bitmap));
                    using (var stream = new MemoryStream())
                    {
                        encoder.Save(stream);
                        content = new ByteArrayContent(stream.ToArray());
                    }
                    break;
            }
            return new HttpResponseMessage(HttpStatusCode.OK) { Content = content };
        }
    }
}
