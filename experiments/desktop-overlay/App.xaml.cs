using System.IO;
using System.Windows;
using System.Windows.Threading;

namespace DshPetOverlay;

public partial class App : Application
{
    private OverlayWindow? _overlay;

    internal static void Log(string message)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(Path.GetTempPath(), "dsh-pet-overlay.log"),
                $"{DateTime.Now:O} [app] {message}{Environment.NewLine}");
        }
        catch
        {
            // Logging must never take the overlay down.
        }
    }

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        Log("startup args=" + string.Join(" | ", e.Args));
        DispatcherUnhandledException += (_, args) =>
        {
            Log("dispatcher exception: " + args.Exception);
            MessageBox.Show(args.Exception.ToString(), "DSH Pet Overlay", MessageBoxButton.OK, MessageBoxImage.Error);
            args.Handled = true;
            // Do not keep a broken window alive: the host still reports the
            // companion as running and would hide the page pet forever.
            Shutdown(1);
        };
        AppDomain.CurrentDomain.UnhandledException += (_, args) => Log("domain exception: " + args.ExceptionObject);
        try
        {
            var options = OverlayOptions.Parse(e.Args);
            _overlay = new OverlayWindow(options);
            MainWindow = _overlay;
            _overlay.Show();
            Log("window shown");
        }
        catch (Exception error)
        {
            Log("startup failed: " + error);
            MessageBox.Show(error.ToString(), "DSH Pet Overlay", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
        }
    }
}
