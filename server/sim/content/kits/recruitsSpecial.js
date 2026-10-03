// Stateful recruit adaptations: flight, debt HP, mana, transformations and elemental control.
import { genericSkillSpec } from '../generic.js';
import { frontOf, rotateOffset } from '../../dir.js';
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
const seed = (bb, raw, def) => {
  const s = genericSkillSpec(def.skill, bb, def);
  if (s.mods && bb.base_attack_time != null) s.mods.batPct = bb.base_attack_time / raw.stats.bat;
  return s;
};
const element = (b, u, e, value, kind = 'neural') =>
  b.dealDamage(u, e, { amount: value, type: 'element', element: kind, tags: ['recruitElement'] });
const flight = (b, u, duration = Infinity) =>
  buff(b, u, 'recruit:flight', {}, duration, { flags: { float: true, blockFly: true } });
const percentShield = (b, u, key, amount, cap) =>
  buff(b, u, key, {}, Infinity, { shield: Math.min(cap, (u.findBuff(key)?.shield ?? 0) + amount) });

function aglna2(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  s.kind = n === 2 ? 'ammo' : 'duration';
  if (n === 2) s.ammo = bb['attack@trigger_time'];
  s.onStart = ({ battle: b, unit: u }) => {
    flight(b, u, u.skill.duration || Infinity);
    if (n === 1)
      for (const e of enemies(b, u))
        status(
          b,
          u,
          e,
          e.isFlying ? 'bind' : 'levitate',
          e.isFlying ? bb.buff_duration_ground_bound : bb.buff_duration_levitate,
        );
  };
  if (n === 1) s.attack = { dmgType: 'arts' };
  return kit(raw, s, (b, u) => {
    if (n === 0) deploy(b, u, () => u.skill.activate('deploy', { free: true }));
    onHit(b, u, ({ target: e }) =>
      damage(b, u, e, e.s.massLevel <= t.mass_level ? t.atk_scale_hi : t.atk_scale_lo, 'arts'),
    );
    every(b, u, 0.2, () => {
      if (u.s.flags.float) for (const e of enemies(b, u)) buff(b, e, 'angelina:weight', { massFlat: -1 }, 0.3);
      for (const a of b.alliesFor(u))
        if (a.s.flags.float)
          buff(
            b,
            a,
            'angelina:fliers',
            { atkPct: z.atk, hpRegenRatio: a.blocking.length ? z.hp_recovery_per_sec_by_max_hp_ratio : 0 },
            0.3,
          );
    });
  });
}

function phatm2(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def),
    marked = new Set();
  if (n === 0) {
    s.attack = { atkScale: bb.atk_scale, hits: bb.times };
    s.targeting = { priority: 'notBurst' };
    s.onHit = ({ battle: b, unit: u, target: e }) => {
      if (e) {
        status(b, u, e, 'bind', bb.unmove);
        buff(b, e, `dionysus:neural:${u.id}`, {}, bb.unmove, { data: { scale: bb.ep_damage_scale } });
      }
    };
  }
  if (n === 2) s.targeting = { rangeGrid: def.skill.rangeGrid, priority: 'notBurst' };
  return kit(raw, s, (b, u) => {
    onHit(b, u, ({ target: e }) => {
      element(b, u, e, u.s.atk * t['attack@ep_damage_ratio']);
      for (const a of b.foesInRadius(
        e.x,
        e.y,
        n === 1 && u.skill.active ? bb['talent@range_radius'] : t.range_radius,
      ))
        if (a !== e) element(b, u, a, u.s.atk * t.ep_damage_ratio);
      if (n === 2 && u.skill.active) marked.add(e);
    });
    b.on(
      'attack',
      (c) => {
        if (alive(u) && c.attacker.side === 'enemy' && inRange(u, c.attacker)) element(b, u, c.attacker, z.value);
      },
      { owner: u },
    );
    b.on(
      'elementHit',
      (c) => {
        const m = c.target.findBuff(`dionysus:neural:${u.id}`);
        if (m && c.dmg.element === 'neural') c.dmg.amount *= m.data.scale;
      },
      { owner: u },
    );
    every(b, u, 1, () => {
      for (const e of b.aliveEnemies())
        if (e.findBuff('neuralBurst')) buff(b, e, 'dionysus:speed', { aspd: z.attack_speed }, 1.1);
      for (const e of marked) {
        if (!e.alive || e.findBuff('neuralBurst')) marked.delete(e);
        else element(b, u, e, u.s.atk * bb.ep_damage_ratio);
      }
    });
    b.on(
      'deploy',
      ({ unit: d }) => {
        if (d.ownerUnit !== u) return;
        d.profile.noAttack = true;
        buff(b, d, 'dionysus:decoy', {}, Infinity, { flags: { untargetable: true } });
        every(b, d, 0.5, () => {
          const xs = b.foesInRadius(d.x, d.y, 3);
          if (n === 1) {
            for (const e of xs.slice(0, bb.max_target))
              b.applyStatus(e, 'attract', { source: u, duration: 10, point: { x: d.x, y: d.y } });
            if (xs.some((e) => Math.hypot(e.x - d.x, e.y - d.y) < 0.6)) {
              for (let i = 0; i < bb.buff_time / bb.interval_damage; i++)
                after(b, u, i * bb.interval_damage, () => {
                  for (const e of b.foesInRadius(d.x, d.y, 1.5)) {
                    damage(b, u, e, bb.atk_scale, 'arts');
                    element(b, u, e, u.s.atk * bb.ep_damage_ratio_token);
                    status(b, u, e, 'sluggish', bb.sluggish);
                  }
                });
              b.retreat(d, { reason: 'expired' });
            }
          }
        });
      },
      { owner: u },
    );
  });
}

