import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec } from '../helpers/battleHarness.js';
import classic from '../../server/sim/content/kits/recruitsClassic.js';
import tactics from '../../server/sim/content/kits/recruitsTactics.js';
import combat from '../../server/sim/content/kits/recruitsCombat.js';
import summons from '../../server/sim/content/kits/recruitsSummons.js';
import special from '../../server/sim/content/kits/recruitsSpecial.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { RECRUIT_ADAPTED_IDS } from '../../shared/recruitMechanics.js';
import { area } from '../../server/sim/content/kits/recruitSupport.js';

const authored = { ...classic, ...tactics, ...combat, ...summons, ...special };

test('recruit aliases inherit upstream skill trigger deviations', () => {
  const chess = getDefaultSource().raw.chess;
  for (const c of Object.values(chess).filter((c) => c.recruit && c.kitBaseId)) {
    const original = chess[c.kitBaseId];
    for (const s of c.skills) {
      const preset = original.skills.find((x) => x.skillId === s.skillId);
      if (preset?.trigger.rawRule === 'TAKE_DAMAGE' && preset.trigger.rule === 'DEFAULT')
        assert.deepEqual(s.trigger, preset.trigger, `${c.chessId}: ${s.skillId}`);
    }
  }
});

test('recruit area effects obey upstream stealth and untargetable rules', () => {
  const { h, b, u } = setup('char_003_kalts', 0);
  const e = h.spawn('dummy', { pos: [10, 7] });
  e.s.flags.stealth = true;
  const hp = e.hp;
  area(b, u, e, 1, 1);
  assert.equal(e.hp, hp);
  e.s.flags.reveal = true;
  area(b, u, e, 1, 1);
  assert.ok(e.hp < hp);
  const revealedHp = e.hp;
  e.s.flags.untargetable = true;
  area(b, u, e, 1, 1);
  assert.equal(e.hp, revealedHp);
});

const id = (char, tier = 6, elite = true) => `recruit_${tier}_${char}_${elite ? 'b' : 'a'}`;
function setup(char, skillIndex, { tokens = [], enemies = [], ...opts } = {}) {
  const chessId = id(char);
  const h = makeBattle({
    units: [{ chessId, uid: 1, row: 10, col: 5, skillIndex }, ...tokens],
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1000000, speed: 0, def: 300, res: 30 }) } },
    enemies,
    autoFinish: false,
    timeLimit: 120,
    ...opts,
  });
  h.run(0.1);
  return { h, b: h.b, u: h.unit(chessId) };
}

test('authored recruits execute all three skills at both tiers and promotions without handler errors', () => {
  for (const char of Object.keys(authored))
    for (const tier of [5, 6])
      for (const elite of [false, true])
        for (let s = 0; s < 3; s++) {
          const chessId = id(char, tier, elite);
          const { h } = setup(char, s, {
            units: [{ chessId, row: 10, col: 5, skillIndex: s }],
            enemies: [{ key: 'dummy', pos: [10, 6] }],
          });
          const u = h.unit(chessId);
          assert.equal(u.kit.skillSource, 'skills');
          u.skill.activate('test', { free: true });
          h.run(45);
          assert.deepEqual(h.b.errors, [], `${chessId} S${s + 1}`);
          assert.ok(Number.isFinite(u.hp));
          for (const a of h.b.allyUnits)
            for (const key of ['atk', 'def', 'maxHp', 'interval'])
              assert.ok(Number.isFinite(a.s[key]), `${chessId} ${a.name} ${key}`);
        }
});

test('every eligible six-star has a dedicated registry entry', () => {
  const eligible = Object.values(getDefaultSource().raw.chess).filter(
    (c) => c.recruit && !c.recruitPresetId && c.tier === 6 && !c.isGolden,
  );
  assert.equal(eligible.length, 78);
  for (const c of eligible) assert.equal(typeof authored[c.charId], 'function', c.name);
  assert.deepEqual([...RECRUIT_ADAPTED_IDS].sort(), Object.keys(authored).sort(), 'UI status matches the actual registry');
});

test('all produced recruit tokens survive casts, owner death and redeploy without handler errors', () => {
  for (const char of Object.keys(authored))
    for (let s = 0; s < 3; s++) {
      const { h, b, u } = setup(char, s);
      let index = 0;
      for (const entry of u.def.tokens ?? []) {
        const token = typeof entry === 'string' ? entry : entry.tokenId;
        if (!b.producesToken(u, token)) continue;
        b.spawnToken(u, token, 10 + Math.floor(index / 3), 6 + (index % 3));
        index++;
      }
      if (!index) continue;
      h.spawn('dummy', { pos: [10, 7] });
      h.run(0.1);
      u.skill.activate('test', { free: true });
      h.run(25);
      b.retreat(u, { reason: 'retreat' });
      h.run(1);
      b.redeploy(u, { free: true });
      h.run(2);
      assert.deepEqual(b.errors, [], `${char} S${s + 1}`);
      for (const a of b.allyUnits)
        for (const key of ['atk', 'def', 'maxHp', 'interval'])
          assert.ok(Number.isFinite(a.s[key]), `${char} ${a.name} ${key}`);
    }
});

