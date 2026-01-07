chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'inject_void_mouse') {
    const tabId = sender.tab?.id;
    if (!tabId) {
      sendResponse({ success: false, error: 'No tab id' });
      return;
    }

    // Inject as <script src="..."> so document.currentScript.src is set and
    // Module.locateFile can derive the correct chrome-extension:// base URL.
    const filesToInject = [
      'mediapipe/locatefile_setup.js',
      'mediapipe/hands_solution_packed_assets_loader.js',
      'mediapipe/hands.js',
      'mediapipe/runner_inject.js',
    ];

    const injectScriptTag = (url) =>
      new Promise((resolve) => {
        chrome.scripting.executeScript(
          {
            target: { tabId },
            func: (scriptUrl) =>
              new Promise((res) => {
                const s = document.createElement('script');

                // Try multiple policy names to satisfy strict Trusted Types pages (e.g., YouTube)
                try {
                  let policy = null;
                  if (window.trustedTypes?.createPolicy) {
                    const names = ['voidmouse', 'default', 'trusted-types-default', 'youtube#html'];
                    for (let i = 0; i < names.length; i += 1) {
                      try {
                        policy = window.trustedTypes.createPolicy(names[i], {
                          createScriptURL: (u) => u,
                          createHTML: (x) => x,
                          createScript: (x) => x,
                        });
                        if (policy) break;
                      } catch (err) {
                        /* try next */
                      }
                    }
                  }
                  s.src = policy ? policy.createScriptURL(scriptUrl) : scriptUrl;
                } catch (error) {
                  s.src = scriptUrl;
                }

                s.type = 'text/javascript';
                s.onload = () => res({ ok: true });
                s.onerror = (e) => res({ ok: false, error: String(e) });
                document.head.appendChild(s);
              }),
            args: [chrome.runtime.getURL(url)],
          },
          (results) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, error: chrome.runtime.lastError.message });
            } else if (results?.[0]?.result) {
              resolve(results[0].result);
            } else {
              resolve({ ok: false, error: 'Unknown injection result' });
            }
          }
        );
      });

    (async () => {
      for (const path of filesToInject) {
        const result = await injectScriptTag(path);
        if (!result.ok) {
          sendResponse({ success: false, error: `Failed to inject ${path}: ${result.error}` });
          return;
        }
      }
      sendResponse({ success: true });
    })();

    return true; // async response
  }

  if (message?.action === 'ensure_offscreen') {
    (async () => {
      try {
        if (chrome.offscreen?.hasDocument && !chrome.offscreen.hasDocument()) {
          await chrome.offscreen.createDocument({
            url: chrome.runtime.getURL('offscreen.html'),
            reasons: ['BLOB'],
            justification: 'Run MediaPipe Hands under extension origin',
          });
          console.log('background: offscreen created');
        }
        sendResponse({ success: true });
      } catch (error) {
        console.warn('background: ensure_offscreen failed', error);
        sendResponse({ success: false, error: String(error) });
      }
    })();

    return true; // async response
  }
});
// (the correct handler is above) — no-op here
