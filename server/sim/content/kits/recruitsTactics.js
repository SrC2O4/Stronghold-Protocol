import { frontOf, rotateOffset } from '../../dir.js';
import { summonToken } from '../tokens.js';
import {
  alive,
  inRange,
  talent,
  talText,
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

function phenxi(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const far = (u) => {
    const length = Math.max(...u.rangeGrid.map((g) => g[1]));
    const [dr, dc] = rotateOffset(0, length, u.dir);
    return { x: u.x + dc, y: u.y + dr };
  };
  const s =
    n === 0
      ? timed(bb, raw, def, { targeting: { rangeExtend: bb.ability_range_forward_extend } })
      : n === 1
        ? instant(({ battle: b, unit: u }) => {
            const end = far(u);
            area(b, u, end, 1.5, bb.atk_scale);
            const d = Math.hypot(end.x - u.x, end.y - u.y);
            for (let i = 0, x = bb.dist; x < d; i++, x += bb.dist) {
              const p = { x: u.x + ((end.x - u.x) * x) / d, y: u.y + ((end.y - u.y) * x) / d };
              after(b, u, 0.15 * (i + 1), () => area(b, u, p, 1.1, bb.atk_scale_2));
            }
          })
        : timed({}, raw, def, {
            attack: { noAttack: true },
            onStart({ unit: u }) {
              u.trait.phenxiCd = 0;
            },
            onTick({ battle: b, unit: u, dt }) {
              u.trait.phenxiCd -= dt;
              if (u.trait.phenxiCd > 0) return;
              u.trait.phenxiCd += u.s.interval;
              const p = far(u);
              for (const e of b.foesInRadius(p.x, p.y, 2))
                damage(
                  b,
                  u,
                  e,
                  Math.hypot(e.x - p.x, e.y - p.y) <= bb['attack@dist']
                    ? bb['attack@atk_scale']
                    : bb['attack@atk_scale_2'],
                );
              b.fx('aoe', { ...p, r: 2, id: u.id });
            },
          });
  return kit(raw, s, (b, u) => {
    every(b, u, t.interval, () => {
      b.loseHp(u, Math.min(u.hp - 1, u.hp * t.hp_ratio), { source: u, silent: true });
      buff(
        b,
        u,
        'fiammetta:talents',
        {
          atkPct:
            u.hpRatio > t['phenxi_t_1[peak_2].peak_performance.hp_ratio']
              ? t['phenxi_t_1[peak_2].peak_performance.atk']
              : u.hpRatio > t['phenxi_t_1[peak_1].peak_performance.hp_ratio']
                ? t['phenxi_t_1[peak_1].peak_performance.atk']
                : 0,
          aspd: u.skill.active ? (z['phenxi_e_t_2[in_skill].attack_speed'] ?? 0) : z.attack_speed,
        },
        0.2,
      );
    });
  });
}

function lmlee(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 1
      ? instant(({ battle: b, unit: u }) => {
          const e = enemies(b, u, 1)[0];
          if (!e) return;
          const mark = { e, stacks: 0, until: b.time + bb.paper_duration, seq: u.deploySeq };
          u.trait.leeMark = mark;
          buff(b, e, 'lee:mark', { taunt: bb.taunt_level }, bb.paper_duration);
        })
      : timed(
          bb,
          raw,
          def,
          n === 0
            ? { mods: { atkPct: bb.atk, dodgeArts: bb.prob } }
            : {
                mods: { atkPct: bb.atk, defPct: bb.def, taunt: bb.taunt_level },
                onAttack({ battle: b, unit: u, targets }) {
                  for (const e of enemies(b, u)) if (!targets.includes(e)) b.push(e, bb['attack@force'], { from: u });
                },
              },
        );
  return kit(raw, s, (b, u) => {
    if (n === 1) deploy(b, u, () => buff(b, u, 'lee:speed', { aspd: bb.attack_speed }));
    every(b, u, 0.1, () => {
      const targets = b.blockedTargets(u, u.profile),
        factor = b.enemiesInRadius(u.x, u.y, 1.5).length === 1 ? 2 : 1;
      buff(b, u, 'lee:block', { aspd: targets.length ? t['lmlee_t_1[self].attack_speed'] * factor : 0 }, 0.2);
      for (const e of targets)
        buff(b, e, 'lee:blockDebuff', { aspd: t['lmlee_t_1[enemy].attack_speed'] * factor }, 0.2);
      const m = u.trait.leeMark;
      if (m && (b.time >= m.until || m.stacks >= bb.max_stack_cnt || !m.e.alive)) {
        u.trait.leeMark = null;
        if (m.seq === u.deploySeq) area(b, u, m.e, 1.5, bb.default_atk_scale + bb.factor_atk_scale * m.stacks, 'arts');
      }
    });
    b.on(
      'damaged',
      (c) => {
        if (u.trait.leeMark?.e === c.target && c.source?.side === 'ally' && c.amount > 0) u.trait.leeMark.stacks++;
      },
      { owner: u },
    );
    b.on(
      'hit',
      (c) => {
        if (
          c.target === u &&
          n === 2 &&
          u.skill.active &&
          c.source &&
          !inRange(u, c.source) &&
          ['arts', 'phys'].includes(c.dmg.type) &&
          b.rng() < bb.prob
        )
          c.dmg.cancel = true;
      },
      { owner: u },
    );
    b.on(
      'merchantPay',
      (c) => {
        if (c.unit !== u) return;
        const cost = Math.abs(z.extra_cost);
        if (u.player.dp >= cost) {
          c.cost = cost;
          u.trait.leeWard = true;
        }
      },
      { owner: u },
    );
    b.on(
      'beforeStatus',
      (c) => {
        if (c.target === u && u.trait.leeWard && ['stun', 'freeze'].includes(c.status)) {
          c.cancel = true;
          u.trait.leeWard = false;
          if (c.source?.side === 'enemy') status(b, u, c.source, 'stun', z.stun);
        }
      },
      { owner: u },
    );
  });
}

function shwaz(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  return kit(raw, n === 0 ? next(bb) : timed(bb, raw, def), (b, u) => {
    const procs = new Map();
    b.on(
      'hit',
      (c) => {
        if (c.source !== u || !c.dmg.isAttack) return;
        let proc = procs.get(c.dmg.attackId);
        if (proc == null) {
          proc = b.rng() < (u.skill.active ? bb['talent@prob'] : t.prob);
          procs.set(c.dmg.attackId, proc);
          if (procs.size > 20) procs.delete(procs.keys().next().value);
        }
        if (proc) {
          c.dmg.amount *= t.atk_scale;
          buff(b, c.target, 'schwarz:armor', { defPct: t.def }, t.defdown_duration);
        }
      },
      { owner: u },
    );
    every(b, u, 0.25, () => {
      const xs = b.alliesFor(u).filter((a) => a.def.profession === 'SNIPER');
      if (xs.length > 1) for (const a of xs) buff(b, a, 'schwarz:snipers', { atkPct: z.atk }, 0.4);
    });
  });
}

function saga(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 0
      ? instant(({ battle: b, unit: u }) => b.addDp(u.ownerId, bb.cost))
      : n === 1
        ? instant(
            ({ battle: b, unit: u }) => {
              b.addDp(u.ownerId, bb.cost);
              for (const e of enemies(b, u, 6)) {
                damage(b, u, e, bb.atk_scale);
                if (e.trait.sagaWounded) b.loseHp(e, e.hp, { source: u });
              }
            },
            { targeting: { rangeGrid: def.skill.rangeGrid } },
          )
        : timed(bb, raw, def, {
            targeting: { rangeExtend: bb.ability_range_forward_extend },
            attack: { hitAllBlocked: true },
            onStart({ unit: u }) {
              u.trait.sagaDp = 0;
            },
            onTick({ battle: b, unit: u, dt }) {
              u.trait.sagaDp += dt;
              if (u.trait.sagaDp >= bb.interval) {
                u.trait.sagaDp -= bb.interval;
                b.addDp(u.ownerId, bb.cost);
              }
            },
            onHit({ battle: b, unit: u, target: e }) {
              if (e?.alive && e.hpRatio < bb['attack@hp_ratio']) damage(b, u, e, 1);
            },
          });
  return kit(raw, s, (b, u) => {
    let used = false;
    b.on(
      'fatal',
      (c) => {
        if (
          c.source !== u ||
          c.unit.side !== 'enemy' ||
          c.unit.trait.sagaWounded ||
          c.dmg?.tags?.includes('saga:expire')
        )
          return;
        c.prevented = true;
        c.unit.hp = 1;
        c.unit.trait.sagaWounded = true;
        buff(b, c.unit, 'saga:wounded', { moveMul: 1 + t.move_speed }, t.interval, {
          flags: { disarm: true, unblockable: true },
          onExpire: () => {
            if (c.unit.alive) b.loseHp(c.unit, c.unit.hp, { tags: ['saga:expire'] });
          },
        });
      },
      { owner: u },
    );
    b.on(
      'beforeAttack',
      (c) => {
        if (c.attacker === u) c.targets = c.targets.filter((e) => !e.trait.sagaWounded);
      },
      { owner: u },
    );
    b.on(
      'kill',
      (c) => {
        if (c.victim.trait.sagaWounded && c.killer?.skill) c.killer.skill.gainSp(t.sp, 'saga');
      },
      { owner: u },
    );
    b.on(
      'damaged',
      (c) => {
        if (c.target !== u || used || u.hpRatio >= z.hp_ratio) return;
        used = true;
        buff(
          b,
          u,
          'saga:survival',
          { dodgePhys: z.prob, hpRegenRatio: z.hp_recovery_per_sec_by_max_hp_ratio },
          z.duration,
        );
      },
      { owner: u },
    );
  });
}

function gdglow(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  return kit(
    raw,
    timed(bb, raw, def, {
      attack: { noAttack: true },
      onStart({ unit: u }) {
        u.trait.goldSelfCd = 0;
        u.trait.goldDrones = Array.from({ length: 1 + (bb['attack@cnt'] ?? 0) }, () => ({
          target: null,
          scale: 0.2,
          cd: 0,
          hits: 0,
        }));
      },
      onTick({ battle: b, unit: u, dt }) {
        if (!u.canAct) return;
        if (n !== 2) {
          u.trait.goldSelfCd -= dt;
          if (u.trait.goldSelfCd <= 0) {
            u.trait.goldSelfCd += u.s.interval;
            const e = enemies(b, u, 1)[0];
            if (e) damage(b, u, e, 1, 'arts');
          }
        }
        for (const d of u.trait.goldDrones) {
          d.cd -= dt;
          if (d.cd > 0) continue;
          d.cd += u.s.interval;
          if (!d.target?.alive) {
            d.target = (n === 2 ? b.aliveEnemies() : enemies(b, u))[0];
            d.scale = 0.2;
            d.hits = 0;
          }
          if (!d.target) continue;
          damage(b, u, d.target, d.scale, 'arts');
          d.scale = Math.min(1.1, d.scale + 0.15);
          d.hits++;
          if (n === 2) status(b, u, d.target, 'sluggish', bb['attack@sluggish']);
          if (b.rng() < Math.min(1, (t['attack@prob'] ?? 0.015) * d.hits) || d.hits >= t['attack@max_stack_cnt']) {
            area(b, u, d.target, 1.5, t['attack@atk_scale_2'], 'arts');
            d.target = null;
          }
        }
      },
    }),
    (b, u) => deploy(b, u, () => buff(b, u, 'goldenglow:resIgnore', { resIgnoreFlat: z.magic_resist_penetrate_fixed })),
  );
}

function weedy(bb, raw, def) {
  const n = raw.skill.index;
  const s =
    n === 0
      ? next(bb, {
          onHit({ battle: b, unit: u, target: e }) {
            if (e) {
              b.push(e, bb.force, { from: u, dir: u.dir });
              status(b, u, e, 'stun', bb.stun);
            }
          },
        })
      : n === 1
        ? timed(bb, raw, def, {
            targeting: { rangeExtend: bb.ability_range_forward_extend },
            attack: { attack: 'ranged', splashRadius: 1.1 },
            onHit({ battle: b, unit: u, target: e }) {
              if (e) b.push(e, bb.base_force_level, { from: u, dir: u.dir });
            },
          })
        : instant(({ battle: b, unit: u }) => {
            for (const x of [u, ...owned(b, u).filter((d) => Math.abs(d.x - u.x) + Math.abs(d.y - u.y) <= 1.5)]) {
              const e = enemies(b, x, 1)[0];
              if (!e) continue;
              area(b, u, e, 1.5, bb.atk_scale, 'arts', (a) => {
                b.push(a, bb.force + (x === u ? 0 : 1), { from: x, dir: x.dir });
                let px = a.x,
                  py = a.y;
                b.addBuff(a, {
                  key: `weedy:distance:${u.id}`,
                  duration: bb.duration,
                  interval: bb.interval,
                  onTick: () => {
                    const dist = Math.hypot(a.x - px, a.y - py);
                    px = a.x;
                    py = a.y;
                    if (dist > 0)
                      b.dealDamage(u, a, {
                        amount: (dist * bb.value) / bb.dist,
                        type: 'true',
                        tags: ['weedy:distance'],
                      });
                  },
                });
              });
            }
          });
  return kit(raw, s, (b, u) => {
    every(b, u, 2, () => {
      if (owned(b, u).some((d) => Math.abs(d.x - u.x) + Math.abs(d.y - u.y) <= 1.5)) {
        u.skill.gainSp(1, 'weedy');
      }
    });
    b.on(
      'damaged',
      (c) => {
        if (c.source?.ownerUnit === u && c.dmg.isAttack && c.target.side === 'enemy')
          b.push(c.target, 1, { from: c.source, dir: c.source.dir });
      },
      { owner: u },
    );
    b.on(
      'deploy',
      ({ unit: d }) => {
        if (d.ownerUnit !== u) return;
        if (/攻击力额外/.test(talText(raw, 1))) buff(b, d, 'weedy:atk', { atkPct: 0.2 });
        after(b, d, 20, () => b.retreat(d, { reason: 'expired' }));
      },
      { owner: u },
    );
  });
}

function zumama(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  return kit(
    raw,
    timed(bb, raw, def, {
      mods: {
        atkPct: bb.atk,
        defPct: bb.def ?? 0,
        batPct: (bb.base_attack_time ?? 0) / raw.stats.bat,
        blockCnt: bb.block_cnt ?? 0,
        hpRegenRatio: bb.hp_recovery_per_sec_by_max_hp_ratio ?? 0,
      },
      onTick({ battle: b, unit: u }) {
        if (n === 1) for (const e of b.blockedTargets(u, u.profile)) status(b, u, e, 'stun', 0.2);
      },
      onEnd({ battle: b, unit: u, reason }) {
        if (n === 2 && reason !== 'death') status(b, u, u, 'stun', bb.stun);
      },
    }),
    (b, u) => {
      every(b, u, 0.1, () =>
        buff(
          b,
          u,
          'eunectes:talents',
          {
            dmgDealtMul: u.hpRatio > t.hp_ratio ? t.atk_scale : 1,
            dmgTakenMul: u.hpRatio <= t.hp_ratio ? 1 - t.damage_resistance : 1,
            spRecoveryFlat: u.blocking.length ? z.sp_recovery_per_sec : 0,
          },
          0.2,
        ),
      );
      b.on(
        'spGain',
        (c) => {
          if (c.unit === u && c.reason === 'time' && !u.blocking.length) c.amount = 0;
        },
        { owner: u },
      );
    },
  );
}

function ash(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const flash = (b, u) => {
    const e = enemies(b, u, 1)[0];
    if (e) for (const x of b.foesInRadius(e.x, e.y, 1.5)) status(b, u, x, 'stun', t.stun);
  };
  const s =
    n === 0
      ? timed(bb, raw, def, { attack: { hits: 2 } })
      : n === 1
        ? timed(bb, raw, def, {
            kind: 'ammo',
            ammo: 31,
            onStart({ battle: b, unit: u }) {
              flash(b, u);
            },
            attack: { dmgMul: (b, u, e) => (e.s.flags.stun ? bb['ash_s_2[atk_scale].atk_scale'] : 1) },
          })
        : instant(({ battle: b, unit: u, skill }) => {
            const xs = enemies(b, u);
            for (const e of xs) {
              damage(b, u, e, bb.atk_scale);
              b.push(e, bb.force, { from: u, dir: u.dir });
            }
            if (xs.length) area(b, u, xs[xs.length - 1], bb.range_radius, bb.not_hitwall_scale);
            if (skill.activations >= 2) skill.noSkill = true;
          });
  return kit(raw, s, (b, u) => {
    let first = true;
    deploy(b, u, () => {
      if (n === 2) u.skill.noSkill = false;
      flash(b, u);
      if (first) {
        u.skill.gainSp(z.sp, 'ash');
        first = false;
      }
    });
  });
}

function sleach(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0);
  return kit(
    raw,
    timed({}, raw, def, {
      attack: { noAttack: true },
      onStart({ battle: b, unit: u }) {
        u.trait.flagDp = 0;
        u.trait.flag = u;
        if (n === 1) {
          u.trait.flag =
            b
              .alliesFor(u)
              .filter((a) => inRange(u, a))
              .sort((a, z) => a.hpRatio - z.hpRatio)[0] ?? u;
        }
        if (n === 2) {
          b.addDp(u.ownerId, bb.cost);
          const e = enemies(b, u).find((e) => !e.isFlying);
          if (e) {
            u.trait.flag = { x: e.x, y: e.y };
            area(b, u, e, 1.5, bb.atk_scale, 'phys', (e) => status(b, u, e, 'stun', bb.stun));
          }
        }
      },
      onTick({ battle: b, unit: u, dt }) {
        if (n < 2) {
          u.trait.flagDp += dt;
          const iv = bb.interval ?? bb['sleach_s_2[cost].interval'];
          while (u.trait.flagDp >= iv) {
            u.trait.flagDp -= iv;
            b.addDp(u.ownerId, 1);
          }
        }
        if (n === 1 && alive(u.trait.flag))
          buff(
            b,
            u.trait.flag,
            'saileach:heal',
            { defPct: bb.def, hpRegen: u.s.atk * bb.atk_to_hp_recovery_ratio },
            0.2,
          );
        if (n === 2)
          for (const e of b.foesInRadius(u.trait.flag.x, u.trait.flag.y, 1.5)) {
            status(b, u, e, 'sluggish', 0.2);
            buff(b, e, 'saileach:fragile', { dmgTakenMul: bb.damage_scale }, 0.2);
          }
      },
      onEnd({ unit: u }) {
        u.trait.flag = u;
      },
    }),
    (b, u) => {
      every(b, u, 0.2, () => {
        const p = u.trait.flag ?? u;
        for (const a of b.alliesFor(u).filter((a) => Math.hypot(a.x - p.x, a.y - p.y) <= 1.5))
          buff(b, a, 'saileach:speed', { aspd: t['sleach_t_1[ally].attack_speed'] }, 0.3);
        for (const e of b.foesInRadius(p.x, p.y, 1.5))
          buff(b, e, 'saileach:slow', { aspd: t['sleach_t_1[enemy].attack_speed'] }, 0.3);
      });
    },
  );
}

