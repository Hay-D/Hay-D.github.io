import { storage } from './core.js';

import { playerLevel } from './editor-core.js';

const eventName = 'hayday-preferences';

export function readPreferences() {
  return storage.get('settings', {});
}

export function writePreferences(patch) {
  const next = {
    ...readPreferences(),
    ...patch
  };
  if (!storage.set('settings', next)) return false;
  window.dispatchEvent(new CustomEvent(eventName, {
    detail: next
  }));
  return true;
}

export function setGlobalLevel(value) {
  const level = playerLevel(value);
  if (!writePreferences({
    level: level
  })) throw new Error('Could not save your level on this device');
  return level;
}

export function onPreferencesChange(callback) {
  const local = event => callback(event.detail);
  const remote = event => {
    if (event.key === 'hayday.settings') callback(readPreferences());
  };
  window.addEventListener(eventName, local);
  window.addEventListener('storage', remote);
  return () => {
    window.removeEventListener(eventName, local);
    window.removeEventListener('storage', remote);
  };
}
