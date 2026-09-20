# GamePix SDK v3 cheatsheet (official doc digest)

## Import (MANDATORY, first script in <head>)
```html
<script src="https://integration.gamepix.com/sdk/v3/gamepix.sdk.js"></script>
```

## Rules before integrating
- Keep final game size as small as possible
- All assets with relative paths (no external resources)
- No third-party analytics (GamePix provides metrics)
- No external links of any kind
- No window.alert / window.confirm
- Pause the game (incl. audio) when the user switches tab

## API

### GamePix.loading(pct) / GamePix.loaded()
- loading: number 0..100 during load
- loaded: call ONCE when playable; MUST precede any other SDK method
- Errors: LOADING_VALUE_IS_NOT_A_NUMBER, LOADED_ALREADY_CALLED, GAMEPIX_LOADED_NOT_CALLED

### GamePix.localStorage
- setItem(key, value), getItem(key), removeItem(key) — strings only
- Replaces native localStorage (iframe purging on mobile)
- Error: KEY_OR_VALUE_FOR_LOCALSTORAGE_NOT_A_STRING

### GamePix.interstitialAd()
- Returns Promise; PAUSE game before, RESUME in .then()
- Call freely between levels — fill decided server-side; never timer-based; one at a time
- Errors: GAMEPIX_LOADED_NOT_CALLED, INTERSTITIAL_AD_CALLED_TWICE

### GamePix.rewardAd()
- Promise => res.success true if watched; disclose reward; user can skip
- Errors: GAMEPIX_LOADED_NOT_CALLED, REWARD_AD_CALLED_TWICE

### GamePix.updateScore(n) / GamePix.updateLevel(n)
- Positive integers only, on every change
- Errors: UPDATE_SCORE_VALUE_IS_NOT_A_NUMBER / UPDATE_LEVEL_VALUE_IS_NOT_A_NUMBER

### GamePix.lang()
- Returns: ar, zh, nl, en, fr, de, it, ja, ko, pl, pt, ru, es, tr — default to English

### GamePix.happyMoment()
- Call on unlocks/achievements/cool events

## Anti-scroll
```js
window.addEventListener("keydown", e => { if (["ArrowUp","ArrowDown"," "].includes(e.key)) e.preventDefault(); });
window.addEventListener("wheel", e => e.preventDefault(), { passive: false });
```

## Minimal integration example
```html
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=NO">
  <script src="https://integration.gamepix.com/sdk/v3/gamepix.sdk.js"></script>
  <style>body{margin:0;touch-action:none;-ms-touch-action:none;}</style>
</head>
<body>
  <canvas id="game"></canvas>
  <script>
    GamePix.loading(50);
    // ... boot game ...
    GamePix.loading(100);
    GamePix.loaded();

    // level end:
    function levelEnded(score, level) {
      GamePix.updateScore(score);
      GamePix.updateLevel(level);
      pauseGameAndAudio();
      GamePix.interstitialAd().then(function (res) {
        resumeGameAndAudio();
        if (res.success) { /* ad watched */ }
      });
    }
  </script>
</body>
</html>
```