function pallas(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const front = (b, u) => {
    const [r, c] = frontOf(u.tileR, u.tileC, u.dir);
    const a = b.unitAt(r, c);
    return a?.side === 'ally' && a.kind === 'op' ? a : u;
  };
  const s =
    n === 0
      ? next(bb, { attack: { atkScale: bb.atk_scale, hits: 2 } })
      : timed(bb, raw, def, {
          targeting: { rangeExtend: bb.ability_range_forward_extend ?? 0, maxTargets: bb['attack@max_target'] ?? 1 },
          onHit({ battle: b, unit: u, target: e }) {
            if (n === 1 && e && b.rng() < bb['attack@buff_prob']) status(b, u, e, 'stun', bb['attack@stun']);
          },
          onTick({ battle: b, unit: u }) {
            if (n === 2) {
              const a = front(b, u);
              buff(
                b,
                a,
                'pallas:valor',
                {
                  atkPct: a.hpRatio > bb['attack@peak_performance.hp_ratio'] ? bb['attack@peak_performance.atk'] : 0,
                  defPct: bb['attack@def'],
                  blockCnt: bb['attack@block_cnt'],
                },
                0.2,
              );
            }
          },
        });
  return kit(raw, s, (b, u) => {
    onHit(b, u, () => {
      b.heal(u, u, z.value, { self: true });
      const a = front(b, u);
      if (a !== u) b.heal(u, a, z.value);
    });
    every(b, u, 0.2, () => {
      for (const a of b.alliesFor(u))
        if (a.def.raw?.nationId === 'minos' || a === u)
          buff(
            b,
            a,
            'pallas:minos',
            { atkPct: a.hpRatio > t['peak_performance.hp_ratio'] ? t['peak_performance.atk'] : 0 },
            0.3,
          );
    });
  });
}

