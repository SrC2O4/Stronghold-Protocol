// Additional recruit combat adaptations. Explicit mechanics are layered on the shared skill-stat decoder.
import { genericSkillSpec } from '../generic.js';
import { mitigate } from '../../damage.js';
import {
  alive,
  inRange,
  talent,
  owned,
  enemies,
  buff,
  status,
  damage,
  area,
  deploy,
  every,
  onHit,
  onAttack,
  after,
  timed,
  next,
  instant,
  kit,
  dot,
} from './recruitSupport.js';

const elite = (e) => e.isBoss || e.def.rank === 'ELITE' || e.def.rank === 'BOSS';
const shield = (b, u, key, value, cap, duration = Infinity) =>
  buff(b, u, key, {}, duration, { shield: Math.min(cap, (u.findBuff(key)?.shield ?? 0) + value) });
function seedSpec(bb, raw, def) {
  const s = genericSkillSpec(def.skill, bb, def);
  if (bb.base_attack_time != null && s.mods) s.mods.batPct = bb.base_attack_time / raw.stats.bat;
  return s;
}

function typhon(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def);
  if (n === 1)
    Object.assign(s, {
      kind: 'duration',
      duration: bb.first_duration,
      attack: { hits: 2 },
      onStart({ unit: u, skill }) {
        if (skill.activations > 1) skill.timeLeft = Infinity;
      },
      onHit({ battle: b, unit: u, target: e }) {
        if (e && b.rng() < bb['attack@prob']) status(b, u, e, 'stun', bb['attack@stun']);
      },
    });
  if (n === 2)
    Object.assign(s, {
      kind: 'ammo',
      ammo: bb['attack@s3_trigger_time'],
      attack: { noAttack: true },
      onStart({ battle: b, unit: u }) {
        u.trait.typhonMark = enemies(b, u, 1)[0];
        u.trait.typhonCd = 0;
      },
      onTick({ battle: b, unit: u, dt, skill }) {
        u.trait.typhonCd -= dt;
        if (u.trait.typhonCd > 0) return;
        const mark = u.trait.typhonMark;
        if (!mark) {
          skill.end('noTarget');
          return;
        }
        u.trait.typhonCd += u.s.interval;
        for (let i = 0; i < bb['attack@s3_max_hit_num']; i++)
          after(b, u, i * 0.15, () => {
            const xs = b.foesInRadius(mark.x, mark.y, 1.5);
            if (!xs.length) return;
            const e = xs[Math.floor(b.rng() * xs.length)];
            damage(b, u, e, bb['attack@s3_atk_scale'], 'phys', { isAttack: true });
            status(b, u, e, 'stun', bb['attack@s3_stun']);
          });
        if (--skill.ammoLeft <= 0) skill.end('ammo');
      },
    });
  return kit(raw, s, (b, u) => {
    let count = 0,
      last = -Infinity;
    const seen = new Set();
    b.on(
      'skillStart',
      (c) => {
        if (c.unit === u) seen.clear();
      },
      { owner: u },
    );
    b.on(
      'hit',
      (c) => {
        if (c.source !== u || !c.dmg.isAttack) return;
        if (b.time - last > t.duration) count = 0;
        last = b.time;
        count = Math.min(t.max_stack_cnt, count + 1);
        c.dmg.defIgnorePct = (c.dmg.defIgnorePct ?? 0) + count * t.def_penetrate;
        if (u.skill.active && !seen.has(c.target.id)) {
          seen.add(c.target.id);
          c.dmg.amount *= z.atk_scale;
          status(b, u, c.target, 'sluggish', z.sluggish);
        }
      },
      { owner: u },
    );
  });
}

