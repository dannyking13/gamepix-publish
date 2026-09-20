# GamePix draft state reference (captured after a successful submission)

Status values seen: `edit` -> `review` (after Submit for review) -> `live` (after QA approval).

```json
{
  "assets": ["icon", "cover"],
  "authorUsername": "odoo",
  "gameNamespace": "moving-co-puzzle",
  "status": "review",
  "tags": ["puzzle"],
  "title": "Moving Co Puzzle",
  "allowDistribution": true,
  "allowEmbedding": true,
  "buildMessage": "The build is reviewable",
  "buildStatus": "ready",
  "buildUploaded": true,
  "description": "100-500 chars...",
  "desktopFriendly": true,
  "mobileFriendly": true,
  "orientation": "landscape",
  "gameEngine": "cocos",
  "sdkIntegration": true,
  "howToPlay": "Desktop\n...\n\nMobile\n...",
  "releaseNotes": "...",
  "version": "3JYvCWzohYSjTyUNfByDwlgkcfx"
}
```

GET endpoint: `https://api.gamepix.com/v3/devs/game-drafts/ns/<namespace>` (session cookies).