function chen2(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  return kit(
    raw,
    timed(bb, raw, def, {
      kind: 'ammo',
      ammo: bb['attack@trigger_time'],
      attack: { hits: n === 2 ? 2 : 1 },
      onAttack(c) {
        const { battle: b, unit: u, skill } = c;
        if (b.rng() < (t['e_spareshot_chen.prob'] ?? t['spareshot_chen.prob'])) c.noAmmo = true;
        if (n === 2 && !c.noAmmo) skill.ammoLeft--;
        if (n) {
          const keys = [...u.rangeKeys];
          b.addBuff(u, {
            key: `chen2:puddle:${b.time}`,
            duration: bb['attack@projectile_life_time'],
            interval: 0.1,
            onTick: () => {
              for (const e of b.enemiesInKeys(keys, u, { canHitFly: false }))
                buff(b, e, 'chen2:slow', { moveMul: 1 + bb['attack@move_speed'], defFlat: bb['attack@def'] }, 0.2);
            },
          });
        }
      },
    }),
    (b, u) => {
      deploy(b, u, () => buff(b, u, 'chen2:speed', { aspd: z['chen2_t_2[common].attack_speed'] }));
      const orig = u.profile.dmgMul;
      u.profile.dmgMul = (b, u, e) =>
        u.skill.active && (n === 0 || n === 2) ? (u.profile.frontScale ?? 1.5) : (orig?.(b, u, e) ?? 1);
    },
  );
}