test('Mon3tr S3 changes summon damage, decays ATK, and costs summon HP when no kill', () => {
  const { h, b, u } = setup('char_003_kalts', 2, {
    tokens: [{ kind: 'token', tokenId: 'token_10002_kalts_mon3tr', uid: 2, ownerUid: 1, row: 10, col: 6 }],
  });
  const m = b.allyUnits.find((a) => a.ownerUnit === u);
  assert.ok(m?.deployed);
  u.skill.activate('test', { free: true });
  h.run(0.2);
  const start = m.s.atk;
  h.run(8);
  assert.ok(m.s.atk < start);
  const e = h.spawn('dummy', { pos: [10, 7] });
  const before = e.hp;
  b.dealDamage(m, e, { amount: 100, type: 'phys', isAttack: true });
  assert.equal(before - e.hp, 100, 'true damage ignores DEF and RES');
  const hp = m.hp;
  u.skill.end('manual');
  assert.equal(m.hp, hp - m.s.maxHp * 0.5);
  assert.equal(u.s.atk, u.base.atk, 'summon ATK is not applied to the healer');
});

test('Mon3tr out of healer range has zero DEF; S2/S3 SP waits for summon', () => {
  const { h, b, u } = setup('char_003_kalts', 1);
  h.run(2);
  assert.equal(u.skill.sp, 0);
  const m = b.spawnToken(u, 'token_10002_kalts_mon3tr', 12, 3);
  h.run(0.2);
  assert.equal(m.s.def, 0);
  b.relocate(m, 10, 6);
  h.run(0.2);
  assert.ok(m.s.def > 0);
});

test('Chen S2 deals separate physical and arts hits to each target', () => {
  const { h, b, u } = setup('char_010_chen', 1);
  const e = h.spawn('dummy', { pos: [10, 6] });
  h.run(0.1);
  const before = e.hp;
  const atk = u.s.atk,
    scale = u.def.skill.bb.atk_scale;
  u.skill.activate('test', { free: true });
  assert.ok(Math.abs(before - e.hp - (atk * scale - e.s.def + atk * scale * 0.7)) < 0.001);
  assert.deepEqual(b.errors, []);
});

test('typed barriers absorb only matching damage and leave other shields intact', () => {
  const { b, u } = setup('char_147_shining', 0);
  b.addBuff(u, { key: 'test:arts', shield: 200, tags: ['artsShield'] });
  const before = u.hp;
  b.dealDamage(null, u, { amount: 100, type: 'true', canDodge: false });
  assert.equal(u.hp, before - 100);
  assert.equal(u.findBuff('test:arts').shield, 200);
  b.dealDamage(null, u, { amount: 100, type: 'arts', canDodge: false });
  assert.equal(u.hp, before - 100);
  assert.equal(u.findBuff('test:arts').shield, 100);
});

test('Phantom mirror receives the selected skill and independently spends S2 stacks', () => {
  const { h, b, u } = setup('char_250_phatom', 1, {
    tokens: [{ kind: 'token', tokenId: 'token_10007_phatom_twin', ownerUid: 1, uid: 2, row: 10, col: 6 }],
  });
  const twin = b.allyUnits.find((a) => a.ownerUnit === u);
  const stacks = u.trait.phantomStacks;
  assert.equal(twin.trait.phantomStacks, stacks);
  b.emit('attack', { attacker: twin, targets: [], isSkill: false });
  assert.equal(twin.trait.phantomStacks, stacks - 1);
  assert.equal(u.trait.phantomStacks, stacks);
  assert.deepEqual(b.errors, []);
});

test('Magallan S3 buffs her selected drone and recalls it on skill end', () => {
  const { b, u, h } = setup('char_248_mgllan', 2, {
    tokens: [{ kind: 'token', tokenId: 'token_10005_mgllan_drone3', ownerUid: 1, uid: 2, row: 10, col: 6 }],
  });
  const drone = b.allyUnits.find((a) => a.ownerUnit === u);
  const before = drone.s.atk;
  u.skill.activate('test', { free: true });
  h.run(0.2);
  assert.equal(drone.s.atk, before * 2);
  u.skill.end('manual');
  assert.equal(drone.deployed, false);
  assert.deepEqual(b.errors, []);
});

