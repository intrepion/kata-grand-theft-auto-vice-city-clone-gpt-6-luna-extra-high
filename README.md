# Neon Run — South Beach, 1986

A small, original third-person 3D open-world driving game: walk a pastel coastal city, borrow traffic cars, run courier jobs, and shake a police tail.

## Play

For a quick play, open `index.html` in a WebGL 2 capable browser. For source development, install the dependencies and start the local server:

```sh
npm install
npm run dev
```

Open the local URL Vite prints. To create a static production build, run `npm run build`; Vite writes it to `dist/`.

## Controls

- **WASD / arrow keys:** walk or drive
- **E:** enter the nearest car or get out
- **Space:** handbrake while driving
- **Drag on the scene:** orbit the third-person camera
- **Mouse wheel:** move the camera closer or farther
- **P:** pause
- **New Run:** restart from the opening block

Find the pink beacon, collect the envelope, and deliver it to the next neighborhood for cash. Crashing at speed draws police attention. Break line of sight and keep moving until your heat fades.

The city, character, and vehicle models are built from original Three.js geometry. There are no bundled image assets; optional Google Fonts fall back to system fonts when unavailable.