function yato2(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 0
      ? timed(bb, raw, def, {
          attack: { hits: 2 },
          onAttack({ battle: b, unit: u, targets }) {
            const e = targets[0];
            if (!e) return;
            if (u.trait.yatoTarget !== e.id) {
              u.trait.yatoTarget = e.id;
              u.trait.yatoCount = 0;
            }
            if (++u.trait.yatoCount % 3 === 0)
              for (let i = 0; i < 4; i++) damage(b, u, e, 1, 'phys', { isAttack: true });
          },
        })
      : { kind: 'passive' };
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => {
      buff(
        b,
        u,
        'yato:atk',
        { atkPct: z.atk + (z['yato2_e_002[atk].atk'] ?? 0) },
        (def.skill.duration > 0 ? def.skill.duration : 3) + z.duration,
      );
      if (n === 0) {
        u.skill.activate('deploy', { free: true });
        return;
      }
      buff(b, u, 'yato:raid', {}, n === 1 ? 1.6 : 2, { flags: { invulnerable: n === 2, disarm: true } });
      if (n === 1)
        for (let i = 0; i < 16; i++)
          after(b, u, i * 0.1, () => {
            for (const e of enemies(b, u)) damage(b, u, e, bb.atk_scale, 'phys', { isAttack: true });
          });
      else {
        let length = bb.min_dist;
        for (let d = 0, i = 0; d <= bb.max_dist; d += bb.dist_interval, i++) {
          const dist = d;
          after(b, u, i * 0.03, () => {
            if (dist > length) return;
            const [dr, dc] = rotateOffset(0, dist, u.dir);
            const p = { x: u.x + dc, y: u.y + dr };
            const xs = b.foesInRadius(p.x, p.y, 0.75);
            for (const e of xs) damage(b, u, e, bb.atk_scale, 'phys', { isAttack: true });
            length = Math.min(bb.max_dist, length + xs.length * bb.dist_unit);
          });
        }
      }
    });
    onHit(b, u, ({ target: e }) =>
      damage(b, u, e, t['attack@atk_scale_1'] * (n === 1 ? bb.talent_scale_display : 1), 'arts'),
    );
  });
}

