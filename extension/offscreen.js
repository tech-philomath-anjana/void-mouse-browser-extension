// Offscreen controller: runs in offscreen.html and shares a single Hands
// instance across all content scripts via runtime ports.
(function () {
  console.log('offscreen: loaded');

  const ports = new Map();

  const locateFile = (file) =>
    typeof chrome !== 'undefined' && chrome.runtime ? chrome.runtime.getURL(`mediapipe/${file}`) : file;

  async function ensureHands() {
    if (window.__offscreenHands) return window.__offscreenHands;
    if (typeof Hands === 'undefined') throw new Error('Hands not available in offscreen');

    const hands = new Hands({ locateFile });
    hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
    await hands.initialize();
    window.__offscreenHands = hands;
    return hands;
  }

  chrome.runtime.onConnect.addListener((port) => {
    try {
      const id = port.name || Math.random().toString(36).slice(2);
      console.log('offscreen: port connected', id);
      ports.set(id, port);

      let isReady = false;
      let hands = null;

      port.onMessage.addListener(async (msg) => {
        if (!msg?.type) return;

        if (msg.type === 'init') {
          try {
            hands = await ensureHands();
            isReady = true;
            port.postMessage({ type: 'ready' });
          } catch (error) {
            console.error('offscreen: hands init failed', error);
            port.postMessage({ type: 'error', error: String(error) });
          }
          return;
        }

        if (msg.type === 'frame' && isReady) {
          try {
            await hands.send({ image: msg.imageBitmap });
          } catch (error) {
            console.error('offscreen frame handling failed', error);
            port.postMessage({ type: 'error', error: String(error) });
          }
        }
      });

      port.onDisconnect.addListener(() => {
        console.log('offscreen: port disconnected', id);
        ports.delete(id);
      });

      // Attach a single onResults to fan-out results to all connected ports.
      if (!window.__offscreenAttached) {
        (async () => {
          try {
            const sharedHands = await ensureHands();
            sharedHands.onResults((results) => {
              const out = { ...results };
              try {
                delete out.image; // keep payload small
              } catch (error) {
                console.warn('offscreen: failed to strip image', error);
              }

              for (const p of ports.values()) {
                try {
                  p.postMessage({ type: 'results', results: out });
                } catch (error) {
                  console.warn('offscreen: postMessage failed', error);
                }
              }
            });
            window.__offscreenAttached = true;
            console.log('offscreen: onResults attached');
          } catch (error) {
            console.error('offscreen attach failed', error);
          }
        })();
      }
    } catch (error) {
      console.error('offscreen connect error', error);
    }
  });
})();