function leizi2(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 0)
    Object.assign(s, {
      kind: 'charges',
      attack: undefined,
      onStart({ battle: b, unit: u }) {
        for (const e of enemies(b, u)) if (!e.isFlying) damage(b, u, e, bb['attack@atk_scale_s1']);
      },
    });
  if (n === 1) {
    s.attack = { atkScale: bb['attack@atk_scale_s2'] };
    s.targeting = { maxTargets: bb['attack@max_target_s2'], rangeGrid: def.skill.rangeGrid };
  }
  if (n === 2) {
    s.attack = { atkScale: bb['attack@atk_scale_s3'], splashRadius: bb['attack@range_radius'] };
    s.onHit = ({ battle: b, unit: u, target: e }) => {
      if (!e) return;
      const p = { x: e.x, y: e.y };
      for (let i = 0; i < 5; i++)
        after(b, u, i * 0.6, () =>
          area(b, u, p, 1.5, bb['attack@atk_scale_current'], 'arts', (a) => {
            if (b.rng() < bb.prob) status(b, u, a, 'tremble', bb.not_combat);
          }),
        );
    };
  }
  return kit(raw, s, (b, u) => {
    let stacks = 0;
    every(b, u, 1, () => {
      if (!u.skill.active) flight(b, u, 1.1);
      for (const e of enemies(b, u))
        if (b.rng() < 0.1) {
          damage(b, u, e, t.atk_scale_t, 'arts');
          if (n === 1 && u.skill.active) {
            stacks = Math.min(bb.thunder_max_stack_cnt, stacks + 1);
            buff(b, u, 'leizi:thunder', { atkPct: stacks * bb.thunder_atk }, u.skill.timeLeft);
          }
        }
    });
    b.on(
      'skillStart',
      (c) => {
        if (c.unit !== u) return;
        stacks = 0;
        b.removeBuff(u, 'recruit:flight');
        for (const e of enemies(b, u))
          if (!e.isFlying) {
            damage(b, u, e, z.atk_scale_t2, 'arts');
            status(b, u, e, 'tremble', z.not_combat);
          }
      },
      { owner: u },
    );
    b.on(
      'hit',
      (c) => {
        if (c.source === u && c.dmg.isAttack && u.skill.active) c.dmg.amount *= t['atk_scale[skill_up]'];
      },
      { owner: u },
    );
  });
}

function hsgma2(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  s.attack = {
    dmgType: 'arts',
    ...(n === 2
      ? { hits: 2, maxTargets: 2 }
      : n === 1
        ? { hits: 3, atkScale: bb['attack@atk_scale'], hitAllBlocked: true }
        : {}),
  };
  if (n === 1)
    s.onStart = ({ battle: b, unit: u }) => {
      for (let i = 0; i < 8; i++)
        after(b, u, i * bb.interval, () => {
          for (const e of b.foesInRadius(u.x, u.y, 1.5)) {
            const dealt = damage(b, u, e, bb.shield_atk_scale, 'arts');
            b.heal(u, u, dealt * bb.heal_ratio, { self: true });
            status(b, u, e, 'sluggish', bb.sluggish);
          }
        });
    };
  return kit(raw, s, (b, u) => {
    let debt = 0,
      last = -Infinity,
      grace = -1;
    b.on(
      'fatal',
      (c) => {
        if (c.unit !== u) return;
        if (b.time < grace) {
          c.prevented = true;
          return;
        }
        const before = debt;
        debt += Math.max(0, c.amount - u.hp);
        if (debt < u.s.maxHp * t.max_minus_hp_ratio) {
          c.prevented = true;
          u.hp = 1;
          buff(b, u, 'hoshi:ego', {}, Infinity, { flags: { noHeal: true } });
        } else debt = before;
      },
      { owner: u },
    );
    b.on(
      'damaged',
      (c) => {
        if (c.target !== u) return;
        if (c.amount > 0) last = b.time;
        if (n === 0 && u.skill.active && c.source?.side === 'enemy' && c.dmg.isAttack)
          damage(b, u, c.source, bb.atk_scale, 'arts');
      },
      { owner: u },
    );
    every(b, u, 0.2, () => {
      const f = Math.min(1, (1 - u.hpRatio) / (1 - z.min_hp_ratio));
      buff(
        b,
        u,
        'hoshi:tenacity',
        { atkPct: z.min_atk * f + (f >= 1 ? (z.atk ?? 0) : 0), resFlat: z.min_magic_resistance * f },
        0.3,
      );
      if (debt > 0 && b.time - last >= t['hsgma2_t_1[heal].interval']) {
        debt -= u.s.maxHp * t['hsgma2_t_1[heal].hp_recovery_per_sec_by_max_hp_ratio'] * 0.2;
        if (debt <= 0) {
          b.removeBuff(u, 'hoshi:ego');
          u.hp = Math.max(1, -debt);
          debt = 0;
        }
      }
    });
    b.on(
      'skillEnd',
      (c) => {
        if (c.unit === u && n === 2 && c.reason !== 'death') {
          grace = b.time + bb.before_dead_duration;
          buff(b, u, 'hoshi:final', { atkPct: bb.atk, hpPct: bb.max_hp }, bb.before_dead_duration);
          u.profile.hits = 4;
          u.profile.dmgType = 'arts';
          after(b, u, bb.before_dead_duration, () => b.retreat(u, { reason: 'forcedExit' }));
        }
      },
      { owner: u },
    );
  });
}

