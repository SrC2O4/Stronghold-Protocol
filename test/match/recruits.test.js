import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, checkInvariants } from './harness.js';
import { checkLoadout } from '../../shared/protocol.js';
import { sanitizeEntries, setChoice, parseStored, toStored } from '../../public/js/ui/loadoutModel.js';
import { GameData } from '../../server/match/gamedata.js';
import { SharedPool } from '../../server/match/pool.js';
import { PHASE } from '../../shared/constants.js';
import { makeBattle } from '../helpers/battleHarness.js';

const lookup = (id) => DATA.chess[id];
const candidates = Object.values(DATA.chess).filter((c) => c.recruit && !c.isGolden);
const id = (tier, char) => `recruit_${tier}_${char}_a`;
const kalts = id(5, 'char_003_kalts');
const pick = (key) => ({ [key]: { skill: lookup(key).skill.index } });

test('every recruit has both tiers, elite stats and valid default loadouts', () => {
  const chars = new Set(candidates.map((c) => c.charId));
  assert.ok(chars.size > 100);
  for (const char of chars) for (const tier of [5, 6]) {
    const c = lookup(id(tier, char));
    assert.equal(c.rarity, 6);
    assert.equal(c.visible, false, 'not automatically in the preset pool');
    assert.ok(lookup(c.goldenId).stats.maxHp > 0);
    const checked = checkLoadout(pick(c.chessId), lookup);
    if (c.recruitPresetId) {
      assert.equal(checked.error, 'BAD_TARGET', 'preset operators cannot be recruited again');
      assert.deepEqual(sanitizeEntries(pick(c.chessId), lookup), {}, 'old duplicate selections are removed');
      continue;
    }
    assert.ok(checked.ok, c.chessId);
    assert.ok(checked.loadout[c.chessId], 'default skill must retain the selection');
  }
});

test('all six-star recruits can deploy and simulate each selectable skill without runtime errors', () => {
  for (const c of candidates.filter((c) => c.tier === 6)) for (const skill of c.skills) {
    const h = makeBattle({ units: [{ chessId: c.chessId, row: 10, col: 5, skillIndex: skill.index }],
      enemies: [{ key: 'enemy_1422_lrsldr', time: 0, route: 0 }], timeLimit: 5, autoFinish: false });
    h.run(3);
    assert.deepEqual(h.b.errors, [], `${c.name} S${skill.index + 1}`);
    for (const u of h.b.allyUnits) assert.ok(Number.isFinite(u.hp), c.name);
  }
});

test('server rejects excess slots, duplicate operators across tiers and invalid skills', () => {
  const three = candidates.filter((c) => c.tier === 5 && !c.recruitPresetId).slice(0, 3);
  assert.equal(checkLoadout(Object.assign({}, ...three.map((c) => pick(c.chessId))), lookup).error, 'BAD_TARGET');
  assert.equal(checkLoadout({ ...pick(kalts), ...pick(id(6, 'char_003_kalts')) }, lookup).error, 'BAD_TARGET');
  assert.equal(checkLoadout({ [kalts]: { skill: 9 } }, lookup).error, 'BAD_TARGET');
  assert.equal(checkLoadout({ chess_char_5_diy1_a: { skill: 0 } }, lookup).error, 'BAD_TARGET');
});

test('recruit persistence, sanitization and skill changes preserve selected default entries', () => {
  const c = lookup(kalts), g = lookup(c.goldenId);
  const entries = setChoice(pick(kalts), c, g, { skill: 2 });
  assert.equal(sanitizeEntries(parseStored(toStored(entries)), lookup)[kalts].skill, 2);
  assert.ok(setChoice(entries, c, g, { skill: c.skill.index })[kalts]);
  const dirty = Object.assign({}, ...candidates.filter((c) => c.tier === 5 && !c.recruitPresetId).slice(0, 3).map((c) => pick(c.chessId)));
  assert.equal(Object.keys(sanitizeEntries(dirty, lookup)).length, 2);
});

test('recruit pool uses tier caps, respects disabled bonds and reconciles selections without resetting presets', () => {
  const gd = new GameData(DATA, 'mode_single_funny');
  const pool = new SharedPool(gd);
  const preset = gd.visibleChess[0];
  pool.take(preset);
  pool.setRecruits([kalts]);
  assert.equal(pool.cap(kalts), 8);
  assert.equal(pool.roll(() => 0, { tier: 5, filter: (key) => key === kalts }), kalts);
  pool.take(kalts, 3);
  assert.equal(pool.give(kalts, 3), 3);
  pool.setRecruits([], []);
  assert.equal(pool.has(kalts), false);
  assert.equal(pool.left(preset), pool.cap(preset) - 1);
  pool.setRecruits([kalts], lookup(kalts).bonds);
  assert.equal(pool.has(kalts), false);
});

test('match selections enter pool before play; updates lock after briefing and recruits merge normally', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'FUNNY', fake: true,
    seats: [{ seat: 0, playerId: 'p_0', name: 'Test', isBot: false, connected: true, loadout: pick(kalts) }] });
  const m = h.m, ps = m.players.get('p_0');
  assert.equal(m.pool.has(kalts), true);
  m.phase = PHASE.INFO_CHECK;
  assert.ok(m.setLoadout('p_0', {}).ok);
  assert.equal(m.pool.has(kalts), false);
  assert.ok(m.setLoadout('p_0', pick(kalts)).ok);
  m.phase = PHASE.PREP;
  assert.equal(m.setLoadout('p_0', {}).error, 'WRONG_PHASE');
  for (let n = 0; n < 3; n++) ps.acquireChess(kalts, { fromPool: true });
  assert.equal(m.pool.left(kalts), 5);
  assert.ok(ps.hand.some((p) => p?.id === lookup(kalts).goldenId));
  checkInvariants(m);
  m.dispose();
});
