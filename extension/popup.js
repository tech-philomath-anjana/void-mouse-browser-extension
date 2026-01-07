document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('toggle');
  const previewBtn = document.getElementById('preview-toggle');
  const thresholdEl = document.getElementById('threshold');
  const thresholdValue = document.getElementById('threshold-value');
  const statusRow = document.getElementById('status');
  const cameraStatus = document.getElementById('camera-status');
  const resetBtn = document.getElementById('reset');
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const sections = { settings: document.getElementById('settings'), guide: document.getElementById('guide') };
  const cursorColorEl = document.getElementById('cursor-color');
  const clickColorEl = document.getElementById('click-color');

  const CURSOR_COLOR_KEY = 'voidmouse_cursor_color';
  const CLICK_COLOR_KEY = 'voidmouse_click_color';
  const storage = chrome.storage?.local;

  const withActiveTab = (cb) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabList) => {
      cb(tabList?.length ? tabList[0] : null);
    });
  };

  const injectContentScript = (tabId, cb) => {
    chrome.scripting.executeScript({ target: { tabId }, files: ['content_script.js'] }, () => {
      if (chrome.runtime.lastError) cb?.({ ok: false, error: chrome.runtime.lastError.message });
      else cb?.({ ok: true });
    });
  };

  const sendToTab = (msg, cb) => {
    withActiveTab((tab) => {
      if (!tab?.id) {
        cb?.({ ok: false, error: 'No active tab' });
        return;
      }

      const retry = () =>
        injectContentScript(tab.id, (result) => {
          if (!result.ok) {
            cb?.({ ok: false, error: result.error || 'Inject failed' });
            return;
          }
          chrome.tabs.sendMessage(tab.id, msg, (resp) => {
            if (chrome.runtime.lastError) cb?.({ ok: false, error: chrome.runtime.lastError.message });
            else cb?.(resp || { ok: false, error: 'No response' });
          });
        });

      chrome.tabs.sendMessage(tab.id, msg, (resp) => {
        if (chrome.runtime.lastError || !resp) retry();
        else cb?.(resp);
      });
    });
  };

  const setStatus = (running, message) => {
    if (!statusRow) return;
    const label = statusRow.querySelector('strong');
    if (label) label.textContent = message || (running ? 'Running' : 'Idle');
    const dot = statusRow.querySelector('.dot');
    if (dot) dot.style.background = running ? 'var(--success)' : '#9ca3af';
  };

  const setToggle = (btn, on) => {
    if (!btn) return;
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  };

  const refreshStatus = () => {
    sendToTab({ type: 'voidmouse-status' }, (resp) => {
      if (!resp?.ok) {
        setStatus(false, 'Not ready');
        if (cameraStatus) cameraStatus.textContent = 'Unavailable on this page';
        setToggle(toggleBtn, false);
        setToggle(previewBtn, false);
        return;
      }

      const { running, threshold, previewHidden, baseColor, activeColor } = resp;
      setStatus(running);
      setToggle(toggleBtn, !!running);
      setToggle(previewBtn, !previewHidden);

      if (typeof threshold === 'number') {
        thresholdEl.value = threshold;
        if (thresholdValue) thresholdValue.textContent = Number(threshold).toFixed(2);
      }

      if (baseColor && cursorColorEl) cursorColorEl.value = baseColor;
      if (activeColor && clickColorEl) clickColorEl.value = activeColor;
      if (cameraStatus) cameraStatus.textContent = 'Granted';
    });
  };

  tabs.forEach((tabEl) => {
    tabEl.addEventListener('click', () => {
      tabs.forEach((el) => el.classList.remove('active'));
      tabEl.classList.add('active');
      const target = tabEl.dataset.tab;
      Object.keys(sections).forEach((key) => {
        sections[key].classList.toggle('active', key === target);
      });
    });
  });

  toggleBtn?.addEventListener('click', () => {
    const nextState = !toggleBtn.classList.contains('on');
    const action = nextState ? 'voidmouse-start' : 'voidmouse-stop';
    setToggle(toggleBtn, nextState); // optimistic UI
    sendToTab({ type: action }, (resp) => {
      if (resp?.ok === false) {
        setStatus(false, 'Not ready');
        setToggle(toggleBtn, !nextState); // revert
      }
      refreshStatus();
    });
  });

  previewBtn?.addEventListener('click', () => {
    const nextShow = !previewBtn.classList.contains('on');
    setToggle(previewBtn, nextShow);
    sendToTab({ type: 'voidmouse-preview-toggle', hidden: !nextShow }, (resp) => {
      if (resp?.ok === false) setToggle(previewBtn, !nextShow);
      refreshStatus();
    });
  });

  thresholdEl?.addEventListener('input', () => {
    const val = parseFloat(thresholdEl.value || '0.05');
    if (!Number.isFinite(val)) return;
    if (thresholdValue) thresholdValue.textContent = val.toFixed(2);
    sendToTab({ type: 'voidmouse-threshold', value: val }, (resp) => {
      if (resp?.ok === false) setStatus(false, 'Not ready');
    });
  });

  const sendColors = (baseColor, clickColor) => {
    sendToTab({ type: 'voidmouse-colors', baseColor, activeColor: clickColor }, (resp) => {
      if (resp?.ok === false) setStatus(false, 'Not ready');
    });
  };

  cursorColorEl?.addEventListener('input', () => {
    const base = cursorColorEl.value || '#00c8ff';
    const active = (clickColorEl && clickColorEl.value) || '#ff5f5f';
    storage?.set({ [CURSOR_COLOR_KEY]: base });
    sendColors(base, active);
  });

  clickColorEl?.addEventListener('input', () => {
    const base = (cursorColorEl && cursorColorEl.value) || '#00c8ff';
    const active = clickColorEl.value || '#ff5f5f';
    storage?.set({ [CLICK_COLOR_KEY]: active });
    sendColors(base, active);
  });

  resetBtn?.addEventListener('click', () => {
    const defaults = 0.05;
    thresholdEl.value = defaults;
    if (thresholdValue) thresholdValue.textContent = defaults.toFixed(2);
    sendToTab({ type: 'voidmouse-threshold', value: defaults }, () => refreshStatus());
    sendToTab({ type: 'voidmouse-preview-toggle', hidden: false }, () => refreshStatus());

    if (cursorColorEl) cursorColorEl.value = '#00c8ff';
    if (clickColorEl) clickColorEl.value = '#ff5f5f';
    storage?.set({ [CURSOR_COLOR_KEY]: '#00c8ff', [CLICK_COLOR_KEY]: '#ff5f5f' });
    sendColors('#00c8ff', '#ff5f5f');
  });

  storage?.get([CURSOR_COLOR_KEY, CLICK_COLOR_KEY], (res) => {
    const base = res?.[CURSOR_COLOR_KEY] || '#00c8ff';
    const active = res?.[CLICK_COLOR_KEY] || '#ff5f5f';
    if (cursorColorEl) cursorColorEl.value = base;
    if (clickColorEl) clickColorEl.value = active;
    sendColors(base, active);
  });

  refreshStatus();
});