function orchd2(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0);
  const s = instant(
    ({ battle: b, unit: u, skill }) => {
      if (n === 0) {
        const enhanced = skill.charges > 0;
        if (enhanced) skill.charges--;
        const e = enemies(b, u, 1)[0];
        if (e)
          for (let i = 0; i < (enhanced ? 9 : 4); i++) {
            damage(b, u, e, i < 4 ? bb.atk_scale_1 : bb.atk_scale_2, 'phys', { isAttack: true });
            if (i >= 4 && b.rng() < bb.stun_prob) status(b, u, e, 'stun', bb.stun);
          }
      } else if (n === 1) {
        flight(b, u, 1);
        for (let i = 0; i < 12; i++)
          after(b, u, i * 0.05, () => {
            for (const e of enemies(b, u)) damage(b, u, e, bb['attack@atk_scale_loop'], 'phys', { isAttack: true });
          });
        after(b, u, 0.7, () => area(b, u, u, 1.5, bb['attack@atk_scale_end']));
      } else
        after(b, u, 3, () => {
          for (const e of b.aliveEnemies().filter((e) => Math.abs(e.y - u.y) < 0.6)) {
            damage(b, u, e, bb.atk_scale);
            damage(b, u, e, bb.atk_scale_magic, 'arts');
            b.push(e, bb.force, { from: u, dir: u.dir });
          }
        });
    },
    { targeting: { rangeGrid: def.skill.rangeGrid } },
  );
  return kit(raw, s, (b, u) => {
    let left = 0,
      first = true;
    deploy(b, u, () => {
      first = true;
      left = 0;
      if (n === 1) u.skill.activate('deploy', { free: true });
    });
    b.on(
      'skillStart',
      (c) => {
        if (c.unit === u && first) {
          left = t.power_attack_count;
          first = false;
        }
      },
      { owner: u },
    );
    b.on(
      'hit',
      (c) => {
        if (c.source === u && c.dmg.isAttack && left > 0) c.dmg.amount *= t.power_attack_scale;
      },
      { owner: u },
    );
    onAttack(b, u, () => {
      left = Math.max(0, left - 1);
    });
  });
}

function chen3(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 0) {
    s.attack = { hits: 2 };
    s.onHit = ({ battle: b, unit: u, target: e }) => e && status(b, u, e, 'silence', u.skill.timeLeft);
  }
  if (n === 1) {
    s.attack = { noAttack: true };
    s.onStart = ({ battle: b, unit: u }) => {
      for (let i = 0; i < 10; i++)
        after(b, u, i * 0.1, () => {
          const e = enemies(b, u, 1, 'nearest')[0];
          if (e) damage(b, u, e, bb.atk_scale, 'arts');
        });
      after(b, u, 1, () => {
        u.skill.spec.attack = {};
        buff(
          b,
          u,
          'chen3:duel',
          {
            atkPct: bb['chen3_s2[respawn_buff].atk'],
            dodgePhys: bb['chen3_s2[respawn_buff].prob'],
            dodgeArts: bb['chen3_s2[respawn_buff].prob'],
          },
          u.skill.timeLeft,
        );
      });
    };
  }
  if (n === 2) {
    s.attack = { atkScale: bb['attack@atk_scale'], hits: 3 };
    s.targeting = { rangeGrid: def.skill.rangeGrid, maxTargets: bb['attack@max_target'] };
    s.onStart = ({ battle: b, unit: u }) => {
      for (const e of enemies(b, u))
        b.dealDamage(u, e, {
          amount: Math.max(e.hp * bb.hp_ratio, u.s.atk * bb.projectile_min_atk_scale),
          type: 'arts',
        });
    };
  }
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => buff(b, u, 'chen3:talent', { atkPct: t.atk, aspd: t.attack_speed }));
    let last = 0;
    b.on(
      'damaged',
      (c) => {
        if (c.target === u && c.amount > 0) last = b.time;
      },
      { owner: u },
    );
    every(b, u, z.stack_time, () => {
      if (b.time - last >= z.stack_time) {
        b.heal(
          u,
          u,
          (u.s.atk * (z.heal_atk_scale_min + b.rng() * (z.heal_atk_scale_max - z.heal_atk_scale_min))) / 100,
          { self: true },
        );
        buff(b, u, 'chen3:evade', {}, Infinity, { shieldHits: 1 });
      }
    });
    b.on(
      'hit',
      (c) => {
        if (c.source === u && c.dmg.isAttack)
          c.dmg.type = c.target.s.def > (u.s.atk * c.target.s.res) / 100 ? 'arts' : 'phys';
      },
      { owner: u },
    );
  });
}

