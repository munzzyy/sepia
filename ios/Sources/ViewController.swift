import UIKit
import SafariServices
import WebKit

// One screen: the bundled web app in a WKWebView on the fixed custom-scheme
// origin. The wrapper ships no networking code of its own; what the page can
// load is bounded by the meta Content-Security-Policy the page itself
// carries in index.html, not by anything this handler injects.
final class ViewController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private var saveBridge: SaveBridge!

    // The app's own paper/darkroom background (app/index.html's theme-color
    // pair), not a bare system color: the letterbox and overscroll areas
    // should look like the app, in both appearances.
    private static let appBackground = UIColor { trait in
        trait.userInterfaceStyle == .dark
            ? UIColor(red: 0x18 / 255.0, green: 0x14 / 255.0, blue: 0x10 / 255.0, alpha: 1)
            : UIColor(red: 0xf4 / 255.0, green: 0xea / 255.0, blue: 0xd8 / 255.0, alpha: 1)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.appBackground

        SaveBridge.cleanExportsDir()
        saveBridge = SaveBridge(presenter: self)

        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: AppSchemeHandler.scheme)
        config.websiteDataStore = .default()
        config.userContentController.add(saveBridge, name: "save")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = Self.appBackground
        // A long press on any link would otherwise pop a live preview of a
        // remote page, loading it outside every gate below.
        webView.allowsLinkPreview = false
        // The system text-size setting reaches web content the way Android's
        // textZoom does: scale the page by the user's Dynamic Type factor.
        // Read again on every change, not just at launch, via the observer
        // below.
        applyPageZoom()

        NotificationCenter.default.addObserver(
            self, selector: #selector(applyPageZoom),
            name: UIContentSizeCategory.didChangeNotification, object: nil)

        // Pinned to the safe area: the page never hides under the notch or
        // the home indicator, and the letterbox matches the app's own theme.
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor),
            webView.leadingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor),
        ])

        webView.load(URLRequest(url: AppSchemeHandler.start))
    }

    @objc private func applyPageZoom() {
        webView.pageZoom = UIFontMetrics(forTextStyle: .body).scaledValue(for: 17) / 17
    }

    // The web view only ever navigates inside the bundle; a link out goes to
    // the system's browser view. Gated hard: main-frame https navigations
    // from a real link tap, nothing else. Note for anyone tightening this
    // further: WebKit reports a synthetic element.click() on an anchor as
    // .linkActivated too, so this gate does not distinguish a real tap from
    // a script pretending to be one; the CSP's script-src is what stops a
    // script from getting the chance in the first place.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.cancel)
            return
        }
        if url.scheme == AppSchemeHandler.scheme {
            decisionHandler(.allow)
            return
        }
        if url.scheme == "https",
           navigationAction.targetFrame?.isMainFrame != false,
           navigationAction.navigationType == .linkActivated {
            present(SFSafariViewController(url: url), animated: true)
        }
        decisionHandler(.cancel)
    }

    // window.open / target=_blank from the page: same rule as above,
    // including the real-tap check, and no new web view either way.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url, url.scheme == "https",
           navigationAction.navigationType == .linkActivated {
            present(SFSafariViewController(url: url), animated: true)
        }
        return nil
    }
}
