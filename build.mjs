import { cpSync, rmSync } from 'node:fs';

rmSync('dist', { recursive: true, force: true });
cpSync('fixture', 'dist', { recursive: true });
console.log('positive-control: copied already-public OSD fixture into dist');