function headb2(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 1)
    s.onStart = ({ battle: b, unit: u, skill }) => {
      if (skill.activations > 1) {
        skill.timeLeft = Infinity;
        buff(b, u, 'zima:second', {
          atkPct: bb['headb2_s_2[second].atk'] - bb.atk,
          defPct: bb['headb2_s_2[second].def'] - bb.def,
        });
      }
    };
  if (n === 2) {
    s.attack = { noAttack: true };
    s.mods = { atkPct: bb.atk_base };
    s.onStart = ({ battle: b, unit: u }) => {
      for (let i = 0; i < 5; i++)
        after(b, u, i, () => {
          buff(b, u, 'zima:hammers', { atkPct: bb.atk_step * i }, Math.max(1, u.skill.timeLeft));
          const [r, c] = frontOf(u.tileR, u.tileC, u.dir);
          area(b, u, { x: c, y: r }, 1.7, bb.atk_scale);
        });
    };
  }
  return kit(raw, s, (b, u) => {
    b.on(
      'hit',
      (c) => {
        if (c.source === u && c.dmg.isSplash) c.dmg.amount *= t.damage_scale;
      },
      { owner: u },
    );
    every(b, u, 0.2, () => {
      if (u.skill.active)
        for (const a of b.alliesFor(u)) buff(b, a, 'zima:team', { atkPct: z.atk, defPct: z.def }, 0.3);
    });
  });
}

function shu(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def),
    tiles = new Set(),
    anchors = new Map();
  const sow = (a) => {
    for (const [dr, dc] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ])
      tiles.add(`${Math.round(a.y) + dr},${Math.round(a.x) + dc}`);
  };
  if (n === 0) {
    s.attack = { dmgType: 'heal', healScale: bb.heal_scale, heal: { mode: 'single', hpAtMost: 0.5 } };
    s.trigger = { rule: 'DEFAULT', allies: true, hpAtMost: 0.5 };
    s.heal = true;
  }
  if (n === 1) {
    s.attack = { dmgType: 'heal', heal: { mode: 'multi', count: bb['attack@max_target'] } };
    s.mods = { atkPct: bb.atk, blockCnt: bb.block_cnt, batPct: bb.base_attack_time / raw.stats.bat - 1 };
    s.heal = true;
  }
  if (n === 2)
    s.onAttack = ({ battle: b, unit: u }) => {
      const a = b.lowestHpAllyInRange(u);
      if (a) b.heal(u, a, u.s.atk);
    };
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => sow(u));
    b.on(
      'heal',
      (c) => {
        if (c.source === u) sow(c.target);
      },
      { owner: u },
    );
    every(b, u, 0.2, () => {
      const boosted = n === 1 && u.skill.active ? bb.extra_extend_scale : 1;
      const occupied = b.aliveEnemies().some((e) => !e.isFlying && tiles.has(`${Math.round(e.y)},${Math.round(e.x)}`));
      for (const a of b.alliesFor(u)) {
        if (tiles.has(`${a.tileR},${a.tileC}`))
          buff(
            b,
            a,
            'shu:sown',
            { hpRegen: t.hp_recovery_per_sec * boosted, dmgTakenMul: 1 - t.damage_resistance * boosted },
            0.3,
          );
        if (n === 2 && u.skill.active && occupied && inRange(u, a))
          buff(b, a, 'shu:harvest', { atkPct: bb.e_atk, aspd: bb.e_attack_speed }, 0.3);
      }
      if (n === 2 && u.skill.active)
        for (const e of b.aliveEnemies()) {
          if (e.isFlying) continue;
          const key = `${Math.round(e.y)},${Math.round(e.x)}`;
          if (!anchors.has(e.id) && tiles.has(key)) anchors.set(e.id, { x: e.x, y: e.y });
          const p = anchors.get(e.id);
          if (p && Math.hypot(e.x - p.x, e.y - p.y) > bb.max_distance) {
            e.x = p.x;
            e.y = p.y;
            e.tileR = Math.round(p.y);
            e.tileC = Math.round(p.x);
            b._unblock(e);
            if (e.route) e.route.pts = null;
            b.fx('teleport', { x: e.x, y: e.y, id: e.id });
          }
        }
      else anchors.clear();
    });
    every(b, u, 0.25, () => {
      const xs = b.alliesFor(u).filter((a) => a.kind === 'op'),
        counts = new Map();
      for (const a of xs) counts.set(a.def.profession, (counts.get(a.def.profession) ?? 0) + 1);
      for (const a of xs)
        buff(
          b,
          a,
          'shu:team',
          {
            hpPct: counts.size >= 3 ? z.max_hp : 0,
            aspd: [...counts.values()].some((x) => x >= 3) ? z.attack_speed : 0,
          },
          0.4,
        );
    });
  });
}

