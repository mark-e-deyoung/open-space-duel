export interface PlayerIdentity {
  id: string;
  callSign: string;
}

const ADJECTIVES = [
  'Red', 'Blue', 'Neon', 'Dark', 'Silent', 'Fast', 'Clown', 'Space', 'Star',
  'Nova', 'Cosmic', 'Solar', 'Lunar', 'Void', 'Phantom', 'Ghost', 'Iron',
  'Steel', 'Plasma', 'Quantum', 'Cyber', 'Astro', 'Omega', 'Zero', 'Alpha'
];

const NOUNS = [
  'Mustang', 'Burger', 'Pilot', 'Eagle', 'Falcon', 'Viper', 'Wolf', 'Bear',
  'Tiger', 'Dragon', 'Shark', 'Hawk', 'Raven', 'Fox', 'Lynx', 'Comet',
  'Meteor', 'Pulsar', 'Quasar', 'Nebula', 'Galaxy', 'Nomad', 'Drifter'
];

const LEET_MAP: Record<string, string> = {
  'a': '4', 'A': '4',
  'e': '3', 'E': '3',
  'i': '1', 'I': '1',
  'o': '0', 'O': '0',
  's': '5', 'S': '5',
  't': '7', 'T': '7',
  'l': '1', 'L': '1',
  'b': '8', 'B': '8'
};

function applyLeetSpeak(text: string): string {
  // 50% chance to apply leet speak to a word to keep it readable but unique
  return text.split('').map(char => {
    if (LEET_MAP[char] && Math.random() > 0.6) {
      return LEET_MAP[char];
    }
    return char;
  }).join('');
}

function generateCallSign(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  const base = `${adj} ${noun}`;
  const leet = applyLeetSpeak(base);
  return leet.substring(0, 20); // Keep within 20 chars limit
}

export function getPlayerIdentity(): PlayerIdentity {
  let id = localStorage.getItem('osd_player_id');
  let callSign = localStorage.getItem('osd_player_callsign');

  if (!id) {
    id = Math.random().toString(36).substring(2, 15);
    localStorage.setItem('osd_player_id', id);
  }

  if (!callSign) {
    callSign = generateCallSign();
    localStorage.setItem('osd_player_callsign', callSign);
  }

  return { id, callSign };
}

export function regenerateCallSign(): string {
  const newCallSign = generateCallSign();
  localStorage.setItem('osd_player_callsign', newCallSign);
  return newCallSign;
}
