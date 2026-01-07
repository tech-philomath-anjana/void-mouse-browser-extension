# Void Mouse — Webcam Hands Pointer

Control the browser with webcam hand gestures. Void Mouse renders a virtual cursor and dispatches pointer/click events via MediaPipe Hands running fully on-device.

## Usage
1) Click the toolbar icon to open the popup.
2) Toggle **Enable Void Mouse**. Allow the camera prompt.
3) Point your index finger: the virtual cursor follows. Pinch (thumb + index) to click the element under the virtual cursor.
4) Use popup controls to adjust pinch threshold and cursor colors.

## Permissions
- `camera` (requested at runtime via getUserMedia): hand tracking
- `storage`: save UI settings locally
- `scripting` / `activeTab` / `offscreen`: run overlay and MediaPipe pipeline
- `host_permissions: <all_urls>`: allow content script overlay on any site

## Privacy & data handling
- Video and gestures are processed locally in the browser; no frames or landmarks are sent to servers.
- Settings (colors, threshold, enabled state) are stored locally via `chrome.storage`.
- No data is sold or shared with third parties.
- Policy: see [`PRIVACY.md`](./PRIVACY.md).
- Contact: mahasathian.anjana@gmail.com.

## Remote code statement
All JS/Wasm assets (MediaPipe `hands.js`, WASM binaries, model, runner scripts, popup/background/content/offscreen) are bundled in the extension. There are no external script/module URLs and no dynamic eval of remote code.

## Known limitations
- Some pages that restrict content scripts or camera access (e.g., certain YouTube pages or sandboxed iframes) may block the overlay. If the overlay or camera prompt fails, try another page.

## Development notes
- MediaPipe assets live in `extension/mediapipe/` and are referenced via `chrome.runtime.getURL`.
- The virtual cursor dispatches pointer events only; it does not move the OS cursor.

## Support
Questions or issues: mahasathian.anjana@gmail.com or open a GitHub issue.