function cerber(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def);
  if (n === 0) s.onHit = ({ battle: b, unit: u, target: e }) => e && status(b, u, e, 'bind', bb.duration);
  if (n === 1) {
    s.mods = { batPct: bb.base_attack_time - 1 };
    s.targeting = { priority: 'highDef' };
  }
  if (n === 2) {
    s.attack = { dmgType: 'phys' };
    s.targeting = { rangeGrid: def.skill.rangeGrid, priority: 'lowDef' };
    s.onHit = ({ battle: b, unit: u, target: e }) => e && status(b, u, e, 'silence', bb['attack@silence']);
  }
  return kit(raw, s, (b, u) => {
    let last = null,
      count = 0;
    onHit(b, u, ({ target: e }) => {
      count = e.id === last ? count + 1 : 0;
      last = e.id;
      const ratio = Math.min(
        t.max_atk_scale ?? t.atk_scale,
        (t.basic_atk_scale ?? t.atk_scale) + count * (t.delta_atk_scale ?? 0),
      );
      b.dealDamage(u, e, { amount: e.s.def * ratio, type: 'arts', tags: ['ceobe:heavy'] });
    });
    every(b, u, 0.2, () => {
      const solo = !b.alliesFor(u).some((a) => a !== u && Math.abs(a.x - u.x) + Math.abs(a.y - u.y) <= 1.1);
      buff(b, u, 'ceobe:solo', { atkPct: solo ? z.atk : 0, aspd: solo ? z.attack_speed : 0 }, 0.3);
    });
  });
}

function nian(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def);
  if (n === 0) s.attack = { dmgType: 'arts' };
  if (n === 1) {
    s.attack = { noAttack: true };
    s.mods = { defPct: bb.def, blockCnt: bb.block_cnt };
  }
  if (n === 2) {
    s.mods = { atkPct: bb['nian_s_3[self].atk'] };
    s.onTick = ({ battle: b, unit: u }) => {
      for (const a of b.alliesFor(u).filter((a) => a !== u && Math.hypot(a.x - u.x, a.y - u.y) <= 1.5)) {
        buff(b, a, 'nian:guard', { defPct: bb['nian_s_3[ally].def'], blockCnt: bb['nian_s_3[ally].block_cnt'] }, 0.2);
        status(b, u, a, 'resist', 0.2);
      }
    };
  }
  return kit(raw, s, (b, u) => {
    let remaining = 0,
      broken = 0;
    deploy(b, u, () => {
      remaining = z.times;
      broken = 0;
      buff(b, u, 'nian:shields', {}, Infinity, { shieldHits: remaining });
    });
    b.on(
      'damaged',
      (c) => {
        if (c.target !== u) return;
        const left = u.findBuff('nian:shields')?.shieldHits ?? 0;
        if (left < remaining) {
          broken += remaining - left;
          remaining = left;
          buff(b, u, 'nian:shattered', { atkPct: broken * (z.atk ?? 0), defPct: broken * (z.def ?? 0) });
          u.skill.gainSp(z.sp ?? 0, 'nian');
        }
        if (n === 1 && u.skill.active && c.source?.side === 'enemy' && c.dmg.isAttack) {
          damage(b, u, c.source, bb.atk_scale, 'arts');
          status(b, u, c.source, 'silence', bb.silence);
        }
      },
      { owner: u },
    );
    every(b, u, 0.25, () => {
      for (const a of b.alliesFor(u)) if (a.def.profession === 'TANK') buff(b, a, 'nian:hp', { hpPct: t.max_hp }, 0.4);
    });
  });
}

