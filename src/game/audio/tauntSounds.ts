import type { SoundType } from './sound';

// Public-source fallback: keep ordinary taunt audio playable without
// importing the separately blocked source asset.
export function tauntSoundFor(_emoji: string): SoundType {
  return 'tauntCheerful';
}
