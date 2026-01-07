// Dedicated worker that runs MediaPipe Hands under the extension origin.
// Receives ImageBitmap frames from the page (content script) and posts back
// landmarks results. This avoids page CSP because the worker is loaded from
// chrome-extension:// and can instantiate wasm under the extension CSP.

(function(){
  // derive base path for locateFile
  const base = (typeof self.location !== 'undefined' && self.location && self.location.href) ? self.location.href.substring(0, self.location.href.lastIndexOf('/')+1) : '';
  function locateFile(path){ return base + path; }

  // small logging helper
  function log(){ try{ postMessage({type:'log', args: Array.from(arguments)}); }catch(e){} }

  // Import the MediaPipe runtime (hands.js) from the same folder
  try{
    importScripts(locateFile('hands.js'));
    log('worker: imported hands.js from', locateFile('hands.js'));
  }catch(e){
    log('worker import error', e && e.message);
    throw e;
  }

  // create Hands instance inside worker
  let hands = null;
  function ensureHands(){
    if(hands) return Promise.resolve(hands);
    return new Promise(async (resolve, reject)=>{
      try{
        hands = new Hands({ locateFile: (f)=> locateFile(f) });
        hands.setOptions({ maxNumHands: 2, modelComplexity: 1, minDetectionConfidence: 0.6, minTrackingConfidence: 0.6 });
        hands.onResults((results)=>{
          // strip heavy data (image) before posting
          const out = Object.assign({}, results);
          try{ delete out.image; }catch(e){}
          // post results back to main thread
          postMessage({ type: 'results', results: out });
        });
        await hands.initialize();
        log('worker: Hands initialized');
        resolve(hands);
      }catch(err){ reject(err); }
    });
  }

  // handle incoming frames
  self.onmessage = async (e)=>{
    const msg = e.data;
    if(!msg) return;
    if(msg.type === 'frame'){
      try{
        await ensureHands();
        // msg.imageBitmap is transferred; use as-is
        await hands.send({ image: msg.imageBitmap });
        // imageBitmap will be released by main thread if transferred
      }catch(err){
        log('worker frame error', err && err.message);
      }
    } else if(msg.type === 'ping'){
      postMessage({ type: 'pong' });
    }
  };

})();