function chyue(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 0
      ? next(bb, {
          onStart({ unit: u, skill }) {
            skill.spec.attack = {
              atkScale: bb.atk_scale,
              hits: skill.charges === skill.maxCharges - 1 ? skill.maxCharges : 1,
            };
            if (skill.charges === skill.maxCharges - 1) skill.charges = 0;
          },
        })
      : n === 1
        ? instant(({ battle: b, unit: u }) => {
            for (const e of enemies(b, u, bb.max_target)) {
              damage(b, u, e, bb.atk_scale);
              if (e.findBuff(`chongyue:${u.id}`)) status(b, u, e, 'levitate', 1);
            }
            for (const e of enemies(b, u))
              if (e.s.flags.levitate) {
                b.removeStatus(e, 'levitate');
                buff(b, e, `chongyue:${u.id}`, {}, t.up_duration);
                damage(b, u, e, bb.atk_scale_down);
              }
          })
        : next(bb, {
            attack: { atkScale: bb.atk_scale, splashRadius: 1.1 },
            onStart({ battle: b, unit: u, skill }) {
              if (skill.activations >= bb.cast_cnt) {
                u.profile.hits = 2;
                u.rangeGrid = [
                  [0, 0],
                  [0, 1],
                  [0, 2],
                  [1, 0],
                  [-1, 0],
                ];
                b.refreshRange(u);
                skill.spec.attack = { atkScale: bb.atk_scale, hits: 2, splashRadius: 1.1 };
              }
            },
          });
  return kit(raw, s, (b, u) => {
    let killed = false;
    b.on(
      'skillStart',
      (c) => {
        if (c.unit === u) killed = false;
      },
      { owner: u },
    );
    b.on(
      'kill',
      (c) => {
        if (c.killer === u && u.skill.active) killed = true;
      },
      { owner: u },
    );
    b.on(
      'skillEnd',
      (c) => {
        if (c.unit === u) u.skill.gainSp(killed ? z.sp : (talent(raw, -1).sp ?? 0), 'chongyue');
      },
      { owner: u },
    );
    b.on(
      'hit',
      (c) => {
        if (c.source !== u) return;
        if (c.dmg.isAttack && !u.skill.active && b.rng() < t.prob)
          buff(b, c.target, `chongyue:${u.id}`, {}, t.up_duration);
        if (c.target.findBuff(`chongyue:${u.id}`)) c.dmg.amount *= t.damage_scale;
      },
      { owner: u },
    );
  });
}

function irene(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 0
      ? next(bb, {
          attack: { atkScale: bb.atk_scale, hits: 1 },
          onHit({ battle: b, unit: u, target: e }) {
            if (e) {
              status(b, u, e, 'levitate', bb.levitate);
              damage(b, u, e, bb.atk_scale, 'phys', { isAttack: true });
            }
          },
        })
      : instant(
          ({ battle: b, unit: u }) => {
            for (const e of enemies(b, u, n === 1 ? bb.max_target : Infinity)) {
              damage(b, u, e, bb.atk_scale, 'phys', { isAttack: true });
              if (n === 2 || e.s.massLevel <= bb.value) status(b, u, e, 'levitate', bb.levitate);
            }
            if (n === 2)
              for (let i = 0; i < bb.multi_times; i++)
                after(b, u, (i + 1) * bb.multi_hit_interval, () => {
                  const xs = enemies(b, u);
                  if (xs.length) area(b, u, xs[Math.floor(b.rng() * xs.length)], 1.1, bb.multi_atk_scale);
                });
          },
          { targeting: { rangeGrid: def.skill.rangeGrid, canHitFly: true } },
        );
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => buff(b, u, 'irene:speed', { aspd: z.attack_speed, atkPct: z.atk ?? 0 }));
    b.on(
      'hit',
      (c) => {
        if (
          c.source === u &&
          c.dmg.type === 'phys' &&
          (c.target.isFlying || c.target.s.flags.levitate || b.rng() < t.prob)
        )
          c.dmg.defIgnorePct = (c.dmg.defIgnorePct ?? 0) + t.def_penetrate;
      },
      { owner: u },
    );
  });
}

