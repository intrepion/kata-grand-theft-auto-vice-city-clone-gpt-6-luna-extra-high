import { copyFile } from 'node:fs/promises';

await copyFile(new URL('../game.bundle.js', import.meta.url), new URL('../dist/game.bundle.js', import.meta.url));
