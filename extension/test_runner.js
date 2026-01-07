// Test runner for extension/test.html — moved out of inline to satisfy CSP
(function(){
  const startBtn = document.getElementById('start');
  const statusEl = document.getElementById('status');
  const videoEl = document.getElementById('video');
  const canvasEl = document.getElementById('canvas');
  const ctx = canvasEl.getContext('2d');

  function locateFile(file){
    return chrome.runtime.getURL('mediapipe/' + file);
  }

  // quick diagnostic: print locateFile targets so you can verify URLs in console
  console.log('test_runner locateFile hand_landmark_full.tflite ->', locateFile('hand_landmark_full.tflite'));
  console.log('test_runner locateFile wasm ->', locateFile('hands_solution_wasm_bin.wasm'));

  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const s=document.createElement('script');
      s.src=src;
      s.onload=()=>resolve();
      s.onerror=(e)=>reject(e);
      document.head.appendChild(s);
    });
  }

  startBtn.addEventListener('click', async ()=>{
    statusEl.textContent = 'loading hands.js';
    try{
      await loadScript(locateFile('hands.js'));
    }catch(e){
      statusEl.textContent = 'failed to load hands.js';
      console.error('load error', e);
      return;
    }

    if(typeof Hands === 'undefined'){
      statusEl.textContent = 'Hands not available after load';
      console.error('Hands missing');
      return;
    }

    statusEl.textContent = 'initializing Hands';

    const hands = new Hands({ locateFile: (f) => locateFile(f) });
    // expose instance for DevTools inspection and add lightweight per-frame logging
    window.hands = hands;
    console.log('test_runner: Hands instance created and exposed as window.hands');
    hands.setOptions({ maxNumHands: 1, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
    hands.onResults((results)=>{
      // log landmark count and first coordinate for quick verification
      const count = (results.multiHandLandmarks && results.multiHandLandmarks.length) || 0;
      console.log('test_runner onResults: multiHandLandmarks count =', count);
      if(count && results.multiHandLandmarks[0] && results.multiHandLandmarks[0][0]){
        console.log('test_runner first landmark:', results.multiHandLandmarks[0][0]);
      }
      ctx.clearRect(0,0,canvasEl.width,canvasEl.height);
      try{ ctx.drawImage(results.image,0,0,canvasEl.width,canvasEl.height);}catch(e){}
      const lm = (results.multiHandLandmarks && results.multiHandLandmarks[0]) || null;
      if(!lm) return;
      for(const p of lm){
        ctx.beginPath(); ctx.fillStyle='rgba(255,200,0,0.9)'; ctx.arc(p.x*canvasEl.width,p.y*canvasEl.height,4,0,Math.PI*2); ctx.fill();
      }
    });

    try{
      const stream = await navigator.mediaDevices.getUserMedia({ video:{width:640,height:480}, audio:false });
      videoEl.srcObject = stream;
      await new Promise(r=> videoEl.onloadedmetadata = r);
      canvasEl.width = videoEl.videoWidth; canvasEl.height = videoEl.videoHeight;
      statusEl.textContent = 'running';

      async function loop(){
        if(videoEl.readyState >= 2) await hands.send({ image: videoEl });
        requestAnimationFrame(loop);
      }
      loop();
    }catch(e){
      statusEl.textContent = 'camera error';
      console.error('camera start error', e);
    }
  });
})();
