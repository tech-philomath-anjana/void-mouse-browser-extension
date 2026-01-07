// Setup Module.locateFile to point to this script's directory so loaders fetch assets from the
// extension's mediapipe/ folder. This file is injected via chrome.scripting.executeScript(files:[])
(function(){
  try{
    var s = document.currentScript;
    var base = "";
    if(s && s.src){
      base = s.src.substring(0, s.src.lastIndexOf('/')+1);
    }

    // Try to create a Trusted Types policy that is most likely to be allowed on strict pages (e.g., YouTube).
    // We attempt a few common policy names; the first successful one is reused.
    var ttPolicy = null;
    if (window.trustedTypes && window.trustedTypes.createPolicy) {
      var candidateNames = ['voidmouse', 'default', 'trusted-types-default', 'youtube#html'];
      for (var i = 0; i < candidateNames.length; i++) {
        try {
          ttPolicy = window.trustedTypes.createPolicy(candidateNames[i], {
            createHTML: function(x){ return x; },
            createScript: function(x){ return x; },
            createScriptURL: function(x){ return x; }
          });
          if (ttPolicy) break;
        } catch(e) {
          // continue trying other names
        }
      }
    }

    function asTrustedUrl(u){
      try {
        return ttPolicy && ttPolicy.createScriptURL ? ttPolicy.createScriptURL(u) : u;
      } catch(e) {
        return u;
      }
    }

    window.Module = window.Module || {};
    // Only set locateFile if not already set
    if(typeof window.Module.locateFile !== 'function'){
      window.Module.locateFile = function(path){
        return asTrustedUrl(base + path);
      };
      console.log('mediapipe: Module.locateFile set to', base);
    }
  }catch(e){
    console.error('mediapipe locatefile setup failed', e);
  }
})();