function lessng(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def);
  if (n === 1) {
    s.kind = 'duration';
    s.attack = { hits: 2 };
  }
  if (n === 2) {
    s.mods = { hpPct: bb.max_hp };
    s.attack = { dmgMul: (b, u, e) => (e.blockedBy ? bb['lessng_s3[atk_scale].atk_scale'] : 1) };
    s.onStart = ({ battle: b, unit: u }) => {
      const afflicted = ['stun', 'freeze', 'sleep', 'bind'].some((k) => u.s.flags[k]);
      for (const k of ['stun', 'freeze', 'sleep', 'bind']) b.removeStatus(u, k);
      if (afflicted) b.dealDamage(u, u, { amount: bb.magical_value, type: 'arts' });
    };
  }
  return kit(raw, s, (b, u) => {
    if (n === 1) deploy(b, u, () => u.skill.activate('deploy', { free: true }));
    b.on(
      'beforeStatus',
      (c) => {
        if (c.target === u && n === 2 && u.skill.active) c.cancel = true;
      },
      { owner: u },
    );
    b.on(
      'hit',
      (c) => {
        if (c.target === u && u.blocking.length && c.source?.blockedBy !== u && ['phys', 'arts'].includes(c.dmg.type))
          c.dmg.amount *= 1 - t.damage_resistance * (n === 1 && u.skill.active ? bb.talent_scale : 1);
      },
      { owner: u },
    );
    b.on(
      'damaged',
      (c) => {
        if (c.target === u && c.amount > 0) buff(b, u, 'lessing:resolve', { atkPct: z.atk }, z.add_atk_duration);
      },
      { owner: u },
    );
  });
}

function heyak(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def);
  if (n === 0) {
    s.targeting = { maxTargets: 2 };
    s.onAttack = ({ battle: b, unit: u, targets }) => {
      if (targets.length === 1) status(b, u, targets[0], 'levitate', bb.levitate);
    };
  }
  if (n === 1) {
    s.attack = { atkScale: bb['attack@atk_scale'], hits: 9 };
    s.onHit = ({ battle: b, unit: u, target: e }) => {
      if (e && b.rng() < bb['attack@prob']) status(b, u, e, 'levitate', bb['attack@levitate']);
    };
  }
  if (n === 2) {
    s.targeting = { rangeGrid: def.skill.rangeGrid, maxTargets: 3 };
    s.attack = {
      dmgMul: (b, u, e) =>
        bb['attack@min_atk_scale'] +
        (bb['attack@max_atk_scale'] - bb['attack@min_atk_scale']) * Math.min(1, Math.hypot(e.x - u.x, e.y - u.y) / 3),
    };
    s.onHit = ({ battle: b, unit: u, target: e }) => e && status(b, u, e, 'levitate', bb['attack@levitate']);
  }
  return kit(raw, s, (b, u) => {
    every(b, u, 0.2, () => {
      for (const e of enemies(b, u)) if (e.hpRatio > z.hp_ratio) buff(b, e, 'hooh:weight', { massFlat: -1 }, 0.3);
    });
    b.on(
      'hit',
      (c) => {
        if (c.source === u && c.dmg.isAttack && (c.target.isFlying || c.target.s.flags.levitate)) {
          c.dmg.amount *= t.atk_scale;
          status(b, u, c.target, 'silence', t.silence);
        }
      },
      { owner: u },
    );
  });
}

function judge(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def);
  const gain = (b, u, value) => shield(b, u, 'penance:barrier', value, u.s.maxHp * t.max_hp_ratio);
  if (n === 0) {
    s.attack = { atkScale: 1 };
    s.onHit = ({ battle: b, unit: u, target: e }) => e && damage(b, u, e, bb.atk_scale_2, 'arts');
  }
  if (n === 1) {
    s.attack = { noAttack: true };
    s.onStart = ({ unit: u }) => {
      u.trait.penanceTick = 0;
    };
    s.onTick = ({ battle: b, unit: u, dt }) => {
      u.trait.penanceTick += dt;
      if (u.trait.penanceTick >= 1) {
        u.trait.penanceTick--;
        area(b, u, u, 1.5, bb.atk_scale, 'arts');
      }
    };
  }
  if (n === 2) s.onStart = ({ battle: b, unit: u }) => gain(b, u, u.s.maxHp * bb.hp_ratio);
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => gain(b, u, u.s.maxHp * t.born_hp_ratio));
    b.on(
      'kill',
      (c) => {
        if (c.killer === u)
          gain(b, u, u.s.maxHp * t.kill_hp_ratio * (n === 1 && u.skill.active ? 1 + bb.shield_scale : 1));
      },
      { owner: u },
    );
    b.on(
      'damaged',
      (c) => {
        if (c.target === u && c.source?.side === 'enemy' && c.dmg.isAttack && u.findBuff('penance:barrier')?.shield > 0)
          damage(b, u, c.source, z.atk_scale, 'arts');
      },
      { owner: u },
    );
  });
}

