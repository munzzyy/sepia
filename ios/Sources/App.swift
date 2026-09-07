import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?

    // The canvas holds the sensitive original, and the app switcher would
    // otherwise thumbnail it. Android sets FLAG_SECURE; here a shield covers
    // the window whenever the app leaves the foreground.
    private let shield = UIVisualEffectView(effect: UIBlurEffect(style: .systemMaterial))

    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        excludeWebKitDataFromBackup()

        let window = UIWindow(frame: UIScreen.main.bounds)
        window.rootViewController = ViewController()
        window.makeKeyAndVisible()
        self.window = window
        return true
    }

    // Sessions live in RAM (main.js closes every bitmap on session close,
    // and there is no vault to speak of), but WKWebsiteDataStore still
    // keeps its own working files under Library/WebKit, and an iCloud or
    // iTunes device backup would otherwise carry them along. Excluded here
    // so a backup of this device is not a second copy of anything the app
    // ever touched.
    private func excludeWebKitDataFromBackup() {
        let dir = URL(fileURLWithPath: NSHomeDirectory())
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("WebKit", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            var values = URLResourceValues()
            values.isExcludedFromBackup = true
            var mutableDir = dir
            try mutableDir.setResourceValues(values)
        } catch {
            // No console output ships in release; a debug build should
            // still surface this loudly rather than pretend it worked.
            assertionFailure("could not exclude Library/WebKit from backup: \(error)")
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        guard let window, shield.superview == nil else { return }
        shield.frame = window.bounds
        shield.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        window.addSubview(shield)
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        shield.removeFromSuperview()
    }
}
