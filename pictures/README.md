# Pictures

Sprint questions can show a photo on the TV. Drop the files in this folder (subfolders are fine):

```
pictures/
  friends/corentin.jpg
  places/lisbon.png
```

Then point a **sprint** question at the file in a draft under `drafts/`, relative to this folder:

```json
{ "prompt": "Qui est sur cette photo ?", "answer": "Corentin", "difficulty": "medium", "image": "friends/corentin.jpg" }
```

A starter set for the photos already in this folder is `drafts/pictures.json`. Import it from `/prep`.

jpg, jpeg, png, webp, and gif. On the TV the photo reveals over ~12 seconds with a random pattern: blur, big pixels, extreme close-up pulling back to normal, or a tiny far-away view zooming in to normal. A buzz freezes the reveal. Phones never receive the picture.

These files stay on this computer. They are not part of the git repo.