function lin(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def);
  const ready = new Map();
  let bursting = false;
  const burst = (b, u, a) => {
    if (bursting) return;
    bursting = true;
    try { area(b, u, a, n === 2 && u.skill.active ? 2 : 1.5, t.atk_scale, 'arts', (e) => status(b, u, e, 'stun', t.stun)); }
    finally { bursting = false; }
  };
  return kit(raw, s, (b, u) => {
    b.on(
      'hit',
      (c) => {
        const a = c.target;
        if (!alive(u) || (a !== u && !(n === 1 && u.skill.active && a.side === 'ally' && inRange(u, a)))) return;
        if ((ready.get(a.id) ?? 0) > b.time || !['phys', 'arts', 'true'].includes(c.dmg.type)) return;
        const final = mitigate(c.dmg.amount, c.dmg.type, a.s);
        if (final <= t.value * (n === 2 && u.skill.active ? bb.talent_scale : 1)) c.dmg.cancel = true;
        else {
          ready.set(a.id, b.time + t.interval);
          burst(b, u, a);
        }
        if (c.dmg.isAttack && b.rng() < z.prob) u.skill.gainSp(z.sp, 'lin');
      },
      { owner: u },
    );
    b.on(
      'kill',
      (c) => {
        if (c.killer === u && n === 2 && u.skill.active) {
          burst(b, u, u);
          ready.set(u.id, 0);
        }
      },
      { owner: u },
    );
  });
}

function hodrer(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def),
    marked = new Set();
  if (n === 0) s.onHit = ({ battle: b, unit: u }) => b.heal(u, u, u.s.maxHp * bb.hp_ratio, { self: true });
  if (n === 1) {
    s.kind = 'toggle';
    s.mods = { batPct: bb.base_attack_time / raw.stats.bat, blockCnt: bb.block_cnt };
  }
  if (n === 2) {
    s.mods = { atkPct: bb.atk, hpPct: bb.max_hp };
    s.targeting = { rangeExtend: bb.ability_range_forward_extend };
    s.onHit = ({ battle: b, unit: u, target: e }) => {
      if (!e) return;
      marked.add(e);
      b.heal(u, u, u.s.maxHp * bb['attack@hp_ratio'], { self: true });
      if (b.rng() < bb['attack@buff_prob']) status(b, u, e, 'stun', bb['attack@stun']);
    };
  }
  return kit(raw, s, (b, u) => {
    if (n === 1) deploy(b, u, () => buff(b, u, 'hoederer:atk', { atkPct: bb.atk }));
    b.on(
      'hit',
      (c) => {
        if (c.source === u && c.dmg.isAttack)
          c.dmg.amount *= c.target.s.flags.stun || c.target.s.flags.bind ? t.atk_scale : t.atk_scale_2;
      },
      { owner: u },
    );
    every(b, u, 0.2, () =>
      buff(b, u, 'hoederer:ward', { dmgTakenMul: 1 - z.damage_resistance, physDealtMul: z.damage_scale ?? 1 }, 0.3),
    );
    b.on(
      'damaged',
      (c) => {
        if (n === 2 && u.skill.active && c.target === u && c.source?.side === 'enemy') marked.add(c.source);
      },
      { owner: u },
    );
    every(b, u, 1, () => {
      if (n !== 2 || !u.skill.active) return;
      b.loseHp(u, bb['attack@value'], { source: u });
      for (const e of marked)
        if (e.alive) b.dealDamage(u, e, { amount: bb['attack@damage'], type: 'true', tags: ['hoederer:duel'] });
    });
  });
}

