# Avalanche Mancala

A browser-based, GamePigeon-style **Avalanche Mancala** game. Play pass-and-play
on one device, or challenge a friend online with a shareable room code. Built
with plain HTML, CSS, and JavaScript — no frameworks, no build step.

## Features

- 6 pits per side, 4 stones each, two stores
- **Avalanche rule**: landing your last stone in a non-empty pit scoops it up
  and keeps sowing, relay-style
- Extra turn when your last stone lands in your own store
- **GamePigeon-style capture**: landing your last stone in an *empty* pit on
  your own side captures that stone plus everything in the opposite pit
- Automatic end-of-game sweep when one side runs out of stones
- Smooth, step-by-step sowing animation (including the avalanche "tumble")
- Responsive, mobile-first UI styled like a wooden game table
- Room-code multiplayer over Firebase Firestore, with realtime sync,
  reconnect support, and a rematch flow
- Installable PWA (manifest + service worker, offline app shell)

## File overview

| File              | Purpose                                                        |
|-------------------|------------------------------------------------------------------|
| `index.html`      | App markup / screens                                            |
| `style.css`       | All styling, layout, and animations                             |
| `game.js`         | Pure game rules engine (no DOM, no Firebase) — sowing, avalanche, captures, win detection |
| `app.js`          | UI controller: rendering, animation playback, screen flow, wires game.js + multiplayer.js to the DOM |
| `firebase.js`     | Firebase app/Firestore initialization (config placeholders live here) |
| `multiplayer.js`  | Room creation/joining, realtime listeners, move transactions, rematch, reconnect |
| `manifest.json`   | PWA manifest |
| `sw.js`           | Service worker (app-shell caching for offline use) |
| `icons/`          | App icons for the manifest / home-screen install |

## Running locally

Because `app.js` and friends are loaded as ES modules, you need to serve the
files over HTTP (not `file://`). Any static server works, for example:

```bash
# Python
python3 -m http.server 8080

# Node (if you have it)
npx serve .
```

Then open `http://localhost:8080`. **Local (pass-and-play) mode works with
zero setup.** Online mode requires a Firebase project (see below).

## Setting up Firebase (for online multiplayer)

1. Go to the [Firebase console](https://console.firebase.google.com/) and
   create a new project (or reuse an existing one).
2. In the project, click the **`</>`** (Web app) icon to register a web app.
   Firebase will show you a config object — copy it.
3. In the left sidebar, go to **Build → Firestore Database → Create
   database**. Start in test mode for development.
4. Open `firebase.js` in this project and paste your values into
   `firebaseConfig`:

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abcdef123456",
   };
   ```

5. Reload the app. The "Online play needs Firebase configured" warning
   should disappear, and **Create Room** / **Join Room** will work.

### Recommended Firestore security rules

Test mode rules are wide open — fine for development, not for production.
Once you're ready to lock things down, a reasonable starting point (given
the app doesn't use Firebase Auth and identifies players by a random client
id) is to allow reads/writes to `rooms/*` but keep documents from being
deleted or arbitrarily re-typed:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /rooms/{roomCode} {
      allow read: if true;
      allow create: if request.resource.data.keys().hasAll(
        ['board', 'currentPlayer', 'players', 'status']
      );
      allow update: if resource.data.status != 'deleted';
      allow delete: if false;
    }
  }
}
```

For a hardened production setup, consider adding Firebase Anonymous Auth so
`request.auth.uid` can be checked against the `players.p1.id` /
`players.p2.id` fields instead of trusting the client-generated id used in
this demo.

## Deploying to GitHub Pages

1. Push this project to a GitHub repository (all files at the repo root, or
   inside a `/docs` folder — either works).
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to "Deploy from a branch".
4. Choose your branch (e.g. `main`) and the folder (`/ (root)` or `/docs`,
   matching where you put the files).
5. Save. GitHub will publish the site at
   `https://<your-username>.github.io/<repo-name>/`.
6. **Before pushing**, make sure `firebase.js` contains your real Firebase
   config (see above) if you want online multiplayer to work on the
   published site — GitHub Pages only serves static files, so your Firebase
   project is what actually powers realtime sync.
7. Because the service worker (`sw.js`) is scoped to the folder it's served
   from, no changes are needed as long as `sw.js` sits next to `index.html`
   in the published folder.

Once deployed, open the Pages URL, tap **Play Online**, and share the room
code with a friend on another device — they'll join the same room and moves
will sync in real time.

## How to play

- Tap one of your own pits to pick it up. Stones drop one at a time into
  each following pit going counter-clockwise around the board.
- If your **last stone** lands in a pit that already has stones in it
  (yours or your opponent's), that whole pit gets picked up and sowing
  continues — this is the avalanche.
- If your last stone lands in your own **store**, you get another turn.
- If your last stone lands in an **empty pit on your own side**, and the
  pit directly opposite has stones, you capture both into your store.
- Otherwise, the turn simply passes.
- When one player has no stones left on their side, the game ends and
  the other player sweeps all their remaining stones into their store.
  Whoever has the most stones in their store wins.

## Notes on the multiplayer design

Rather than transmitting every animation frame over the network, each move
is deterministic given the board state and the chosen pit. `multiplayer.js`
runs a Firestore transaction that re-derives the authoritative result using
the same `simulateMove` function from `game.js`. Both clients then replay
that same simulation locally purely for animation purposes, and finally
snap to the server-confirmed board to guarantee both players always agree
on the true game state — even after a dropped connection or a page reload
(session/reconnect info is kept in `localStorage`).

## License

Feel free to use, modify, and deploy this project for personal or
educational purposes.
