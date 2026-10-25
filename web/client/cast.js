/* cast.js: the village's people (item 45). Plain JavaScript, no React.
 *
 *   CAST[id]                         → { name, role, look, outfit, child, note }
 *   castSvg(id, { pose, theme })      → '<svg …>' full body, 200×320, standing on the bottom edge
 *
 * Built on character_kit.js, so every one of them can be dressed in any outfit and any theme, and
 * the avatar maker edits them like anyone else. Nimrod the cat is an image from assets/nimrod-cat/. */
import { figureSvg, OUTFITS } from './character_kit.js';

const SUIT = { king: ['hearts', '#b03a2e'], queen: ['diamonds', '#b03a2e'], jack: ['clubs', '#1b1d22'], joker: ['spades', '#1b1d22'] };

export const CAST = {
  kenny: { name: 'King Kenny', role: 'king', outfit: 'royal', look: { tone: '#e8b48a', hair: 'short', hairColor: '#8a4a24', beard: true }, note: 'Kind, a bit forgetful, loves a good feast.' },
  rose: { name: 'Queen Rose', role: 'queen', outfit: 'royal', look: { tone: '#f3c9a6', hair: 'bun', hairColor: '#c96a21' }, note: 'Runs the castle and the garden, and knows everyone by name.' },
  jack: { name: 'Jack', role: 'jack', outfit: 'royal', look: { tone: '#8a5a3a', hair: 'curly', hairColor: '#1b1410' }, note: 'The castle helper. Fixes anything.' },
  robin: { name: 'Robin the Joker', role: 'joker', outfit: 'royal', look: { tone: '#f6dcc4', hair: 'short', hairColor: '#c96a21' }, note: 'Jokes, riddles and the odd magic trick.' },
  jess: { name: 'Princess Jess', child: true, outfit: 'princessDress', look: { tone: '#d9a07a', hair: 'ponytail', hairColor: '#3a2414' }, note: 'Small, curious, and full of questions. The player teaches her.' },
  vince: { name: 'Prince Vince', child: true, outfit: 'princeTunic', look: { tone: '#f3c9a6', hair: 'short', hairColor: '#d9b46a' }, note: 'Small and brave, and wants to be a knight. The player teaches him.' },
  merlin: { name: 'Merlin', outfit: 'wizardRobe', look: { tone: '#e8b48a', hair: 'long', hairColor: '#e8dcc0', beard: true, glasses: true }, note: 'The wizard in the crooked tower.' },
  michael: { name: 'Michael', outfit: 'knightBlue', look: { tone: '#c98a5a', hair: 'short', hairColor: '#1b1410' }, note: 'A knight. Gentle, and very tall.' },
  gladys: { name: 'Gladys', outfit: 'knightRed', look: { tone: '#f3c9a6', hair: 'ponytail', hairColor: '#9e5449' }, note: 'A knight. Fearless, and the best rider in the land.' },
  baker: { name: 'Bess the baker', villager: true, outfit: 'bakerWhites', look: { tone: '#e8b48a', hair: 'bun', hairColor: '#5a3a24' }, note: 'Bakes the bread. Counts loaves, eggs and cups of flour.' },
  shopkeeper: { name: 'Sam the shopkeeper', villager: true, outfit: 'shopkeeperVest', look: { tone: '#8a5a3a', hair: 'short', hairColor: '#1b1410', beard: true }, note: 'Runs the market stall. Counts coins and weighs things on the scale.' },
  blacksmith: { name: 'Bram the blacksmith', villager: true, outfit: 'blacksmithApron', look: { tone: '#c98a5a', hair: 'bald', hairColor: '#3a2414', beard: true }, note: 'Makes horseshoes and keys. Strong and patient.' },
  farmer: { name: 'Fern the farmer', villager: true, outfit: 'farmerSmock', look: { tone: '#f3c9a6', hair: 'ponytail', hairColor: '#c96a21' }, note: 'Brings apples, eggs and sacks of grain to market.' },
  librarian: { name: 'Lewis the librarian', villager: true, outfit: 'librarianRobe', look: { tone: '#e8b48a', hair: 'short', hairColor: '#c9cfd8', glasses: true }, note: 'Keeps the books and the letter tiles. Helps with spelling.' },
  player: { name: 'You', player: true, outfit: 'medievalTunic', look: { tone: '#e8b48a', hair: 'short', hairColor: '#3a2414' }, note: 'The person playing, drawn from their avatar.' },
  nimrod: { name: 'Nimrod', cat: true, note: 'The cat. Explains things and points at them.' },
};
export const CAST_IDS = Object.keys(CAST);

/* The player is drawn from their own avatar: pass `look` (and `outfit`) from the avatar maker, or
   the scene item carries them. Without one, a plain stand-in is drawn. */
export function castSvg(id, { pose = 'stand', outfit, look, assetBase = '../../assets/' } = {}) {
  const p = id === 'player' && look ? { ...CAST.player, look } : CAST[id];
  if (!p) return '';
  if (p.cat) {
    const file = { stand: 'idle', wave: 'wave', talk: 'talking', think: 'thinking', happy: 'happy', sleep: 'sleeping', point: 'point-right', listen: 'idle' }[pose] || 'idle';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 320" role="img" aria-label="Nimrod the cat"><image href="${assetBase}nimrod-cat/${file}.svg" x="20" y="150" width="170" height="170"/></svg>`;
  }
  const [suit, suitColor] = SUIT[p.role] || [];
  return figureSvg(p.look, { outfit: outfit && OUTFITS[outfit] ? outfit : p.outfit, role: pose === 'stand' ? p.role : null, suit, suitColor, pose, child: !!p.child }, p.name);
}
