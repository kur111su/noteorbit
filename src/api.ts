import type { GalaxyAPI } from './domain';
import { demoAPI } from './demo';
export const api: GalaxyAPI = window.galaxy ?? demoAPI;
