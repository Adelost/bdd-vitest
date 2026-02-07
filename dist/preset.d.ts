import * as vite from 'vite';
import { UserConfig } from 'vitest/config';

declare function bddConfig(overrides?: UserConfig): vite.UserConfig;

export { bddConfig };