function demetr(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 0) s.attack = { atkScale: bb.atk_scale, hits: 2 };
  if (n === 2) {
    s.mods = { atkPct: bb['attack@demetr_s3[bonus].atk'], aspd: bb['attack@demetr_s3[bonus].attack_speed'] };
    s.onStart = ({ battle: b, unit: u }) => {
      u.trait.demetrHome = [u.tileR, u.tileC];
      const e = enemies(b, u, 1, 'nearest')[0];
      if (e) b.relocate(u, Math.round(e.y), Math.round(e.x));
    };
    s.onEnd = ({ battle: b, unit: u }) => {
      if (u.trait.demetrHome) b.relocate(u, ...u.trait.demetrHome);
    };
  }
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => {
      u.trait.demetrAt = b.time;
    });
    every(b, u, 0.2, () => {
      const p = Math.max(z.init_prob - z.trig_cnt * z.dec_prob, z.init_prob - (b.time - u.trait.demetrAt) * z.dec_prob);
      buff(b, u, 'demetri:evade', { dodgePhys: p, dodgeArts: p }, 0.3);
    });
    onHit(b, u, ({ target: e }) => {
      b.addBuff(e, {
        key: `demetri:def:${u.id}`,
        duration: t['attack@def_dec_duration'],
        refresh: 'stack',
        maxStacks: n === 1 && u.skill.active ? t['attack@s2_limited_stack_cnt'] : t['attack@limited_stack_cnt'],
        mods: { defPct: t['attack@def'] },
      });
      if (
        n === 1 &&
        u.skill.active &&
        (e.findBuff(`demetri:def:${u.id}`)?.stacks ?? 0) >= t['attack@s2_limited_stack_cnt']
      )
        status(b, u, e, 'sluggish', 0.3);
    });
    b.on(
      'hit',
      (c) => {
        if (c.source === u) {
          c.dmg.amount *= 1 + t.max_add_on_scale * Math.min(1, (1 - c.target.hpRatio) / (1 - t.max_hp_ratio));
          if (n === 2 && u.skill.active && b.rng() < bb['attack@demetr_s3[bonus].prob'])
            c.dmg.amount *= bb['attack@demetr_s3[bonus].prob_atk_scale'];
        }
      },
      { owner: u },
    );
    b.on(
      'fatal',
      (c) => {
        if (c.unit === u && n === 2 && u.skill.active) {
          c.prevented = true;
          u.skill.end('fatal');
        }
      },
      { owner: u },
    );
  });
}

function narant(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 0)
    s.attack = { atkScale: bb['attack@atk_scale'], chain: { count: bb['attack@times'], falloff: 0, radius: 2 } };
  if (n === 1)
    s.onHit = ({ battle: b, unit: u, target: e }) => {
      if (e) {
        status(b, u, e, 'sluggish', bb['attack@sluggish']);
        after(b, u, bb['attack@move_ahead_time'], () => {
          for (const a of b
            .aliveEnemies()
            .filter((a) => Math.abs(a.y - u.y) < 1 && a.x >= Math.min(u.x, e.x) && a.x <= Math.max(u.x, e.x)))
            damage(b, u, a, bb['attack@atk_scale_comeback']);
        });
      }
    };
  if (n === 2) {
    s.attack = { atkScale: bb['attack@atk_scale'], hits: bb.cnt };
    s.onAttack = ({ battle: b, unit: u }) =>
      after(b, u, 0.5, () => {
        for (const e of b.foesInRadius(u.x, u.y, 1.5).slice(0, bb['attack@aoe.max_target'])) {
          damage(b, u, e, bb.atk_scale_aoe);
          status(b, u, e, 'sluggish', bb.sluggish);
        }
      });
  }
  return kit(raw, s, (b, u) => {
    let atk = 0,
      defense = 0;
    deploy(b, u, () => {
      atk = 0;
      defense = 0;
      buff(b, u, 'narantuya:evade', { dodgePhys: z.prob, dodgeArts: z.prob });
    });
    onHit(b, u, ({ target: e }) => {
      const f = Math.hypot(e.x - u.x, e.y - u.y) <= 1.5 ? 2 : 1;
      atk = Math.min(t['attack@steal_atk_max'], atk + t['attack@steal_atk'] * f);
      defense = Math.min(t['attack@steal_def_max'], defense + t['attack@steal_def'] * f);
      buff(b, u, 'narantuya:steal', { atkFlat: atk, defFlat: defense });
      b.addBuff(e, {
        key: `narantuya:stolen:${u.id}`,
        refresh: 'stack',
        maxStacks: 12,
        mods: { atkFlat: -t['attack@steal_atk'] * f, defFlat: -t['attack@steal_def'] * f },
      });
    });
  });
}