function vvana(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def);
  if (n === 0) s.attack = { atkScale: bb.atk_scale, hits: 2 };
  if (n === 1) s.attack = { hitAllBlocked: true };
  if (n === 2) {
    s.attack = { hits: 2 };
    s.onStart = ({ battle: b, unit: u, skill }) => {
      if (skill.activations > 1) {
        skill.timeLeft = bb.enhance_duration;
        skill.spec.attack.hits = 3;
        buff(b, u, 'viviana:reach', { rangeExtend: 2 }, skill.timeLeft);
      }
    };
  }
  return kit(raw, s, (b, u) => {
    every(b, u, 0.2, () => {
      const scale = enemies(b, u).some(elite) ? t.super_scale : 1;
      buff(
        b,
        u,
        'viviana:talents',
        {
          artsDealtMul: 1 + t.damage_scale_m * scale,
          physTakenMul: 1 - t.damage_resistance_pm * scale,
          artsTakenMul: 1 - t.damage_resistance_pm * scale,
        },
        0.3,
      );
    });
    onHit(b, u, ({ target: e, amount }) => {
      if (t.ep_damage_ratio_m)
        b.dealDamage(u, e, {
          amount: amount * t.ep_damage_ratio_m * (enemies(b, u).some(elite) ? t.super_scale : 1),
          type: 'element',
          element: 'burn',
        });
      if (elite(e) && b.rng() < z.prob * (n === 2 && u.skill.active ? bb.talent_scale : 1))
        u.trait.vivianaShield = true;
      if (n === 1 && u.skill.active && b.rng() < bb['attack@prob_twice']) {
        damage(b, u, e, bb['attack@atk_scale_twice'], 'arts');
        buff(b, e, `viviana:steal:${u.id}`, { aspd: -bb['attack@steal_atk_speed'] }, u.skill.timeLeft);
        buff(b, u, 'viviana:speed', { aspd: bb['attack@steal_atk_speed_max'] }, u.skill.timeLeft);
      }
    });
    b.on(
      'hit',
      (c) => {
        if (c.target === u && u.trait.vivianaShield && c.dmg.isAttack && c.source?.profile.attack === 'melee') {
          u.trait.vivianaShield = false;
          c.dmg.cancel = true;
        }
      },
      { owner: u },
    );
  });
}

function zuole(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def);
  if (n === 0)
    s.onStart = ({ unit: u, skill }) => {
      skill.spec.attack = {
        atkScale: bb.atk_scale,
        hits: u.hpRatio < bb.hp_ratio_tripple ? 3 : u.hpRatio < bb.hp_ratio_double ? 2 : 1,
      };
    };
  if (n === 1) {
    s.attack = { hitAllBlocked: true };
    s.onStart = ({ battle: b, unit: u }) => {
      b.loseHp(u, u.hp * bb.hp_ratio, { source: u });
      shield(b, u, 'zuole:shield', u.s.maxHp * bb.scale, u.s.maxHp * bb.max_scale);
    };
    s.onEnd = ({ battle: b, unit: u }) => {
      const sh = u.findBuff('zuole:shield');
      if (sh) {
        sh.interval = 1;
        sh.onTick = () => {
          sh.shield = Math.max(0, sh.shield + bb.shield_decrease);
          u.markDirty();
        };
      }
    };
  }
  if (n === 2)
    return kit(
      raw,
      instant(({ battle: b, unit: u }) => {
        for (let i = 0; i < bb.times; i++)
          after(b, u, i * 0.1, () => {
            for (const e of enemies(b, u, 3)) {
              damage(b, u, e, bb.atk_scale * (i === bb.times - 1 ? bb.last_atk_bonus : 1));
              shield(
                b,
                u,
                'zuole:shield',
                (u.profile.selfHeal ?? 50) * bb.shield_scale,
                u.s.maxHp * bb.max_scale,
                bb.shield_duration,
              );
              if (i === bb.times - 1) status(b, u, e, 'stun', bb.stun);
            }
          });
      }),
      install,
    );
  return kit(raw, s, install);
  function install(b, u) {
    every(b, u, 0.1, () => {
      const f = Math.min(1, (1 - u.hpRatio) / (1 - t.min_hp_ratio));
      buff(
        b,
        u,
        'zuole:tenacity',
        {
          aspd: t.min_attack_speed * f,
          spRecoveryFlat: t.min_sp_recovery_per_sec * f,
          dmgTakenMul: u.hpRatio < (t.hp_ratio ?? 0) ? 1 - (t.damage_resistance ?? 0) : 1,
        },
        0.2,
      );
    });
    onAttack(b, u, () => {
      if (b.rng() < (u.hpRatio < z.hp_ratio ? z.prob_2 : z.prob_1)) u.skill.gainSp(z.sp, 'zuole');
    });
  }
}