test('Thorns S3 second activation doubles the modifiers and becomes endless', () => {
  const { b, u, h } = setup('char_293_thorns', 2);
  u.skill.activate('test', { free: true });
  const first = u.s.atk;
  u.skill.end('manual');
  u.skill.activate('test', { free: true });
  assert.equal(u.skill.timeLeft, Infinity);
  assert.ok(u.s.atk > first);
  h.run(40); assert.ok(u.skill.active);
  assert.deepEqual(b.errors, []);
});

test('Schwarz S3 guarantees talent critical and applies armor reduction', () => {
  const { b, u, h } = setup('char_340_shwaz', 2);
  const e = h.spawn('dummy', { pos: [10, 6] }); h.run(0.1);
  u.skill.activate('test', { free: true });
  const hp = e.hp;
  b.dealDamage(u, e, { amount: 1000, type: 'phys', isAttack: true, attackId: 100 });
  assert.ok(e.findBuff('schwarz:armor'));
  assert.ok(hp - e.hp > 1000);
});

test('Hellagur gains attack speed as HP falls, capped at his talent maximum', () => {
  const { u, h } = setup('char_188_helage', 1);
  h.run(0.2); const before = u.s.aspd;
  u.hp = u.s.maxHp * 0.4; h.run(0.1);
  const low = u.s.aspd; assert.ok(low > before);
  u.hp = u.s.maxHp * 0.1; h.run(0.1);
  assert.equal(u.s.aspd, low);
});

test('Lin barrier negates small hits and breaks on a larger hit', () => {
  const { b, u } = setup('char_4080_lin', 0);
  const hp = u.hp;
  b.dealDamage(null, u, { amount: 100, type: 'true' });
  assert.equal(u.hp, hp);
  b.dealDamage(null, u, { amount: 300, type: 'true' });
  assert.equal(u.hp, hp - 300);
  b.dealDamage(null, u, { amount: 100, type: 'true' });
  assert.equal(u.hp, hp - 400, 'broken barrier no longer cancels damage');
});

test('Nian starts with three hit shields and gains stats as each breaks', () => {
  const { b, u } = setup('char_2014_nian', 0);
  const hp = u.hp, atk = u.s.atk;
  for (let i = 0; i < 3; i++) b.dealDamage(null, u, { amount: 100, type: 'true' });
  assert.equal(u.hp, hp); assert.ok(u.s.atk > atk);
  b.dealDamage(null, u, { amount: 100, type: 'true' });
  assert.equal(u.hp, hp - 100);
});

test('Necras can damage its sleeping S2 targets and raises a servant on a nearby kill', () => {
  const { b, u, h } = setup('char_450_necras', 1, { enemies: [{ key: 'dummy', pos: [10, 6] }] });
  const e = h.enemies()[0];
  u.skill.activate('test', { free: true });
  assert.ok(e.s.flags.sleep);
  const hp = e.hp; h.run(1);
  assert.ok(e.hp < hp, 'sleep must not swallow its own skill damage');
  b.loseHp(e, e.hp, { source: u });
  assert.ok(b.allyUnits.some(a => a.ownerUnit === u && a.alive));
  assert.deepEqual(b.errors, []);
});

test('Ling S3 merges two adjacent dragons and grants owner farewell talent', () => {
  const { b, u } = setup('char_2023_ling', 2);
  const first = b.spawnToken(u, 'token_10020_ling_soul3', 10, 6);
  assert.ok(first);
  const second = b.spawnToken(u, 'token_10020_ling_soul3', 10, 5);
  assert.equal(second, null, 'cannot overwrite the owner');
  const merged = b.spawnToken(u, 'token_10020_ling_soul3', 10, 7, { dir: 'LEFT' });
  assert.ok(merged.trait.lingGreater);
  assert.equal(first.alive, false);
  assert.ok(u.findBuff('ling:farewell'));
  assert.equal(merged.profile.dmgType, 'arts');
});

test('Dorothy S2 trap binds a lone enemy and increases the owner attack', () => {
  const { b, u, h } = setup('char_4048_doroth', 1);
  const atk = u.s.atk;
  const mine = b.spawnToken(u, 'token_10025_doroth_recttp', 10, 7);
  const e = h.spawn('dummy', { pos: [10, 7] }); h.run(0.3);
  assert.equal(mine.alive, false);
  assert.ok(e.s.flags.bind); assert.ok(u.s.atk > atk);
  assert.deepEqual(b.errors, []);
});

test('Marcille spends finite mana, never passively recovers while deployed', () => {
  const { u, h } = setup('char_4141_marcil', 0);
  const mana = u.trait.mana; h.run(3);
  assert.equal(u.trait.mana, mana);
  u.skill.activate('test', { free: true });
  for (let i = 0; i < 100; i++) if (u.skill.active) u.skill.onAttackPerformed([], true);
  assert.equal(u.skill.active, false);
  assert.ok(u.trait.mana >= 0 && u.trait.mana < 2);
});
