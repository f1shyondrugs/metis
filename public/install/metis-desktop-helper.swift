import AppKit
import ApplicationServices
import CoreGraphics

enum DesktopError: Error { case message(String) }
func fail(_ message: String) throws -> Never { throw DesktopError.message(message) }
func output(_ value: [String: Any]) throws {
    let data = try JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}
func windows() -> [[String: Any]] {
    let items = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    return items.filter { ($0[kCGWindowLayer as String] as? Int) == 0 && ($0[kCGWindowAlpha as String] as? Double ?? 1) > 0 }
}
func rect(_ item: [String: Any]) -> CGRect {
    guard let bounds = item[kCGWindowBounds as String] as? NSDictionary,
          let result = CGRect(dictionaryRepresentation: bounds) else { return .zero }
    return result
}
func geometry(_ item: [String: Any]) -> [String: Any] {
    let r = rect(item)
    return ["windowId": String(item[kCGWindowNumber as String] as? UInt32 ?? 0),
            "title": item[kCGWindowName as String] as? String ?? item[kCGWindowOwnerName as String] as? String ?? "",
            "x": Int(r.minX), "y": Int(r.minY), "width": Int(r.width), "height": Int(r.height)]
}
func monitors() throws -> [[String: Any]] {
    var count: UInt32 = 0
    guard CGGetActiveDisplayList(0, nil, &count) == .success, count > 0, count <= 64 else {
        try fail("No active monitors found")
    }
    let capacity = count
    var displays = [CGDirectDisplayID](repeating: 0, count: Int(capacity))
    let status = displays.withUnsafeMutableBufferPointer { buffer in
        CGGetActiveDisplayList(capacity, buffer.baseAddress, &count)
    }
    guard status == .success else { try fail("Monitor discovery is unavailable") }
    return displays.prefix(Int(count)).map { id in
        // Global Quartz bounds are logical points, as required by screencapture -R.
        let bounds = CGDisplayBounds(id)
        let screen = NSScreen.screens.first { candidate in
            (candidate.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == id
        }
        return ["id": String(id), "name": screen?.localizedName ?? "Display " + String(id),
                "x": Int(bounds.minX), "y": Int(bounds.minY), "width": Int(bounds.width),
                "height": Int(bounds.height), "primary": id == CGMainDisplayID()]
    }
}
func run() throws {
    guard CommandLine.arguments.count == 2, let data = Data(base64Encoded: CommandLine.arguments[1]),
          let p = try JSONSerialization.jsonObject(with: data) as? [String: Any],
          let operation = p["operation"] as? String else { try fail("Invalid desktop request") }
    if operation == "request_permissions" {
        let opts = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(opts)
        _ = CGRequestScreenCaptureAccess()
    }
    let accessibility = AXIsProcessTrusted(), capture = CGPreflightScreenCaptureAccess()
    let session = CGSessionCopyCurrentDictionary() as? [String: Any]
    let locked = session == nil || (session?["CGSSessionScreenIsLocked"] as? Bool ?? false)
    let available = accessibility && capture && !locked && !windows().isEmpty
    let reason = locked ? "Desktop is locked or unavailable" :
        !accessibility || !capture ? "Enable Screen Recording and Accessibility for Metis AI Remote Client in System Settings, then restart the app." : ""
    if operation == "status" || operation == "request_permissions" {
        try output(["available": available, "accessibility": accessibility, "screenRecording": capture, "reason": reason])
        return
    }
    guard available else { try fail(reason.isEmpty ? "No interactive macOS windows are available" : reason) }
    if operation == "monitors" {
        try output(["monitors": try monitors()]); return
    }
    if operation == "list_windows" {
        try output(["windows": windows().map { item -> [String: Any] in
            var g = geometry(item); g["id"] = g.removeValue(forKey: "windowId"); return g
        }]); return
    }
    guard let idString = p["windowId"] as? String, let id = UInt32(idString),
          var item = windows().first(where: { ($0[kCGWindowNumber as String] as? UInt32) == id }),
          let pid = item[kCGWindowOwnerPID as String] as? Int32,
          let app = NSRunningApplication(processIdentifier: pid) else { try fail("Target window is unavailable") }
    _ = app.activate(options: [.activateIgnoringOtherApps])
    let axApp = AXUIElementCreateApplication(pid)
    var axValue: CFTypeRef?
    guard AXUIElementCopyAttributeValue(axApp, kAXWindowsAttribute as CFString, &axValue) == .success,
          let axWindows = axValue as? [AXUIElement] else { try fail("Cannot locate accessible windows in this app") }
    let targetRect = rect(item)
    var raised = false
    for window in axWindows {
        var posValue: CFTypeRef?, sizeValue: CFTypeRef?
        guard AXUIElementCopyAttributeValue(window, kAXPositionAttribute as CFString, &posValue) == .success,
              AXUIElementCopyAttributeValue(window, kAXSizeAttribute as CFString, &sizeValue) == .success,
              let posValue, let sizeValue else { continue }
        var pos = CGPoint.zero, size = CGSize.zero
        guard AXValueGetValue(posValue as! AXValue, .cgPoint, &pos), AXValueGetValue(sizeValue as! AXValue, .cgSize, &size) else { continue }
        if abs(pos.x-targetRect.minX) < 3 && abs(pos.y-targetRect.minY) < 3 &&
           abs(size.width-targetRect.width) < 3 && abs(size.height-targetRect.height) < 3 {
            raised = AXUIElementPerformAction(window, kAXRaiseAction as CFString) == .success
            break
        }
    }
    guard raised else { try fail("Could not raise the selected window. Observe another window.") }
    Thread.sleep(forTimeInterval: 0.12)
    guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pid,
          let updated = windows().first(where: { ($0[kCGWindowNumber as String] as? UInt32) == id }) else { try fail("Could not activate target window") }
    item = updated
    let r = rect(item)
    guard r.width > 0 && r.height > 0 && r.width <= 8000 && r.height <= 8000 else { try fail("Invalid window geometry") }
    if operation == "observe" { try output(geometry(item)); return }
    if let expected = p["expectedGeometry"] as? [String: Any] {
        let current = geometry(item)
        for key in ["x", "y", "width", "height"] {
            guard (expected[key] as? Int) == (current[key] as? Int) else { try fail("Window moved or resized. Observe this window again before acting") }
        }
    }
    func point(_ xKey: String, _ yKey: String) throws -> CGPoint {
        guard let x = p[xKey] as? Int, let y = p[yKey] as? Int,
              x >= 0 && y >= 0 && x < Int(r.width) && y < Int(r.height) else { try fail("Coordinates are outside the target window") }
        return CGPoint(x: r.minX + CGFloat(x), y: r.minY + CGFloat(y))
    }
    func mouse(_ type: CGEventType, _ at: CGPoint, _ button: CGMouseButton = .left, _ count: Int = 1) throws {
        guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: at, mouseButton: button) else { try fail("Cannot create mouse input") }
        event.setIntegerValueField(.mouseEventClickState, value: Int64(count))
        event.post(tap: .cghidEventTap)
    }
    if operation == "move" { try mouse(.mouseMoved, point("x", "y")) }
    else if operation == "click" {
        let at = try point("x", "y")
        let button: CGMouseButton = p["button"] as? String == "right" ? .right : p["button"] as? String == "middle" ? .center : .left
        let down: CGEventType = button == .right ? .rightMouseDown : button == .center ? .otherMouseDown : .leftMouseDown
        let up: CGEventType = button == .right ? .rightMouseUp : button == .center ? .otherMouseUp : .leftMouseUp
        for count in 1...(p["count"] as? Int ?? 1) {
            try mouse(down, at, button, count); try mouse(up, at, button, count)
            Thread.sleep(forTimeInterval: 0.08)
        }
    } else if operation == "drag" {
        let start = try point("x", "y"), end = try point("toX", "toY")
        try mouse(.leftMouseDown, start)
        defer { try? mouse(.leftMouseUp, end) }
        for step in 1...12 {
            let at = CGPoint(x: start.x + (end.x-start.x)*CGFloat(step)/12, y: start.y + (end.y-start.y)*CGFloat(step)/12)
            try mouse(.leftMouseDragged, at); Thread.sleep(forTimeInterval: 0.012)
        }
    } else if operation == "scroll" {
        try mouse(.mouseMoved, point("x", "y"))
        guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1,
                                 wheel1: Int32(p["deltaY"] as? Int ?? 0), wheel2: 0, wheel3: 0) else { try fail("Cannot create scroll input") }
        event.post(tap: .cghidEventTap)
    } else if operation == "type" {
        let text = Array((p["text"] as? String ?? "").utf16)
        // Small chunks avoid truncation in applications with limited event buffers.
        for start in stride(from: 0, to: text.count, by: 20) {
            let chunk = Array(text[start..<min(start+20, text.count)])
            for down in [true, false] {
                guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down) else { try fail("Cannot create keyboard input") }
                chunk.withUnsafeBufferPointer { event.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: $0.baseAddress!) }
                event.post(tap: .cghidEventTap)
            }
        }
    } else if operation == "key" {
        let map: [String: CGKeyCode] = ["a":0,"s":1,"d":2,"f":3,"h":4,"g":5,"z":6,"x":7,"c":8,"v":9,"b":11,
          "q":12,"w":13,"e":14,"r":15,"y":16,"t":17,"1":18,"2":19,"3":20,"4":21,"6":22,"5":23,"9":25,"7":26,
          "8":28,"0":29,"o":31,"u":32,"i":34,"p":35,"l":37,"j":38,"k":40,"n":45,"m":46,
          "enter":36,"return":36,"tab":48,"space":49,"backspace":51,"escape":53,"esc":53,"delete":117,
          "home":115,"end":119,"pageup":116,"pagedown":121,"left":123,"right":124,"down":125,"up":126,
          "f1":122,"f2":120,"f3":99,"f4":118,"f5":96,"f6":97,"f7":98,"f8":100,"f9":101,"f10":109,"f11":103,"f12":111]
        let modifiers: [String: CGEventFlags] = ["ctrl":.maskControl,"control":.maskControl,"shift":.maskShift,
            "alt":.maskAlternate,"option":.maskAlternate,"cmd":.maskCommand,"command":.maskCommand,"meta":.maskCommand,"super":.maskCommand]
        let chord = (p["key"] as? String ?? "").lowercased().split(separator: "+").map { $0.trimmingCharacters(in: .whitespaces) }
        var flags: CGEventFlags = [], codes: [CGKeyCode] = []
        for key in chord {
            if let modifier = modifiers[key] { flags.formUnion(modifier) }
            else if let code = map[key] { codes.append(code) }
            else { try fail("Unsupported key: " + key) }
        }
        guard !codes.isEmpty else { try fail("Key chord needs a non-modifier key") }
        for down in [true, false] {
            for code in down ? codes : codes.reversed() {
                guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else { try fail("Cannot create keyboard input") }
                event.flags = flags; event.post(tap: .cghidEventTap)
            }
        }
    } else { try fail("Unsupported computer use operation") }
    try output(["ok": true, "windowId": idString])
}
do { try run() } catch {
    let message: String
    if case DesktopError.message(let detail) = error { message = detail } else { message = String(describing: error) }
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
