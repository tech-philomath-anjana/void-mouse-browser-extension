// Runner injected into the page to wire MediaPipe Hands to the overlay
// elements (#vm-video, #vm-canvas, #void-pointer) created by the content script.
(function () {
  try {
    if (window.__voidMouseRunnerActive) return;
    window.__voidMouseRunnerActive = true;

    if (typeof Hands === 'undefined') {
      console.error('mediapipe runner: Hands not available');
      return;
    }

    const videoEl = document.getElementById('vm-video');
    const canvasEl = document.getElementById('vm-canvas');
    const pointerEl = document.getElementById('void-pointer');

    if (!videoEl || !canvasEl || !pointerEl) {
      console.error('mediapipe runner: overlay elements not found');
      return;
    }

    const ctx = canvasEl.getContext('2d');

    // Resolve bundled assets using this script URL as the base when Module.locateFile
    // is unavailable (some pages override Module before we load).
    const locateFile =
      typeof window.Module === 'object' && typeof window.Module.locateFile === 'function'
        ? window.Module.locateFile
        : (path) => {
            const script = document.currentScript;
            const base = script && script.src ? script.src.substring(0, script.src.lastIndexOf('/') + 1) : '';
            return base + path;
          };

    const hands = new Hands({ locateFile: (file) => locateFile(file) });
    window.handsRunner = hands; // handy for debugging in DevTools

    // Tunables and state
    const CLICK_COOLDOWN_MS = 220;
    const SCROLL_COOLDOWN_MS = 80;
    const SCROLL_STABLE_FRAMES = 2;
    const SCROLL_DIR_ALPHA = 0.72; // smoothes direction changes
    const SCROLL_STEP_ALPHA = 0.55; // EMA for step size
    const SCROLL_GAIN = 950; // scales thumb delta to pixels
    const SCROLL_MIN_STEP = 40;
    const SCROLL_MAX_STEP = 180;
    const SCROLL_DEADZONE = 0.01;
    const SMOOTH_ALPHA = 0.35; // pointer smoothing factor
    const NOISE_DEADZONE = 2.0; // ignore micro jitter (px)

    let running = false;
    let stream = null;
    let frameHandle = null;
    let pinchThreshold = 0.05;
    let threshold = 0.05;
    let lastScrollTime = 0;
    let lastScrollDir = 0;
    let scrollStableFrames = 0;
    let smoothThumbDelta = 0;
    let smoothScrollStep = 0;
    let lastClickTime = 0;
    let prevX = window.innerWidth / 2;
    let prevY = window.innerHeight / 2;
    let handFrames = 0;
    let suppressClicksUntil = 0;
    let pinchStableFrames = 0;
    let pinchReady = true; // require open → close → open for each click
    let prevCursorStyle = null;
    let prevBodyCursorStyle = null;
    let baseColor = '#00c8ff';
    let activeColor = '#ff5f5f';

    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const makeBg = (color) =>
      `radial-gradient(circle at center, rgba(255,255,255,1) 0 6px, ${color} 6px 14px, rgba(0,0,0,0.28) 14px 15px)`;

    const applyPointerColor = (isActive) => {
      const color = isActive ? activeColor : baseColor;
      pointerEl.style.setProperty('background', makeBg(color), 'important');
      pointerEl.style.setProperty(
        'boxShadow',
        `0 0 0 2px rgba(255,255,255,0.98), 0 0 12px ${color}, 0 0 24px ${color}`,
        'important'
      );
    };

    const sendStatus = (value) => {
      window.postMessage({ source: 'voidmouse-runner', type: 'status', value, baseColor, activeColor }, '*');
    };

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
      selfieMode: true,
    });
    hands.onResults(onResults);

    async function startRunner(startThreshold, startBaseColor, startActiveColor) {
      if (running) return;

      threshold = Number.isFinite(startThreshold) ? startThreshold : 0.07;
      pinchThreshold = threshold;
      if (typeof startBaseColor === 'string') baseColor = startBaseColor;
      if (typeof startActiveColor === 'string') activeColor = startActiveColor;

      try {
        await hands.initialize();
      } catch (error) {
        console.error('mediapipe runner: hands.initialize() failed', error);
        sendStatus('init failed');
        return;
      }

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 960 }, height: { ideal: 720 }, facingMode: { ideal: 'user' } },
          audio: false,
        });
      } catch (error) {
        console.error('mediapipe runner camera error', error);
        sendStatus('camera denied');
        pointerEl.style.setProperty('display', 'block', 'important');
        pointerEl.style.setProperty('visibility', 'visible', 'important');
        pointerEl.style.setProperty('opacity', '1', 'important');
        pointerEl.style.setProperty(
          'transform',
          `translate(${window.innerWidth / 2 - 13}px, ${window.innerHeight / 2 - 13}px)`,
          'important'
        );
        return;
      }

      videoEl.srcObject = stream;
      await new Promise((resolve) => (videoEl.onloadedmetadata = resolve));
      try {
        await videoEl.play();
      } catch (error) {
        console.warn('mediapipe runner: video play failed', error);
      }

      canvasEl.width = videoEl.videoWidth || 960;
      canvasEl.height = videoEl.videoHeight || 720;
      canvasEl.style.background = 'transparent';

      running = true;

      pointerEl.style.setProperty('display', 'block', 'important');
      pointerEl.style.setProperty('visibility', 'visible', 'important');
      pointerEl.style.setProperty('opacity', '1', 'important');
      pointerEl.style.setProperty(
        'transform',
        `translate(${window.innerWidth / 2 - 13}px, ${window.innerHeight / 2 - 13}px)`,
        'important'
      );
      applyPointerColor(false);

      // Hide OS cursor for clarity while runner is active
      try {
        prevCursorStyle = document.documentElement.style.cursor;
        prevBodyCursorStyle = document.body.style.cursor;
        document.documentElement.style.cursor = 'none';
        document.body.style.cursor = 'none';
      } catch (error) {
        console.warn('mediapipe runner: failed to hide cursor', error);
      }

      sendStatus('running');
      loop();
    }

    function stopRunner() {
      running = false;
      if (frameHandle) cancelAnimationFrame(frameHandle);
      frameHandle = null;

      try {
        if (stream) stream.getTracks().forEach((track) => track.stop());
      } catch (error) {
        console.warn('mediapipe runner: stop stream failed', error);
      }

      stream = null;
      pointerEl.style.setProperty('display', 'block', 'important');
      pointerEl.style.setProperty('visibility', 'visible', 'important');
      pointerEl.style.setProperty('opacity', '1', 'important');

      try {
        document.documentElement.style.cursor = prevCursorStyle || '';
        document.body.style.cursor = prevBodyCursorStyle || '';
      } catch (error) {
        console.warn('mediapipe runner: failed to restore cursor', error);
      }

      window.postMessage({ source: 'voidmouse-runner', type: 'stopped' }, '*');
    }

    async function loop() {
      if (!running) return;
      try {
        if (videoEl.readyState >= 2) await hands.send({ image: videoEl });
      } catch (error) {
        console.error('mediapipe runner frame error', error);
      }
      frameHandle = requestAnimationFrame(loop);
    }

    function onResults(results) {
      ctx.save();
      ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

      // Always draw a frame (result image if available, otherwise the video)
      if (results && results.image) {
        try {
          ctx.drawImage(results.image, 0, 0, canvasEl.width, canvasEl.height);
        } catch (error) {
          console.warn('mediapipe runner: draw results.image failed', error);
        }
      } else if (videoEl.readyState >= 2) {
        try {
          ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
        } catch (error) {
          console.warn('mediapipe runner: draw video frame failed', error);
        }
      }

      const allHands = results && results.multiHandLandmarks ? results.multiHandLandmarks : [];
      if (!allHands.length) {
        // Keep pointer visible at last known position when no hand is seen
        pointerEl.style.setProperty('display', 'block', 'important');
        pointerEl.style.setProperty('visibility', 'visible', 'important');
        pointerEl.style.setProperty('opacity', '1', 'important');
        pointerEl.style.setProperty('transform', `translate(${prevX - 13}px, ${prevY - 13}px)`, 'important');
        applyPointerColor(false);
        ctx.restore();
        handFrames = 0;
        return;
      }

      handFrames += 1;
      const landmarks = allHands[0];

      // Finger state helpers (thumb uses x, others use y checks)
      const tipIds = [4, 8, 12, 16, 20];
      const fingers = [];
      fingers.push(landmarks[tipIds[0]].x > landmarks[tipIds[0] - 1].x ? 1 : 0);
      for (let i = 1; i < 5; i += 1) {
        fingers.push(landmarks[tipIds[i]].y < landmarks[tipIds[i] - 2].y ? 1 : 0);
      }

      const now = performance.now();
      const thumbUp = fingers[0] === 1;
      const otherUpCount = fingers.slice(1).reduce((acc, val) => acc + val, 0);
      const thumbDominant = thumbUp && otherUpCount <= 1; // tolerate one noisy finger

      if (thumbDominant) {
        suppressClicksUntil = now + 500; // block clicks while scrolling

        const rawThumbDelta = landmarks[2].y - landmarks[4].y; // >0 when tip above base (scroll up)
        smoothThumbDelta = SCROLL_DIR_ALPHA * smoothThumbDelta + (1 - SCROLL_DIR_ALPHA) * rawThumbDelta;

        if (Math.abs(smoothThumbDelta) > SCROLL_DEADZONE) {
          const thumbDir = smoothThumbDelta > 0 ? -1 : 1; // up -> negative scroll
          if (thumbDir === lastScrollDir) {
            scrollStableFrames += 1;
          } else {
            scrollStableFrames = 1;
            lastScrollDir = thumbDir;
          }

          const targetStep = Math.min(
            SCROLL_MAX_STEP,
            Math.max(SCROLL_MIN_STEP, Math.abs(smoothThumbDelta) * SCROLL_GAIN)
          );
          smoothScrollStep = SCROLL_STEP_ALPHA * smoothScrollStep + (1 - SCROLL_STEP_ALPHA) * targetStep;

          if (scrollStableFrames >= SCROLL_STABLE_FRAMES && now - lastScrollTime >= SCROLL_COOLDOWN_MS) {
            window.scrollBy({ top: thumbDir * smoothScrollStep, behavior: 'smooth' });
            lastScrollTime = now;
          }
        } else {
          scrollStableFrames = 0;
          lastScrollDir = 0;
        }
      } else {
        scrollStableFrames = 0;
        lastScrollDir = 0;
        smoothThumbDelta = 0;
        smoothScrollStep = 0;
      }

      // Always move pointer to the index tip (smoothed)
      const rawX = landmarks[8].x * window.innerWidth;
      const rawY = landmarks[8].y * window.innerHeight;
      const clampedX = clamp(rawX, 1, window.innerWidth - 1);
      const clampedY = clamp(rawY, 1, window.innerHeight - 1);
      const deltaX = clampedX - prevX;
      const deltaY = clampedY - prevY;
      const filteredDX = Math.abs(deltaX) < NOISE_DEADZONE ? 0 : deltaX;
      const filteredDY = Math.abs(deltaY) < NOISE_DEADZONE ? 0 : deltaY;
      const smoothX = prevX + SMOOTH_ALPHA * filteredDX;
      const smoothY = prevY + SMOOTH_ALPHA * filteredDY;

      pointerEl.style.setProperty('transform', `translate(${smoothX - 13}px, ${smoothY - 13}px)`, 'important');
      pointerEl.style.setProperty('display', 'block', 'important');
      pointerEl.style.setProperty('visibility', 'visible', 'important');
      pointerEl.style.setProperty('opacity', '1', 'important');
      applyPointerColor(
        pinchStableFrames >= 2 && Math.hypot(landmarks[8].x - landmarks[12].x, landmarks[8].y - landmarks[12].y) < pinchThreshold
      );
      prevX = smoothX;
      prevY = smoothY;

      // Pinch click: index + middle together, with open/close gating to reduce false taps
      const pinchDist = Math.hypot(landmarks[8].x - landmarks[12].x, landmarks[8].y - landmarks[12].y);
      const pinchClose = pinchDist < pinchThreshold;
      const pinchOpen = pinchDist > Math.min(0.2, pinchThreshold + 0.015); // slightly easier to re-arm

      if (pinchClose) {
        pinchStableFrames += 1;
      } else {
        pinchStableFrames = 0;
      }

      if (pinchOpen) {
        pinchReady = true; // allow the next click once fingers separate enough
      }

      const pinchActive = pinchClose && pinchStableFrames >= 2; // need 2 consecutive frames closed
      const clicksSuppressed = now < suppressClicksUntil;

      if (!clicksSuppressed && pinchReady && pinchActive && handFrames >= 3 && now - lastClickTime > CLICK_COOLDOWN_MS) {
        performClickAt(smoothX, smoothY);
        lastClickTime = now;
        pinchReady = false; // wait for an open state before the next click
      }

      // Visual pinch line with stateful color (index-middle)
      ctx.beginPath();
      ctx.moveTo(landmarks[8].x * canvasEl.width, landmarks[8].y * canvasEl.height);
      ctx.lineTo(landmarks[12].x * canvasEl.width, landmarks[12].y * canvasEl.height);
      ctx.strokeStyle = pinchActive ? activeColor : baseColor;
      ctx.lineWidth = 3.5;
      ctx.stroke();
      applyPointerColor(pinchActive);

      ctx.restore();
    }

    function isFocusable(el) {
      if (!el) return false;
      const tag = (el.tagName || '').toLowerCase();
      const focusableTags = ['input', 'textarea', 'select', 'button'];
      if (focusableTags.includes(tag)) return true;
      if (el.isContentEditable) return true;
      const tabindex = el.getAttribute && el.getAttribute('tabindex');
      return tabindex !== null && tabindex !== undefined;
    }

    function performClickAt(x, y) {
      const clickX = clamp(x, 0, window.innerWidth - 1);
      const clickY = clamp(y, 0, window.innerHeight - 1);
      const target = document.elementFromPoint(clickX, clickY);
      if (!target) return;

      try {
        const opts = {
          bubbles: true,
          cancelable: true,
          view: window,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          button: 0,
          detail: 1,
        };
        const withButtons = (buttons) => ({ clientX: clickX, clientY: clickY, buttons, ...opts });

        // Hover/move into element
        target.dispatchEvent(new PointerEvent('pointerover', withButtons(0)));
        target.dispatchEvent(new PointerEvent('pointerenter', withButtons(0)));
        target.dispatchEvent(new MouseEvent('mouseover', withButtons(0)));
        target.dispatchEvent(new MouseEvent('mouseenter', withButtons(0)));
        target.dispatchEvent(new PointerEvent('pointermove', withButtons(0)));
        target.dispatchEvent(new MouseEvent('mousemove', withButtons(0)));

        // Press
        target.dispatchEvent(new PointerEvent('pointerdown', withButtons(1)));
        target.dispatchEvent(new MouseEvent('mousedown', withButtons(1)));

        // Release
        target.dispatchEvent(new PointerEvent('pointerup', withButtons(0)));
        target.dispatchEvent(new MouseEvent('mouseup', withButtons(0)));
        target.dispatchEvent(new MouseEvent('click', withButtons(0)));

        // Leave to clean hover states (helps some overlays)
        target.dispatchEvent(new MouseEvent('mouseleave', withButtons(0)));
        target.dispatchEvent(new PointerEvent('pointerleave', withButtons(0)));

        if (isFocusable(target)) {
          try {
            target.focus({ preventScroll: true });
          } catch (error) {
            try {
              target.focus();
            } catch (fallbackError) {
              console.warn('mediapipe runner: focus failed', fallbackError);
            }
          }
        }
      } catch (error) {
        try {
          target.click();
        } catch (fallbackError) {
          console.warn('click failed', fallbackError);
        }
      }
    }

    // Listen for messages from the content script to start/stop/update threshold/colors
    window.addEventListener('message', (event) => {
      if (!event || !event.data || event.data.source !== 'voidmouse-cs') return;

      if (event.data.type === 'voidmouse-start') {
        startRunner(event.data.threshold, event.data.baseColor, event.data.activeColor);
      } else if (event.data.type === 'voidmouse-stop') {
        stopRunner();
      } else if (event.data.type === 'voidmouse-threshold' && Number.isFinite(event.data.value)) {
        threshold = event.data.value;
        pinchThreshold = event.data.value;
      } else if (event.data.type === 'voidmouse-colors') {
        if (typeof event.data.baseColor === 'string') baseColor = event.data.baseColor;
        if (typeof event.data.activeColor === 'string') activeColor = event.data.activeColor;
        applyPointerColor(false);
      }
    });

    sendStatus('idle');
  } catch (err) {
    console.error('mediapipe runner failed', err);
  }
})();
