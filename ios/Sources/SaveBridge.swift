import UIKit
import WebKit

// The JS "save" bridge: the page hands over a base64 payload after export,
// this writes it to a scratch file, and the system share sheet decides
// where it actually goes (Files, Photos, another app, AirDrop). That sheet
// is the truth the page's copy has to match: never "Downloaded", something
// like "Choose where to save it".
final class SaveBridge: NSObject, WKScriptMessageHandler {
    private static let exportsDir: URL =
        FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)

    // A file left over from a previous launch is exactly the sensitive
    // image this app exists to not leave lying around; called once at
    // startup before anything can write into the directory again.
    static func cleanExportsDir() {
        try? FileManager.default.removeItem(at: exportsDir)
        try? FileManager.default.createDirectory(at: exportsDir, withIntermediateDirectories: true)
    }

    private weak var presenter: UIViewController?

    init(presenter: UIViewController) {
        self.presenter = presenter
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let name = body["name"] as? String,
              let b64 = body["b64"] as? String,
              let data = Data(base64Encoded: b64), !data.isEmpty,
              let presenter
        else { return }
        // Bare filename only: a crafted "name" cannot escape the exports
        // directory or carry a path.
        let bare = (name as NSString).lastPathComponent
        let fileName = bare.isEmpty ? "sepia-export" : bare
        let fileURL = Self.exportsDir.appendingPathComponent(fileName)
        do {
            try FileManager.default.createDirectory(at: Self.exportsDir, withIntermediateDirectories: true)
            try data.write(to: fileURL, options: .atomic)
        } catch {
            return
        }
        let sheet = UIActivityViewController(activityItems: [fileURL], applicationActivities: nil)
        if let popover = sheet.popoverPresentationController {
            popover.sourceView = presenter.view
            popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 0, height: 0)
            popover.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true)
    }
}
