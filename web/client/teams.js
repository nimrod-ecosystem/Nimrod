// teams.js — TEAMS, LIKE A PARTY GAME'S: who is on which side, whose turn it is, and the score per side (row 2.220,
// note FE 3; docs proposal_teams_beatmaps_20261106, gated GO WITH CHANGES).
//
// A TEAM IS A FIELD ON A SEAT (player_picker.js `team`, 1 to TEAMS_MAX), carried through to each player
// (adaptive_play.js resolvePlayers). Nothing else stores teams. A screen whose seats have no teams plays exactly as
// before: every helper here answers "no teams" and a game does what it always did.
//
// THE DEFAULT, "THE TEAM IS ONE SEAT" (the gate's suggestion, Mike's to confirm; on his list): on a team's turn any member may
// answer for it. FOR: the wait between turns stays what it is now, and a team of three does not play three times as often
// as a player alone. The other way, "each member takes a turn", is `memberTurns: true`.
// TURNS ALTERNATE BETWEEN TEAMS (red, blue, red, blue), never two in a row for one team, WITHOUT changing a player's
// `index` (points and colours key off it; index 0 is the screen's person). Empty teams are skipped.
// NAMES: "Team 1" with a colour AND a shape, never only a colour word (the gate: a colour alone is lost on somebody who
// cannot tell them apart).

import { TEAMS_MAX } from './player_picker.js';

export { TEAMS_MAX };
export const TEAM_LOOKS = Object.freeze([
  Object.freeze({ team: 1, name: 'Team 1', colour: '#2b6cb0', shape: 'circle', mark: '●' }),
  Object.freeze({ team: 2, name: 'Team 2', colour: '#c05621', shape: 'square', mark: '■' }),
  Object.freeze({ team: 3, name: 'Team 3', colour: '#2f855a', shape: 'triangle', mark: '▲' }),
  Object.freeze({ team: 4, name: 'Team 4', colour: '#805ad5', shape: 'diamond', mark: '◆' }),
]);
export const teamLook = (t) => TEAM_LOOKS.find((x) => x.team === Number(t)) || null;

/** Does any player have a team? PURE. */
export const hasTeams = (players) => (players || []).some((p) => p && Number.isInteger(p.team));

/**
 * The teams in play, each with its players, in team order; players with no team are a side of their own each
 * ("plays for themself"). `[{ team, name, look, players }]`, empty teams left out. PURE.
 */
export function teamsOf(players) {
  const list = (players || []).filter(Boolean);
  if (!hasTeams(list)) return [];
  const by = new Map();
  for (const p of list) {
    const key = Number.isInteger(p.team) ? `t${p.team}` : `p${p.id}`;
    if (!by.has(key)) by.set(key, { team: Number.isInteger(p.team) ? p.team : null, name: Number.isInteger(p.team) ? teamLook(p.team).name : p.name, look: teamLook(p.team), players: [] });
    by.get(key).players.push(p);
  }
  return [...by.values()].sort((a, b) => (a.team ?? 99) - (b.team ?? 99));
}

/**
 * The turn order: each entry is the players whose turn it is. Without teams: one player a turn, in seat order (today).
 * With teams: the teams take turns; "the team is one seat" (default) gives each turn to the whole team; `memberTurns`
 * walks each team's members in turn, so team 1's first, team 2's first, team 1's second... PURE.
 */
export function turnOrder(players, { memberTurns = false } = {}) {
  const list = (players || []).filter(Boolean);
  const teams = teamsOf(list);
  if (!teams.length) return list.map((p) => [p]);
  if (!memberTurns) return teams.map((t) => [...t.players]);
  const longest = Math.max(...teams.map((t) => t.players.length));
  const out = [];
  for (let i = 0; i < longest; i += 1) for (const t of teams) out.push([t.players[i % t.players.length]]);
  return out;
}

/** A tally by player id ({ id: count }) summed per team: `[{ team, name, look, score }]`. PURE. */
export function teamTally(tally, players) {
  return teamsOf(players).map((t) => ({ team: t.team, name: t.name, look: t.look,
    score: t.players.reduce((n, p) => n + (Number(tally?.[p.id]) || 0), 0) }));
}

/** "Team 1 ● 5 · Team 2 ■ 3": the score line, or '' with no teams. PURE. */
export function scoreLine(tally, players) {
  return teamTally(tally, players).map((t) => `${t.name}${t.look ? ` ${t.look.mark}` : ''} ${t.score}`).join(' · ');
}

/** Deal the seats evenly into `n` teams (the picker's "Deal evenly", one press): seat 1 to team 1, seat 2 to team 2... PURE. */
export function dealEvenly(seats, n = 2) {
  const k = Math.max(2, Math.min(TEAMS_MAX, Math.floor(Number(n)) || 2));
  return (seats || []).map((s, i) => ({ ...s, team: (i % k) + 1 }));
}