function slent2(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  return kit(
    raw,
    timed(bb, raw, def, {
      attack: { dmgType: 'heal', healScale: 0.75, heal: { mode: 'single' } },
      onStart({ unit: u }) {
        u.trait.silentSave = false;
      },
    }),
    (b, u) => {
      every(b, u, 0.2, () => {
        for (const a of b.alliesFor(u).filter((a) => inRange(u, a))) {
          const scale = u.skill.active
            ? n === 2
              ? bb.talent_scale
              : n === 1 && owned(b, u).some((d) => Math.hypot(d.x - a.x, d.y - a.y) <= 1.5)
                ? bb.damage_resistance_scale
                : 1
            : 1;
          const resist = Math.min(
            0.95,
            (t.damage_resistance_base + Math.max(0, 1 - Math.max(a.hpRatio, t.min_hp_ratio)) * 0.2) * scale,
          );
          buff(
            b,
            a,
            'silence:ward',
            {
              dmgTakenMul: 1 - resist,
              hpPct: talent(raw, -1).max_hp ?? 0,
              hpRegen:
                a.hpRatio < z.hp_ratio
                  ? u.s.atk * z.atk_to_hp_recovery_ratio * (a.def.raw?.nationId === 'rhine' ? 2 : 1)
                  : 0,
            },
            0.3,
          );
        }
      });
      b.on(
        'fatal',
        (c) => {
          if (n !== 2 || !u.skill.active || u.trait.silentSave || c.unit.kind !== 'op' || !inRange(u, c.unit)) return;
          u.trait.silentSave = true;
          c.prevented = true;
          buff(b, c.unit, 'silence:undying', {}, bb.grave_duration);
        },
        { owner: u, priority: 20 },
      );
      b.on(
        'fatal',
        (c) => {
          if (c.unit.findBuff('silence:undying')) c.prevented = true;
        },
        { owner: u, priority: 10 },
      );
      b.on(
        'skillEnd',
        (c) => {
          if (c.unit === u) for (const d of owned(b, u)) b.retreat(d, { reason: 'expired' });
        },
        { owner: u },
      );
    },
  );
}