function marcil(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  s.spType = 'time';
  s.spCost = bb.skill_cost_min_sp;
  s.initSp = 0;
  s.trigger = { rule: 'CUSTOM_RANGE', grid: [] };
  if (n === 0) {
    s.kind = 'toggle';
    s.onAttack = ({ unit: u, skill }) => {
      u.trait.mana -= bb.sp_cost;
      if (u.trait.mana < bb.sp_cost) skill.end('mana');
    };
  }
  if (n === 1) {
    s.kind = 'toggle';
    s.onStart = ({ battle: b, unit: u, skill }) => {
      buff(b, u, 'marcille:chant', {}, bb.chant_duration, { flags: { disarm: true } });
      u.trait.mana -= bb.sp_cost;
      if (skill.activations > 1) buff(b, u, 'marcille:familiar', { aspd: bb.attack_speed, rangeExtend: 1 });
    };
    s.onHit = ({ battle: b, unit: u, target: e, skill }) => {
      if (e)
        status(
          b,
          u,
          e,
          skill.activations > 1 ? 'stun' : 'sluggish',
          skill.activations > 1 ? bb['attack@stun'] : bb['attack@sluggish'],
        );
    };
  }
  if (n === 2) {
    s.kind = 'charges';
    s.attack = undefined;
    s.onStart = ({ battle: b, unit: u }) => {
      const count = Math.floor(u.trait.mana / bb.sp_cost_extra);
      u.trait.mana -= count * bb.sp_cost_extra;
      buff(b, u, 'marcille:chant', {}, bb.chant_duration + bb.extra_chant_duration, { flags: { disarm: true } });
      for (let i = 0; i < count; i++)
        after(b, u, bb.chant_duration + bb.extra_chant_duration + i * bb.interval, () => {
          const e = enemies(b, u, 1)[0];
          if (e) area(b, u, e, 1.7, bb.atk_scale, 'arts', (a) => status(b, u, a, 'stun', bb.stun));
        });
    };
  }
  return kit(raw, s, (b, u) => {
    u.trait.mana = Math.min(bb.mana_max, (t.mana_init ?? 0) + (z.mana_init ?? 0) + (bb.mana_init ?? 0));
    b.on(
      'spGain',
      (c) => {
        if (c.unit === u && c.reason === 'time') c.amount = 0;
      },
      { owner: u },
    );
    b.every(
      1,
      () => {
        if (!alive(u)) u.trait.mana = Math.min(bb.mana_max, u.trait.mana + (t.mana_add ?? 1));
      },
      { owner: u },
    );
    every(b, u, 0.2, () => {
      buff(b, u, 'marcille:mana', { atkPct: u.trait.mana > 0 ? t.atk : 0 }, 0.3);
      if (!u.skill.active && u.trait.mana >= bb.skill_cost_min_sp && enemies(b, u).length && !u.skill.opCooling)
        u.skill.activate('mana', { free: true });
    });
  });
}

function oblvns(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 0)
    Object.assign(s, {
      kind: 'charges',
      attack: undefined,
      onStart({ battle: b, unit: u }) {
        for (let i = 0; i < 8; i++)
          after(b, u, i * 0.1, () => {
            const e = enemies(b, u, 1)[0];
            if (e) damage(b, u, e, bb[i ? 'atk_scale_' + (i + 1) : 'atk_scale'], 'arts');
          });
      },
    });
  if (n === 1) {
    s.kind = 'toggle';
    s.mods = { aspd: bb['attack@attack_speed'] };
    s.attack = { dmgType: 'arts' };
  }
  if (n === 2) {
    s.attack = { atkScale: bb['attack@atk_scale'], hits: 2 };
    s.onAttack = ({ battle: b, unit: u }) => {
      const e = enemies(b, u, 1, 'highDef')[0];
      if (e) for (let i = 0; i < 2; i++) damage(b, u, e, bb['attack@atk_scale'], 'arts');
    };
  }
  return kit(raw, s, (b, u) => {
    let fever = 0,
      until = 0;
    onHit(b, u, () => {
      fever += z.cnt;
      if (fever >= 100) {
        fever = 0;
        until = b.time + 10;
      }
      u.trait.feverUntil = until;
    });
    every(b, u, 0.2, () => {
      for (const a of b.alliesFor(u).filter((a) => inRange(u, a)))
        buff(b, a, 'sakiko:speed', { aspd: z.attack_speed }, 0.3);
      buff(
        b,
        u,
        'sakiko:fever',
        {
          defIgnorePct: b.time < until ? Math.min(t.max_cnt, 12) * t.def_penetrate_ratio : 0,
          resIgnorePct: b.time < until ? Math.min(t.max_cnt, 12) * t.magic_resist_penetrate_ratio : 0,
        },
        0.3,
      );
    });
  });
}

