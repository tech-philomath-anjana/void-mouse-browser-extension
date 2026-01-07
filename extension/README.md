# Void Mouse — Browser extension (scaffold)

This folder contains a Chrome/Edge extension scaffold that injects a small overlay into web pages and uses MediaPipe Hands (web) to enable mouse-free browsing via webcam gestures.

Important: for reliable on-device tracking in a production extension you should bundle the MediaPipe web artifacts with the extension. This README explains what to download and where to put it.

Required files (download and place in `extension/mediapipe/`):

- `hands.js` — the MediaPipe Hands JavaScript runtime (from `@mediapipe/hands`).
- `hands_wasm.wasm` or similarly named WebAssembly binary the runtime expects.
- Optionally `camera_utils.js` (from `@mediapipe/camera_utils`) if you prefer using the Camera helper.

Example: after placing files the directory should look like:

```
extension/
  manifest.json
  content_script.js
  ui.css
  popup.html
  mediapipe/
    hands.js
    hands_wasm.wasm
    camera_utils.js (optional)
```

Where to get the files:

- The `@mediapipe/hands` package provides prebuilt browser files. You can either use the npm package and copy the build artifacts or pull them from the official CDN and then save them into this folder for bundling in the extension (Option 3: bundle for production).

Notes and usage
----------------
- Load the extension as an "unpacked extension" in Chrome/Edge: open `chrome://extensions`, enable Developer mode, click "Load unpacked" and point to this `extension/` folder.
- Open any page and click the extension action/popup, then click "Enable Void Mouse" in the floating overlay to start webcam tracking.
- The extension cannot move the system cursor; it shows a virtual cursor and dispatches pointer/click events at the element under the virtual cursor.

Security & permissions
----------------------
- The content script runs on all pages and will request camera access via `getUserMedia` when you enable it. Keep this in mind when installing.
- Bundle MediaPipe files to avoid network usage and improve reliability.

Next steps / polish
-------------------
- Add icon images in `icons/` and wire them in `manifest.json`.
- Improve handedness handling and refine thresholds using real test footage.
- Add a small options page to tune smoothing, click threshold, and pointer speed.
- Add a keyboard shortcut to toggle the feature.

If you want, I can:

- Add an options page and persist settings to extension storage.
- Bundle concrete MediaPipe web files into the repo (I can fetch them if you permit network access or provide the files).
- Improve click simulation (better pointer event sequences for complex UIs) and add multi-hand gestures.
