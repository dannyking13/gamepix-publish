/*
 * game-driver.js — GamePix bridge for Construct 3 games expecting a PokiSDK surface.
 * Maps the game's ad/lifecycle calls onto the GamePix SDK so ads actually serve:
 *   PokiSDK.commercialBreak() -> GamePix.interstitialAd()
 *   PokiSDK.rewardedBreak()   -> GamePix.rewardAd()
 *   PokiSDK.gameLoadingProgress/Finished -> GamePix.loading()/loaded()
 *   PokiSDK.happyTime()       -> GamePix.happyMoment()
 * Loaded FIRST in <head>, before any game script.
 */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.PokiSDK && window.PokiSDK.__gpxBridge) return;

  function gpx() { return (typeof window.GamePix === 'object' && window.GamePix) || null; }
  function markLoaded() {
    var g = gpx();
    if (!g) return;
    try {
      if (!window.GamePix._loadedDone) {
        window.GamePix._loadedDone = 1;
        if (typeof g.loading === 'function') { try { g.loading(100); } catch (e) {} }
        if (typeof g.loaded === 'function') g.loaded();
      }
    } catch (e) {}
  }
  function setProgress(p) {
    var g = gpx(); if (!g || typeof g.loading !== 'function') return;
    var v = Number(p); if (!isFinite(v)) return;
    v = Math.max(0, Math.min(99, Math.floor(v)));
    try { g.loading(v); } catch (e) {}
  }

  var bridge = {
    __gpxBridge: true,

    init: function () { return Promise.resolve(); },
    setDebug: function () {},
    setLogCloudflare: function () {},
    debug: function () {},

    gameLoadingStart: function () { setProgress(1); },
    gameLoadingProgress: function (p) { setProgress(p); },
    gameLoadingFinished: function () { markLoaded(); },

    gameplayStart: function () {},
    gameplayStop: function () {},

    /* Interstitial: pause is handled by the game itself during the break. */
    commercialBreak: function () {
      return new Promise(function (resolve) {
        var done = false;
        var fin = function () { if (!done) { done = true; resolve(); } };
        var g = gpx();
        try {
          if (g && typeof g.interstitialAd === 'function') {
            g.interstitialAd().then(fin, fin);
          } else fin();
        } catch (e) { fin(); }
        setTimeout(fin, 25000); // never freeze gameplay if the promise hangs
      });
    },

    /* Rewarded: resolve({success:true}) only when the ad was fully watched. */
    rewardedBreak: function () {
      return new Promise(function (resolve) {
        var done = false;
        var fin = function (ok) { if (!done) { done = true; resolve({ success: !!ok }); } };
        var g = gpx();
        try {
          if (g && typeof g.rewardAd === 'function') {
            g.rewardAd().then(function (res) { fin(!!(res && res.success)); }, function () { fin(false); });
          } else fin(false);
        } catch (e) { fin(false); }
        setTimeout(function () { fin(false); }, 60000);
      });
    },

    happyTime: function () {
      var g = gpx();
      try { if (g && typeof g.happyMoment === 'function') g.happyMoment(); } catch (e) {}
    },

    customEvent: function () {},
    logEvent: function () {},
    shareableURL: function () { return Promise.resolve({ url: location.href }); },
    sendClientEvent: function () {},
  };

  window.PokiSDK = bridge;
  window.PokiHasInitialised = true;
  if (!window.PokiSDK_InitOK) window.PokiSDK_InitOK = true;

  window.addEventListener('unhandledrejection', function (e) {
    if (e && e.reason && /poki|gamepix/i.test(String((e.reason && e.reason.message) || ''))) e.preventDefault();
  });
})();