function haruka(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  s.attack = { dmgType: 'heal', healScale: 0.75, heal: { mode: 'multi', count: n === 1 ? 2 : 1 } };
  s.heal = true;
  if (n === 1)
    s.onStart = ({ battle: b, unit: u, skill }) => {
      if (skill.activations > 1) skill.timeLeft = Infinity;
      else buff(b, u, 'haruka:first', { atkPct: -bb.atk }, skill.duration);
    };
  return kit(raw, s, (b, u) => {
    let acc = 0;
    every(b, u, 0.1, () => {
      acc += 0.1;
      if (acc < u.s.interval) return;
      acc = 0;
      const xs = b
        .alliesFor(u)
        .filter((a) => inRange(u, a) && !a.findBuff(`haruka:bubble:${u.id}`))
        .sort((a, z) => a.hpRatio - z.hpRatio);
      for (const a of xs.slice(0, n === 1 && u.skill.active ? 2 : 1))
        buff(b, a, `haruka:bubble:${u.id}`, {
          dmgTakenMul: 1 - t.damage_resistance * (n === 2 && u.skill.active ? bb.damage_resistance_scale : 1),
        });
    });
    b.on(
      'damaged',
      (c) => {
        const key = `haruka:bubble:${u.id}`;
        if (c.source?.side !== 'enemy' || !c.target.findBuff(key)) return;
        b.removeBuff(c.target, key);
        b.heal(u, c.target, u.s.atk * z.heal_scale);
        if (b.rng() < z.prob) c.target.skill?.gainSp(z.sp, 'haruka');
        if (n === 2 && u.skill.active) {
          status(b, u, c.source, 'levitate', bb.levitate_duration);
          dot(b, u, c.source, 'haruka:float', u.s.atk * bb.atk_scale, bb.levitate_duration);
        }
      },
      { owner: u },
    );
    b.on(
      'heal',
      (c) => {
        if (c.source === u && n === 1 && u.skill.active)
          for (const e of b
            .foesInRadius(c.target.x, c.target.y, bb.ability_range_radius)
            .slice(0, bb.max_target_extra))
            b.dealDamage(u, e, { amount: c.amount * bb.atk_scale_extra, type: 'arts' });
      },
      { owner: u },
    );
  });
}

function mantra(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    s = seed(bb, raw, def);
  if (n === 1)
    s.attack = {
      atkScale: bb['attack@atk_scale'],
      chain: {
        count: bb['attack@times'],
        falloff: 1 - bb['attack@chain.atk_scale'] / bb['attack@atk_scale'],
        radius: 2,
      },
    };
  return kit(raw, s, (b, u) => {
    onHit(b, u, ({ target: e, amount }) => {
      element(b, u, e, amount * (bb.ep_damage_ratio ?? bb['attack@ep_damage_ratio'] ?? 0));
      if (e.findBuff('neuralBurst'))
        damage(b, u, e, bb.element_atk_scale ?? bb['attack@element_atk_scale'] ?? 0, 'elemental');
    });
    b.on(
      'statusApplied',
      (c) => {
        if (alive(u) && c.status === 'palsy' && c.target.side === 'enemy')
          damage(b, u, c.target, t.atk_scale, 'elemental');
      },
      { owner: u },
    );
    let uses = 0;
    b.on(
      'skillStart',
      (c) => {
        if (c.unit === u) uses = 0;
        if (n === 2 && u.skill.active && inRange(u, c.unit) && uses++ < bb.max_trigger_cnt)
          for (const e of enemies(b, u)) for (let i = 0; i < bb.per_active; i++) status(b, u, e, 'palsy', Infinity);
      },
      { owner: u },
    );
    b.on(
      'enemySpawn',
      ({ enemy: e }) => {
        if (alive(u)) status(b, u, e, 'palsy', Infinity);
      },
      { owner: u },
    );
  });
}

function makoto(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = instant(({ battle: b, unit: u }) => {
      if (!u.trait.doll) b.loseHp(u, u.hp, { source: u });
      else if (n === 2) u.trait.makotoHeal = true;
    });
  return kit(raw, s, (b, u) => {
    let was = false;
    every(b, u, 0.1, () => {
      const active = !!u.trait.doll;
      if (active && !was) {
        u.trait.makotoHeal = false;
        for (const e of b.foesInRadius(u.x, u.y, 1.5)) status(b, u, e, 'sluggish', t.sluggish);
      }
      if (!active && was) {
        b.removeBuff(u, 'makoto:persona');
        u.profile.dmgType = 'phys';
        u.profile.maxTargets = 1;
        u.profile.atkScale = 1;
        area(b, u, u, 1.5, z.atk_scale, 'true');
      }
      was = active;
      if (!active) return;
      buff(
        b,
        u,
        'makoto:persona',
        {
          atkPct: t.atk,
          hpPct: t.max_hp_t1,
          batPct: t.base_attack_time / raw.stats.bat,
          aspd: n === 2 ? bb['talent@attack_speed'] : 0,
        },
        0.2,
      );
      u.profile.dmgType = 'arts';
      u.profile.maxTargets = bb['attack@max_target'] ?? 1;
      u.profile.atkScale = bb['attack@atk_scale'];
      if (n === 1)
        for (const e of enemies(b, u))
          if (e.s.flags.fear && e.hp < u.s.atk * bb['attack@kill_atk_scale']) b.loseHp(e, e.hp, { source: u });
    });
    onHit(b, u, ({ target: e }) => {
      if (u.trait.doll && n === 1 && b.rng() < bb['attack@prob']) status(b, u, e, 'fear', bb['attack@fear']);
    });
    every(b, u, 1, () => {
      if (!u.trait.doll) return;
      const xs = b
        .alliesFor(u)
        .filter((a) => inRange(u, a))
        .sort((a, z) => a.hpRatio - z.hpRatio);
      if (n === 0 && xs[0]?.hpRatio < 0.5) b.heal(u, xs[0], u.s.atk * bb['attack@heal_scale']);
      if (n === 2 && u.trait.makotoHeal)
        for (const a of xs.slice(0, bb['attack@max_target_heal'])) {
          b.heal(u, a, u.s.atk * bb['attack@heal_scale']);
          buff(b, a, 'makoto:ward', { dodgePhys: bb['attack@prob'], dodgeArts: bb['attack@prob'] }, 1.1);
        }
    });
  });
}