function jesca2(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  return kit(
    raw,
    timed(bb, raw, def, {
      ...(n === 2 ? { kind: 'ammo', ammo: bb['attack@trigger_time'] } : {}),
      mods: {
        atkPct: bb.atk,
        defPct: bb['jesca2_s_3[def].def'] ?? bb.def ?? 0,
        batPct: (bb.base_attack_time ?? 0) / raw.stats.bat,
        dodgePhys: n === 1 ? bb.prob : 0,
        dodgeArts: n === 1 ? bb.prob : 0,
      },
      targeting: {
        ...(def.skill.rangeGrid ? { rangeGrid: def.skill.rangeGrid } : {}),
        rangeExtend: bb.ability_range_forward_extend ?? 0,
      },
      onStart({ battle: b, unit: u }) {
        if (n === 2 && owned(b, u).length) {
          const e = enemies(b, u, 1)[0];
          if (e)
            area(b, u, e, bb['attack@extrabomb.projectile_range'], bb['attack@extrabomb.atk_scale'], 'phys', (e) =>
              status(b, u, e, 'stun', bb['attack@extrabomb.stun']),
            );
        }
      },
      onTick({ battle: b, unit: u }) {
        for (const d of owned(b, u))
          buff(b, d, 'jessica:shieldDef', { defPct: n === 2 ? bb['jesca2_s_3_token[def].def'] : (bb.def ?? 0) }, 0.2);
      },
    }),
    (b, u) => {
      b.on(
        'deploy',
        ({ unit: d }) => {
          if (d.ownerUnit !== u) return;
          const dx = d.x - u.x,
            dy = d.y - u.y;
          u.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'RIGHT' : 'LEFT') : dy > 0 ? 'DOWN' : 'UP';
          b.refreshRange(u);
          buff(b, u, 'jessica:def', { defPct: t.def });
          after(b, d, 60 + (n === 0 ? bb.duration : 0), () => b.retreat(d, { reason: 'expired' }));
        },
        { owner: u },
      );
      b.on(
        'damaged',
        (c) => {
          if (c.target.ownerUnit === u && b.rng() < z.prob) u.skill.gainSp(z.sp, 'jessica');
        },
        { owner: u },
      );
    },
  );
}

