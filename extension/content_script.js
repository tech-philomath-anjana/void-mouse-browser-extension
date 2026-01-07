// Content script: builds UI overlay and asks background to inject bundled MediaPipe
// scripts into the page. Gesture processing runs inside runner_inject.js in the page
// context; communication is via window.postMessage.

(function () {
  // Run in top frame and allowed iframes; skip truly sandboxed frames without script/origin permissions
  if (window !== window.top) {
    const frameEl = window.frameElement;
    if (!frameEl) return;
    const sandbox = (frameEl.getAttribute('sandbox') || '').toLowerCase();
    const sandboxed = frameEl.hasAttribute('sandbox');
    const allowsScripts = sandbox.includes('allow-scripts');
    const allowsOrigin = sandbox.includes('allow-same-origin');
    if (sandboxed && (!allowsScripts || !allowsOrigin)) {
      return; // skip locked-down sandboxed iframes
    }
    // otherwise allow running inside permissive iframes
  }

  // Loosen Trusted Types for our injected scripts where allowed
  try {
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
      window.voidmouseTT = window.trustedTypes.createPolicy('voidmouse', {
        createHTML: (s) => s,
        createScript: (s) => s,
        createScriptURL: (s) => s,
      });
    }
  } catch(e) { /* ignore TT policy failures */ }
  let running = false;
  let currentThreshold = 0.05;
  let baseColor = '#00c8ff';
  let activeColor = '#ff5f5f';
  const STATE_KEY = 'voidmouse_enabled';
  const THRESHOLD_KEY = 'voidmouse_threshold';
  const CURSOR_COLOR_KEY = 'voidmouse_cursor_color';
  const CLICK_COLOR_KEY = 'voidmouse_click_color';

  // elements runner expects
  const previewWrapper = document.createElement('div');
  previewWrapper.id = 'void-preview';
  previewWrapper.style.position = 'fixed';
  previewWrapper.style.right = '10px';
  previewWrapper.style.bottom = '10px';
  previewWrapper.style.width = '240px';
  previewWrapper.style.height = '180px';
  previewWrapper.style.zIndex = 2147483645;
  previewWrapper.style.background = 'rgba(0,0,0,0.35)';
  previewWrapper.style.backdropFilter = 'blur(2px)';
  previewWrapper.style.borderRadius = '6px';
  previewWrapper.style.overflow = 'hidden';
  previewWrapper.style.display = 'flex';
  previewWrapper.style.flexDirection = 'column';
  previewWrapper.style.boxShadow = '0 4px 18px rgba(0,0,0,0.35)';

  const previewHeader = document.createElement('div');
  previewHeader.style.display = 'flex';
  previewHeader.style.alignItems = 'center';
  previewHeader.style.justifyContent = 'space-between';
  previewHeader.style.padding = '4px 8px';
  previewHeader.style.color = '#fff';
  previewHeader.style.fontSize = '12px';
  previewHeader.style.background = 'rgba(0,0,0,0.45)';
  previewHeader.style.backdropFilter = 'blur(3px)';
  previewHeader.textContent = 'Void Mouse';

  const previewToggleBtn = document.createElement('button');
  previewToggleBtn.textContent = '–';
  previewToggleBtn.style.marginLeft = '8px';
  previewToggleBtn.style.border = 'none';
  previewToggleBtn.style.background = 'rgba(255,255,255,0.15)';
  previewToggleBtn.style.color = '#fff';
  previewToggleBtn.style.borderRadius = '4px';
  previewToggleBtn.style.padding = '2px 8px';
  previewToggleBtn.style.cursor = 'pointer';
  previewToggleBtn.style.fontSize = '12px';
  previewToggleBtn.style.backdropFilter = 'blur(2px)';
  previewToggleBtn.style.transition = 'background 120ms ease';
  previewToggleBtn.onmouseenter = () => previewToggleBtn.style.background = 'rgba(255,255,255,0.28)';
  previewToggleBtn.onmouseleave = () => previewToggleBtn.style.background = 'rgba(255,255,255,0.15)';

  previewHeader.appendChild(previewToggleBtn);
  previewWrapper.appendChild(previewHeader);

  const previewBody = document.createElement('div');
  previewBody.style.position = 'relative';
  previewBody.style.width = '240px';
  previewBody.style.height = '152px';

  const videoEl = document.createElement('video');
  videoEl.id = 'vm-video';
  videoEl.autoplay = true; videoEl.playsInline = true; videoEl.muted = true;
  videoEl.style.position = 'absolute';
  videoEl.style.inset = '0';
  videoEl.style.width = '240px';
  videoEl.style.height = '152px';
  videoEl.style.background = '#000';
  videoEl.style.objectFit = 'cover';

  const canvasEl = document.createElement('canvas');
  canvasEl.id = 'vm-canvas';
  canvasEl.style.position = 'absolute';
  canvasEl.style.inset = '0';
  canvasEl.style.width = '240px';
  canvasEl.style.height = '152px';
  canvasEl.style.background = 'transparent';

  previewBody.appendChild(videoEl);
  previewBody.appendChild(canvasEl);
  previewWrapper.appendChild(previewBody);
  document.body.appendChild(previewWrapper);

  // strong default styles for custom pointer (with !important guard)
  const pointerStyle = document.createElement('style');
  pointerStyle.id = 'void-pointer-style';
  pointerStyle.textContent = `
    #void-pointer {
      position: fixed !important;
      width: 26px !important;
      height: 26px !important;
      border-radius: 50% !important;
      border: 3px solid rgba(0,0,0,0.65) !important;
      box-shadow: 0 0 0 2px rgba(255,255,255,0.98), 0 0 12px var(--vm-base-shadow, rgba(0,220,255,0.95)), 0 0 24px var(--vm-base-shadow, rgba(0,220,255,0.7)) !important;
      background: var(--vm-base-bg, radial-gradient(circle at center, rgba(255,255,255,1) 0 6px, rgba(0,220,255,0.98) 6px 14px, rgba(0,0,0,0.28) 14px 15px)) !important;
      backdrop-filter: blur(1.5px) !important;
      opacity: 1 !important;
      z-index: 2147483647 !important;
      pointer-events: none !important;
      display: block !important;
      visibility: visible !important;
      left: 0 !important;
      top: 0 !important;
      transform: translate(-13px, -13px) !important;
    }
  `;
  document.head.appendChild(pointerStyle);

  const cursorEl = document.createElement('div');
  cursorEl.id = 'void-pointer';
  cursorEl.style.setProperty('position', 'fixed', 'important');
  cursorEl.style.setProperty('width', '26px', 'important');
  cursorEl.style.setProperty('height', '26px', 'important');
  cursorEl.style.setProperty('borderRadius', '50%', 'important');
  cursorEl.style.setProperty('border', '3px solid rgba(0,0,0,0.65)', 'important');
  cursorEl.style.setProperty('boxShadow', '0 0 0 2px rgba(255,255,255,0.98), 0 0 12px rgba(0,220,255,0.95), 0 0 24px rgba(0,220,255,0.7)', 'important');
  cursorEl.style.setProperty('background', 'radial-gradient(circle at center, rgba(255,255,255,1) 0 6px, rgba(0,200,255,0.98) 6px 14px, rgba(0,0,0,0.28) 14px 15px)', 'important');
  cursorEl.style.setProperty('opacity', '1', 'important');
  cursorEl.style.setProperty('zIndex', '2147483647', 'important');
  cursorEl.style.setProperty('pointerEvents', 'none', 'important');
  cursorEl.style.setProperty('display', 'block', 'important');
  cursorEl.style.setProperty('visibility', 'visible', 'important');
  cursorEl.style.setProperty('left', '0px', 'important');
  cursorEl.style.setProperty('top', '0px', 'important');
  cursorEl.style.setProperty('transform', 'translate(' + (window.innerWidth / 2 - 13) + 'px,' + (window.innerHeight / 2 - 13) + 'px)', 'important');
  document.body.appendChild(cursorEl);

  // keep pointer in DOM if pages mutate body
  const observer = new MutationObserver(() => {
    if (!document.getElementById('void-pointer')) {
      document.body.appendChild(cursorEl);
      ensurePointer();
    }
  });
  observer.observe(document.body || document.documentElement, { childList: true, subtree: true });

  // heartbeat to keep pointer visible if page styles fight us
  const ensurePointer = () => {
    if (!document.getElementById('void-pointer')) {
      document.body.appendChild(cursorEl);
    }
    cursorEl.style.setProperty('display', 'block', 'important');
    cursorEl.style.setProperty('visibility', 'visible', 'important');
    cursorEl.style.setProperty('opacity', '1', 'important');
    cursorEl.style.setProperty('zIndex', '2147483647', 'important');
    cursorEl.style.setProperty('pointerEvents', 'none', 'important');
  };
  const pointerInterval = setInterval(ensurePointer, 150);

  const centerPointer = () => {
    const cx = Math.max(0, Math.min(window.innerWidth - 26, window.innerWidth / 2 - 13));
    const cy = Math.max(0, Math.min(window.innerHeight - 26, window.innerHeight / 2 - 13));
    cursorEl.style.setProperty('transform', 'translate(' + cx + 'px,' + cy + 'px)', 'important');
    ensurePointer();
  };

  // show immediately on load
  centerPointer();

  // keep centered on resize/orientation changes
  window.addEventListener('resize', centerPointer, { passive: true });
  window.addEventListener('orientationchange', centerPointer, { passive: true });

  // fallback style to hide native cursor while active
  const hideCursorStyle = document.createElement('style');
  hideCursorStyle.id = 'void-hide-native-cursor';
  hideCursorStyle.textContent = `html, body, * { cursor: none !important; }`;

  let previewHidden = false;
  const applyPreviewVisibility = () => {
    previewBody.style.display = previewHidden ? 'none' : 'block';
    previewWrapper.style.height = previewHidden ? '32px' : '180px';
    previewWrapper.style.width = '240px';
    previewToggleBtn.textContent = previewHidden ? 'Show' : '–';
    previewToggleBtn.setAttribute('aria-pressed', previewHidden ? 'false' : 'true');
  };
  previewToggleBtn.addEventListener('click', () => {
    previewHidden = !previewHidden;
    applyPreviewVisibility();
  });

  function post(msg){ window.postMessage(Object.assign({ source: 'voidmouse-cs' }, msg), '*'); }

  const makeBg = (color) => `radial-gradient(circle at center, rgba(255,255,255,1) 0 6px, ${color} 6px 14px, rgba(0,0,0,0.28) 14px 15px)`;
  const updatePointerColor = () => {
    cursorEl.style.setProperty('background', makeBg(baseColor), 'important');
    cursorEl.style.setProperty('boxShadow', `0 0 0 2px rgba(255,255,255,0.98), 0 0 12px ${baseColor} , 0 0 24px ${baseColor}`, 'important');
  };

  // receive status updates from runner
  window.addEventListener('message', (evt) => {
    if (!evt || !evt.data || evt.data.source !== 'voidmouse-runner') return;
    if (evt.data.type === 'stopped') {
      running = false;
    }
    if (evt.data.type === 'status' && typeof evt.data.baseColor === 'string' && typeof evt.data.activeColor === 'string') {
      baseColor = evt.data.baseColor;
      activeColor = evt.data.activeColor;
      updatePointerColor();
    }
  });

  async function ensureInjectedAndStart(){
    if (running) return true;
    const resp = await new Promise((resolve)=>{
      chrome.runtime.sendMessage({ action:'inject_void_mouse' }, (r)=> resolve(r));
    });
    if(!resp || !resp.success){
      console.error('Injection failed', resp && resp.error);
      return false;
    }
    post({ type: 'voidmouse-start', threshold: currentThreshold, baseColor, activeColor });
    running = true;
    if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ [STATE_KEY]: true });
    if (!document.getElementById('void-hide-native-cursor')) document.head.appendChild(hideCursorStyle);
    return true;
  }

  async function stopVoidMouse(){
    if (!running) return true;
    post({ type: 'voidmouse-stop' });
    running = false;
    if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ [STATE_KEY]: false });
    const existing = document.getElementById('void-hide-native-cursor');
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    return true;
  }

  const setThreshold = (val) => {
    if (!isFinite(val)) return;
    currentThreshold = val;
    if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ [THRESHOLD_KEY]: val });
    post({ type: 'voidmouse-threshold', value: val });
  };

  const setColors = (base, active) => {
    if (typeof base === 'string') baseColor = base;
    if (typeof active === 'string') activeColor = active;
    updatePointerColor();
    if (chrome.storage && chrome.storage.local) chrome.storage.local.set({ [CURSOR_COLOR_KEY]: baseColor, [CLICK_COLOR_KEY]: activeColor });
    post({ type: 'voidmouse-colors', baseColor, activeColor });
  };

  // auto-start if previously enabled
  if (chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([STATE_KEY, THRESHOLD_KEY], async (res) => {
      if (res && typeof res[THRESHOLD_KEY] === 'number') {
        currentThreshold = res[THRESHOLD_KEY];
      }
      if (res && typeof res[CURSOR_COLOR_KEY] === 'string') baseColor = res[CURSOR_COLOR_KEY];
      if (res && typeof res[CLICK_COLOR_KEY] === 'string') activeColor = res[CLICK_COLOR_KEY];
      updatePointerColor();
      if (res && res[STATE_KEY]) {
        centerPointer();
        await ensureInjectedAndStart();
      }
    });
  }

  // listen to messages from popup
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return;
    (async () => {
      if (msg.type === 'voidmouse-start') {
        const ok = await ensureInjectedAndStart();
        sendResponse({ ok, running });
      } else if (msg.type === 'voidmouse-stop') {
        await stopVoidMouse();
        sendResponse({ ok: true, running });
      } else if (msg.type === 'voidmouse-threshold') {
        setThreshold(msg.value);
        sendResponse({ ok: true, threshold: currentThreshold });
      } else if (msg.type === 'voidmouse-status') {
        sendResponse({ ok: true, running, threshold: currentThreshold, previewHidden, baseColor, activeColor });
      } else if (msg.type === 'voidmouse-preview-toggle') {
        previewHidden = !!msg.hidden;
        applyPreviewVisibility();
        sendResponse({ ok: true, previewHidden });
      } else if (msg.type === 'voidmouse-colors') {
        setColors(msg.baseColor || baseColor, msg.activeColor || activeColor);
        sendResponse({ ok: true, baseColor, activeColor });
      }
    })();
    return true; // async
  });

  // expose for debugging
  window.VoidMouse = { start: ensureInjectedAndStart, stop: stopVoidMouse, setThreshold, setColors };

  applyPreviewVisibility();

})();