function ascln(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def);
  if (n === 0) s.attack = { atkScale: bb.atk_scale, hits: 2 };
  const apply = (b, u, e) =>
    b.addBuff(e, {
      key: `ascalon:venom:${u.id}`,
      duration: t.debuff_duration,
      refresh: 'stack',
      maxStacks: t.max_stack_cnt,
      mods: { moveFlat: t.move_speed },
      interval: t.interval,
      onTick: ({ buff: a }) => damage(b, u, e, t.atk_ratio * a.stacks, 'arts'),
    });
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => buff(b, u, 'ascalon:speed', { aspd: z.attack_speed }));
    onHit(b, u, ({ target: e }) => apply(b, u, e));
    b.on(
      'death',
      (c) => {
        if (n === 1 && u.skill.active && c.unit.side === 'enemy' && inRange(u, c.unit))
          for (const e of b.foesInRadius(c.unit.x, c.unit.y, bb.range_radius)) apply(b, u, e);
      },
      { owner: u },
    );
    b.on(
      'hit',
      (c) => {
        if (
          n === 2 &&
          u.skill.active &&
          c.source?.side === 'enemy' &&
          inRange(u, c.source) &&
          !c.source.isFlying &&
          b.rng() < -bb['attack@damage_hitrate_physical']
        ) {
          c.dmg.cancel = true;
          if (c.target === u) b.heal(u, u, u.s.maxHp * bb['attack@hp_ratio'], { self: true });
        }
      },
      { owner: u },
    );
    every(b, u, 0.2, () => {
      if (n === 1 && u.skill.active)
        for (const e of enemies(b, u)) if (!e.isFlying) buff(b, e, 'ascalon:slow', { moveMul: 1 + bb.move_speed }, 0.3);
    });
  });
}

function logos(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def);
  if (n === 0)
    s.onTick = ({ battle: b, unit: u }) => {
      for (const e of enemies(b, u))
        if (e.hp < u.s.atk * bb['attack@kill_atk_scale']) {
          const hp = e.hp;
          b.loseHp(e, hp, { source: u });
          const xs = enemies(b, u);
          if (xs.length)
            b.dealDamage(u, xs[Math.floor(b.rng() * xs.length)], { amount: hp, type: 'arts', tags: ['logos:execute'] });
        }
    };
  if (n === 1) {
    s.attack = { noAttack: true };
    s.mods = { resFlat: bb.magic_resistance };
    s.onStart = ({ unit: u }) => {
      u.trait.logosLock = null;
      u.trait.logosCount = 0;
      u.trait.logosCd = 0;
    };
    s.onTick = ({ battle: b, unit: u, dt }) => {
      u.trait.logosCd -= dt;
      if (u.trait.logosCd > 0) return;
      u.trait.logosCd += bb['attack@cooldown'];
      if (!u.trait.logosLock?.alive || !inRange(u, u.trait.logosLock)) {
        u.trait.logosLock = enemies(b, u, 1)[0];
        u.trait.logosCount = 0;
      }
      const e = u.trait.logosLock;
      if (e) {
        const stacks = Math.min(bb['attack@max_stack_cnt'], u.trait.logosCount++);
        damage(b, u, e, bb['attack@atk_scale_base'] + stacks * bb['attack@atk_scale_delta'], 'arts', {
          isAttack: true,
        });
        buff(b, e, 'logos:slow', { moveMul: 1 + bb['attack@move_speed'] * stacks }, 0.6);
      }
    };
  }
  return kit(raw, s, (b, u) => {
    onHit(b, u, ({ target: e }) => {
      buff(b, e, 'logos:res', { resFlat: z.magic_resistance }, z.duration);
      buff(b, e, 'logos:flatArts', {}, z.duration, { data: { amount: z.atk_addition, owner: u.id } });
      const ep = talent(raw, -1).ep_damage_ratio;
      if (ep) damage(b, u, e, ep, 'element', { element: 'apoptosis' });
    });
    onAttack(b, u, () => {
      if (b.rng() >= t.prob) return;
      const xs = enemies(b, u);
      if (!xs.length) return;
      const e = xs[Math.floor(b.rng() * xs.length)];
      damage(b, u, e, t.atk_scale, 'arts');
      status(b, u, e, 'sluggish', t.sluggish);
      if (e.s.flags.burstLock && t.element_atk_scale) damage(b, u, e, t.element_atk_scale, 'elemental');
    });
    b.on(
      'hit',
      (c) => {
        const mark = c.target.findBuff('logos:flatArts');
        if (mark?.data.owner === u.id && c.dmg.type === 'arts') c.dmg.amount += mark.data.amount;
      },
      { owner: u },
    );
  });
}