function wisdel(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0);
  const spawn = (b, u, count) => {
    for (let i = 0; i < count && owned(b, u).length < 3; i++) summonToken(b, u, 'token_10035_wisdel_wward', 'melee');
  };
  const s =
    n === 0
      ? next(bb, {
          attack: { splashRadius: 1.5 },
          onHit({ battle: b, unit: u, target: e }) {
            if (e)
              for (let i = 1; i <= 3; i++)
                after(b, u, i * 0.3, () =>
                  area(b, u, e, 1.5, bb.append_atk_scale, 'phys', (e) => status(b, u, e, 'stun', bb.stun_duration)),
                );
          },
        })
      : timed(bb, raw, def, {
          ...(n === 2 ? { kind: 'ammo', ammo: bb['attack@trigger_time'] } : {}),
          targeting: n === 1 ? { maxTargets: 3 } : undefined,
          attack: n === 2 ? { atkScale: bb['attack@atk_scale_3'], splashRadius: 2 } : undefined,
          onStart({ battle: b, unit: u }) {
            if (n === 2) spawn(b, u, bb.max_cnt);
          },
          onTick({ unit: u, skill }) {
            if (n === 1) {
              const overload = skill.timeLeft <= skill.duration / 2;
              skill.spec.attack = overload ? { atkScale: bb['attack@atk_scale_ol'], hits: 4 } : {};
              skill.spec.targeting = { maxTargets: overload ? 1 : 3 };
            }
          },
        });
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => spawn(b, u, 1));
    b.on(
      'hit',
      (c) => {
        if (c.source !== u) return;
        if (c.dmg.isAttack && !c.dmg.isSplash) {
          c.dmg.amount *= t['attack@main_atk_scale'];
          c.target.trait.wisdelMark = true;
        }
        if (
          c.dmg.tags?.includes('aftershock') &&
          c.target.trait.wisdelMark &&
          b.rng() < (n === 2 && u.skill.active ? bb['attack@prob'] : t['attack@prob'])
        ) {
          c.target.trait.wisdelMark = false;
          area(b, u, c.target, t['attack@range_radius'], t['attack@bomb_atk_scale'], 'phys', (e) =>
            status(b, u, e, 'stun', t['attack@stun']),
          );
        }
      },
      { owner: u },
    );
    every(b, u, 0.2, () => {
      if (owned(b, u).some((d) => Math.hypot(d.x - u.x, d.y - u.y) <= 1.5)) status(b, u, u, 'camou', 0.3);
    });
  });
}

export default {
  char_300_phenxi: phenxi,
  char_322_lmlee: lmlee,
  char_340_shwaz: shwaz,
  char_362_saga: saga,
  char_377_gdglow: gdglow,
  char_400_weedy: weedy,
  char_416_zumama: zumama,
  char_456_ash: ash,
  char_479_sleach: sleach,
  char_485_pallas: pallas,
  char_1013_chen2: chen2,
  char_1029_yato2: yato2,
  char_1031_slent2: slent2,
  char_1034_jesca2: jesca2,
  char_1035_wisdel: wisdel,
};