function veen(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 2) {
    s.kind = 'ammo';
    s.ammo = bb['attack@trigger_time'];
    s.onAttack = (c) => {
      const count = c.unit.trait.veenStored ?? 0;
      if (!count) c.noAmmo = true;
      else c.skill.ammoLeft -= Math.max(0, count - 1);
    };
  }
  return kit(raw, s, (b, u) => {
    let stored = 0,
      stacks = 0;
    u.profile.storeMax = 9;
    const oldHits = u.profile.hitsFn;
    u.profile.hitsFn = (b, u) => {
      stored = u.trait.stored ?? 0;
      u.trait.veenStored = stored;
      return oldHits?.(b, u) ?? 1;
    };
    every(b, u, 0.2, () =>
      buff(
        b,
        u,
        'veen:energy',
        { atkPct: (u.trait.stored ?? 0) >= 3 ? t.atk : 0, aspd: (u.trait.stored ?? 0) < 3 ? t.attack_speed : 0 },
        0.3,
      ),
    );
    onHit(b, u, ({ target: e }) => {
      dot(b, u, e, 'veen:burn', z['attack@value'], z['attack@duration'], 'arts', z['attack@max_stack_cnt']);
      if (n === 1 && u.skill.active) {
        stacks = Math.min(bb['attack@veen_s_2_buff[stack].max_stack_cnt'], stacks + 1);
        buff(
          b,
          u,
          'veen:grow',
          {
            atkPct: stacks * bb['attack@veen_s_2_buff[stack].atk'],
            aspd: stacks * bb['attack@veen_s_2_buff[stack].attack_speed'],
          },
          u.skill.timeLeft,
        );
      }
      if (n === 2 && u.skill.active && stored) {
        const xs = enemies(b, u).filter((a) => a !== e);
        for (const a of xs.slice(0, stored >= 3 ? 3 : 1)) damage(b, u, a, bb['attack@bounce_atk_scale'], 'arts');
      }
    });
    b.on(
      'skillEnd',
      (c) => {
        if (c.unit === u) stacks = 0;
      },
      { owner: u },
    );
  });
}

function thumpy(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def),
    marked = new Set();
  let stacks = 0;
  s.attack = { hitAllBlocked: true };
  if (n === 0)
    s.onHit = ({ battle: b, unit: u, target: e }) => e && b.push(e, bb['attack@force'], { from: u, dir: u.dir });
  return kit(raw, s, (b, u) => {
    b.on(
      'elementHit',
      (c) => {
        if (c.target === u) c.dmg.amount *= t.ep_damage_scale;
      },
      { owner: u },
    );
    onHit(b, u, ({ target: e, type }) => {
      marked.add(e.id);
      if (type === 'phys') element(b, u, e, u.s.atk * t['ep_damage_ratio[trigger]'], 'erosion');
    });
    b.on(
      'elementBurst',
      (c) => {
        if (c.element === 'erosion' && marked.has(c.target.id)) {
          stacks = Math.min(z.max_stack_cnt, stacks + 1);
          buff(b, u, 'thumpy:stacks', { atkFlat: stacks * z.atk, defFlat: stacks * z.def });
          percentShield(b, u, 'thumpy:shield', z.shield_value, u.s.maxHp * z.scale);
        }
      },
      { owner: u },
    );
    every(b, u, bb.interval ?? 1, () => {
      if (!u.skill.active || n === 0) return;
      for (let i = 1; i < bb.max_cnt; i++) {
        const [dr, dc] = rotateOffset(0, i, u.dir);
        for (const e of b.foesInRadius(u.x + dc, u.y + dr, 0.6)) {
          damage(b, u, e, bb.atk_scale);
          marked.add(e.id);
          if (n === 1) status(b, u, e, 'sluggish', bb.sluggish);
          else if (!e.blockedBy && e.s.massLevel <= bb.mass_level) b.pull(e, 0, { to: u, center: true });
        }
      }
    });
  });
}

export default {
  char_1015_aglna2: aglna2,
  char_1042_phatm2: phatm2,
  char_1043_leizi2: leizi2,
  char_1044_hsgma2: hsgma2,
  char_1048_orchd2: orchd2,
  char_1050_chen3: chen3,
  char_1051_headb2: headb2,
  char_2025_shu: shu,
  char_4037_demetr: demetr,
  char_4138_narant: narant,
  char_4141_marcil: marcil,
  char_4182_oblvns: oblvns,
  char_4202_haruka: haruka,
  char_4204_mantra: mantra,
  char_4217_makoto: makoto,
  char_4226_veen: veen,
  char_4235_thumpy: thumpy,
};