function crosly(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seedSpec(bb, raw, def),
    hurtBy = new Set();
  s.kind = 'duration';
  if (n === 0) s.mods = { atkPct: bb.atk, dodgePhys: bb.prob, dodgeArts: bb.prob };
  if (n === 1) {
    s.duration = bb.duration;
    s.attack = { noAttack: true };
    s.onEnd = ({ battle: b, unit: u, reason }) => {
      if (reason !== 'death') area(b, u, u, 1.5, bb['attack@atk_scale_s2']);
    };
  }
  if (n === 2) {
    s.flags = { stealth: true };
    s.mods = { blockCnt: -99 };
    s.attack = { noAttack: true };
    s.onStart = ({ unit: u }) => {
      u.trait.crownCd = 0;
      u.trait.crownMarks = new Map();
    };
    s.onTick = ({ battle: b, unit: u, dt }) => {
      u.trait.crownCd -= dt;
      if (u.trait.crownCd > 0) return;
      u.trait.crownCd = bb['attack@s3_cd'];
      const e = enemies(b, u).find((e) => !e.isFlying && (u.trait.crownMarks.get(e.id) ?? -Infinity) <= b.time);
      if (e) {
        u.trait.crownMarks.set(e.id, b.time + bb.mark_duration);
        for (let i = 0; i < bb['attack@times']; i++) damage(b, u, e, bb['attack@atk_scale_s3']);
        status(b, u, e, 'stun', bb['attack@stun']);
      }
    };
  }
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => {
      hurtBy.clear();
      u.skill.activate('deploy', { free: true });
    });
    b.on(
      'damaged',
      (c) => {
        if (c.target === u && c.source && c.amount > 0) hurtBy.add(c.source.id);
      },
      { owner: u },
    );
    b.on(
      'hit',
      (c) => {
        if (c.source === u && c.dmg.type === 'phys' && !c.target.isFlying && !hurtBy.has(c.target.id))
          c.dmg.amount *= z.damage_scale;
        if (
          u.skill.active &&
          c.source?.side === 'enemy' &&
          !c.source.isFlying &&
          Math.hypot(c.source.x - u.x, c.source.y - u.y) <= 1.5 &&
          b.rng() < -t.damage_hitrate_physical * (n === 1 ? bb.talent_scale : 1)
        )
          c.dmg.cancel = true;
      },
      { owner: u },
    );
  });
}

export default {
  char_2012_typhon: typhon,
  char_2013_cerber: cerber,
  char_2014_nian: nian,
  char_2024_chyue: chyue,
  char_4009_irene: irene,
  char_4011_lessng: lessng,
  char_4027_heyak: heyak,
  char_4065_judge: judge,
  char_4080_lin: lin,
  char_4088_hodrer: hodrer,
  char_4098_vvana: vvana,
  char_4121_zuole: zuole,
  char_4132_ascln: ascln,
  char_4133_logos: logos,
  char_1502_crosly: crosly,
};
