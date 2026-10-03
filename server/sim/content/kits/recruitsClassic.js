// Classic six-star recruit kits. Summon pieces use the player's deployed board positions.
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

function kalts(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    text = talText(raw, 1);
  const mon = (b, u) => owned(b, u, 'token_10002_kalts_mon3tr');
  const key = 'kalts:command';
  const spec = timed({}, raw, def, {
    mods: n === 0 ? { defPct: bb.def, dodgePhys: bb.prob } : n === 1 ? { aspd: bb.attack_speed } : {},
    trigger: n ? { rule: 'CUSTOM_RANGE', grid: [] } : undefined,
    onStart({ battle: b, unit: u }) {
      u.trait.monKills = 0;
      for (const m of mon(b, u)) m.profile.hitAllBlocked = n === 1;
    },
    onTick({ battle: b, unit: u, skill }) {
      for (const m of mon(b, u)) {
        buff(
          b,
          m,
          key,
          {
            defPct: bb['attack@def'] ?? 0,
            atkPct: (bb['attack@atk'] ?? 0) * (n === 2 ? skill.timeLeft / skill.duration : 1),
          },
          0.2,
        );
      }
    },
    onEnd({ battle: b, unit: u, reason }) {
      for (const m of mon(b, u)) {
        b.removeBuff(m, key);
        m.profile.hitAllBlocked = false;
        if (n === 2 && reason !== 'death' && !u.trait.monKills)
          b.loseHp(m, m.s.maxHp * bb['attack@hp_ratio'], { source: u });
      }
    },
  });
  return kit(raw, spec, (b, u) => {
    b.on(
      'beforeAttack',
      (c) => {
        if (c.attacker !== u) return;
        const prefer = [u, ...mon(b, u)].filter((x) => alive(x) && inRange(u, x) && x.hp < x.s.maxHp);
        prefer.sort((a, z) => a.hpRatio - z.hpRatio);
        if (prefer.length) c.targets = [prefer[0]];
      },
      { owner: u },
    );
    b.on(
      'heal',
      (c) => {
        if (c.target.ownerUnit === u && c.target.def.id === 'token_10002_kalts_mon3tr' && c.source !== u) c.amount = 0;
      },
      { owner: u },
    );
    b.on(
      'hit',
      (c) => {
        if (c.source?.ownerUnit === u && c.dmg.isAttack && n === 2 && u.skill.active) c.dmg.type = 'true';
      },
      { owner: u },
    );
    b.on(
      'kill',
      (c) => {
        if (c.killer?.ownerUnit === u && u.skill.active) u.trait.monKills++;
      },
      { owner: u },
    );
    const burst = (m) => {
      const amount = +(text.match(/造成([\d.]+)点真实/)?.[1] ?? 1200),
        stun = +(text.match(/晕眩([\d.]+)秒/)?.[1] ?? 3);
      for (const e of b.foesInRadius(m.x, m.y, 1.5)) {
        b.dealDamage(m, e, { amount, type: 'true', tags: ['mon3tr:rebuild'] });
        status(b, m, e, 'stun', stun);
      }
    };
    b.on(
      'deploy',
      (c) => {
        if (c.unit.ownerUnit === u) c.unit.trait.kaltsHalf = false;
      },
      { owner: u },
    );
    b.on(
      'damaged',
      (c) => {
        if (
          c.target.ownerUnit !== u ||
          !/首次低于50%/.test(text) ||
          c.target.trait.kaltsHalf ||
          c.target.hpRatio >= 0.5
        )
          return;
        c.target.trait.kaltsHalf = true;
        burst(c.target);
      },
      { owner: u },
    );
    b.on(
      'death',
      (c) => {
        if (c.unit === u) for (const m of mon(b, u)) b.retreat(m, { reason: 'retreat' });
        if (c.unit.ownerUnit === u) {
          if (c.reason === 'killed') burst(c.unit);
          if (u.skill.active && n) u.skill.end('summonDeath');
        }
      },
      { owner: u },
    );
    every(b, u, 0.1, () => {
      for (const m of mon(b, u))
        buff(
          b,
          m,
          'kalts:range',
          inRange(u, m) ? { defPct: t.def ?? 0, aspd: t.attack_speed ?? 0 } : { defMul: 0 },
          0.2,
        );
      if (n && u.canAct && !u.s.flags.silence && u.skill.ready && !u.skill.active && !u.skill.opCooling && mon(b, u).some((m) => enemies(b, m).length))
        u.skill.activate('DEFAULT');
    });
    b.on(
      'spGain',
      (c) => {
        if (c.unit === u && n && c.reason === 'time' && !mon(b, u).length) c.amount = 0;
      },
      { owner: u },
    );
  });
}

function chen(bb, raw, def) {
  const n = raw.skill.index,
    a = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 0
      ? next(bb, { onHit: ({ battle: b, unit: u, target: e }) => e && status(b, u, e, 'stun', bb.stun) })
      : instant(
          ({ battle: b, unit: u }) => {
            if (n === 1)
              for (const e of enemies(b, u, bb.max_target)) {
                damage(b, u, e, bb.atk_scale);
                damage(b, u, e, bb.atk_scale, 'arts');
              }
            else {
              buff(b, u, 'chen:slash', {}, 1.1, { flags: { invulnerable: true, disarm: true } });
              for (let i = 0; i < bb.times; i++)
                after(b, u, i * 0.1, () => {
                  const e = enemies(b, u, 1, 'nearest')[0];
                  if (!e) return;
                  damage(b, u, e, bb.atk_scale);
                  if (i === bb.times - 1) status(b, u, e, 'stun', bb.stun);
                });
            }
          },
          { targeting: def.skill.rangeGrid ? { rangeGrid: def.skill.rangeGrid } : undefined },
        );
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => buff(b, u, 'chen:talent', { atkPct: z.atk, defPct: z.def, dodgePhys: z.prob }));
    every(b, u, a.interval, () => {
      for (const x of b.alliesFor(u)) if (['attack', 'hurt'].includes(x.skill?.spType)) x.skill.gainSp(a.sp, 'chen');
      if (/自身额外/.test(talText(raw, 0))) u.skill.gainSp(a.sp, 'chen:self');
    });
  });
}

function huang(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 0
      ? next(bb)
      : n === 1
        ? timed(bb, raw, def, { targeting: { rangeExtend: 1 } })
        : timed({}, raw, def, {
            onTick({ battle: b, unit: u, skill }) {
              const f = 1 - skill.timeLeft / skill.duration;
              buff(b, u, 'huang:ramp', { atkPct: bb.atk * f, defPct: bb.def * f }, 0.2);
            },
            onEnd({ battle: b, unit: u, reason }) {
              if (reason !== 'death') {
                area(b, u, u, 1.5, bb.damage_by_atk_scale);
                b.loseHp(u, u.s.maxHp * bb.hp_ratio, { source: u });
              }
              b.removeBuff(u, 'huang:ramp');
            },
          });
  return kit(raw, s, (b, u) => {
    let used = false,
      lockedUntil = -1;
    const trigger = () => {
      if (used || u.hpRatio >= t.hp_ratio) return;
      used = true;
      lockedUntil = b.time + t['huang_t_1[lock].duration'];
      b.heal(u, u, u.s.maxHp * t['huang_t_1[heal].hp_ratio'], { self: true });
    };
    b.on(
      'fatal',
      (c) => {
        if (c.unit !== u) return;
        trigger();
        if (b.time < lockedUntil) {
          c.prevented = true;
          u.hp = u.s.maxHp * t['huang_t_1[lock].min_hp_ratio'];
        }
      },
      { owner: u },
    );
    b.on(
      'damaged',
      (c) => {
        if (c.target === u) {
          trigger();
          if (b.time < lockedUntil) u.hp = Math.max(u.hp, u.s.maxHp * t['huang_t_1[lock].min_hp_ratio']);
        }
      },
      { owner: u },
    );
    deploy(b, u, () => {
      after(b, u, z.interval, () => status(b, u, u, 'resist', Infinity));
      if (z['huang_t_2[e_002_atk].atk'])
        after(b, u, z['huang_t_2[e_002_atk].interval'], () =>
          buff(b, u, 'huang:atk', { atkPct: z['huang_t_2[e_002_atk].atk'] }),
        );
      if (z['huang_t_2[e_002_atk_speed].attack_speed'])
        after(b, u, z['huang_t_2[e_002_atk_speed].interval'], () =>
          buff(b, u, 'huang:aspd', { aspd: z['huang_t_2[e_002_atk_speed].attack_speed'] }),
        );
    });
  });
}

function siege(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 0
      ? instant(({ battle: b, unit: u }) => b.addDp(u.ownerId, bb.cost))
      : n === 1
        ? instant(({ battle: b, unit: u }) => {
            area(b, u, u, 1.5, bb.atk_scale);
            b.addDp(u.ownerId, bb.cost);
          })
        : timed(bb, raw, def, {
            attack: { atkScale: bb['attack@atk_scale'] },
            onHit({ battle: b, unit: u, target: e }) {
              if (e && b.rng() < bb['attack@buff_prob']) status(b, u, e, 'stun', bb['attack@stun']);
            },
          });
  return kit(raw, s, (b, u) => {
    every(b, u, 0.25, () => {
      for (const x of b.alliesFor(u))
        if (x.def.profession === 'PIONEER') buff(b, x, 'siege:vanguards', { atkPct: t.atk, defPct: t.def }, 0.4);
    });
    if (/自身.*额外/.test(talText(raw, 0)))
      deploy(b, u, () => buff(b, u, 'siege:self', { atkPct: t.atk, defPct: t.def }));
    b.on(
      'death',
      ({ unit: e }) => {
        if (alive(u) && e.side === 'enemy' && Math.abs(e.x - u.x) + Math.abs(e.y - u.y) <= 1.5)
          u.skill.gainSp(z.sp, 'siege');
      },
      { owner: u },
    );
  });
}

function cqbw(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const blast = (b, u, p) => area(b, u, p, 1.5, bb.atk_scale, 'phys', (e) => status(b, u, e, 'stun', bb.stun));
  const s = instant(({ battle: b, unit: u }) => {
    if (n === 1)
      summonToken(b, u, 'token_10008_cqbw_box', 'path', {
        spawn: {
          duration: 120,
          untargetable: true,
          kit: {
            skill: null,
            trait: { noAttack: true },
            install(b, mine) {
              every(b, mine, 0.1, () => {
                if (b.enemiesInRadius(mine.x, mine.y, 0.6).some((e) => !e.isFlying)) {
                  blast(b, u, mine);
                  b.retreat(mine, { reason: 'expired', permanent: true });
                }
              });
            },
          },
        },
      });
    else
      for (const e of enemies(b, u, n === 2 ? bb.max_target : 1, n === 2 ? 'highestHp' : undefined)) {
        if (n === 0) blast(b, u, e);
        else after(b, u, 3, () => blast(b, u, e)); // D12 fuse: 3 s.
      }
  });
  return kit(raw, s, (b, u) => {
    deploy(b, u, () =>
      after(b, u, t.interval, () =>
        buff(b, u, 'w:hide', { dodgePhys: t.prob, dodgeArts: t.prob, taunt: t.taunt_level }),
      ),
    );
    every(b, u, 0.2, () => {
      for (const e of enemies(b, u))
        if (e.s.flags.stun) buff(b, e, 'w:stunWeak', { physTakenMul: z.damage_scale }, 0.25);
    });
    b.on(
      'kill',
      ({ killer }) => {
        if (killer === u && z.sp) u.skill.gainSp(z.sp, 'w');
      },
      { owner: u },
    );
  });
}

function ifrit(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 0
      ? timed(bb, raw, def)
      : n === 1
        ? next(bb, {
            attack: {
              atkScale: bb.atk_scale,
              onEachHit({ battle: b, unit: u, target: e }) {
                buff(b, e, 'ifrit:armor', { defFlat: bb.def }, bb.duration);
                dot(b, u, e, 'ifrit:burn', u.s.atk * bb['burn.atk_scale'], bb.duration);
              },
            },
          })
        : timed({}, raw, def, {
            attack: { noAttack: true },
            onStart({ unit: u }) {
              u.trait.ifritTick = 0;
            },
            onTick({ battle: b, unit: u, dt }) {
              u.trait.ifritTick += dt;
              if (u.trait.ifritTick < 1) return;
              u.trait.ifritTick -= 1;
              for (const e of enemies(b, u))
                if (!e.isFlying) {
                  buff(b, e, 'ifrit:skillRes', { resFlat: bb.magic_resistance }, 1.1);
                  damage(b, u, e, bb.atk_scale, 'arts');
                }
              b.loseHp(u, u.s.maxHp * bb.hp_ratio, { source: u });
            },
          });
  return kit(raw, s, (b, u) => {
    every(b, u, 0.2, () => {
      for (const e of enemies(b, u)) buff(b, e, 'ifrit:res', { resMul: 1 + t.magic_resistance }, 0.3);
    });
    every(b, u, z.interval, () =>
      u.skill.gainSp(
        z.sp + (b.rng() < (z['ifrit_e_002[dice_sp].prob'] ?? 0) ? z['ifrit_e_002[dice_sp].sp'] : 0),
        'ifrit',
      ),
    );
  });
}

function shining(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 1
      ? next(
          {},
          {
            attack: { healScale: 1 },
            onHit({ battle: b, unit: u, target: a }) {
              if (a) buff(b, a, 'shining:shield', { defPct: bb.def }, bb.duration, { shield: u.s.atk * bb.atk_scale });
            },
          },
        )
      : timed(bb, raw, def, { mods: { atkPct: bb.atk, aspd: bb.attack_speed ?? 0 } });
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => buff(b, u, 'shining:aspd', { aspd: z.attack_speed }));
    every(b, u, 0.2, () => {
      for (const a of b.alliesFor(u).filter((a) => inRange(u, a)))
        buff(
          b,
          a,
          'shining:def',
          {
            defFlat: t.def + (a.def.position === 'MELEE' ? (t.def_lowland ?? 0) : 0),
            defPct: n === 2 && u.skill.active ? bb.def : 0,
          },
          0.3,
        );
    });
  });
}

function cgbird(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0);
  const s =
    n === 1
      ? next(
          {},
          {
            attack: { healScale: 1 },
            onHit({ battle: b, unit: u, target: a }) {
              if (a)
                buff(b, a, 'nightingale:shield', { resFlat: bb.magic_resistance }, bb.duration, {
                  shield: u.s.atk * bb.atk_scale,
                  tags: ['artsShield'],
                });
            },
          },
        )
      : timed(bb, raw, def, { mods: { atkPct: bb.atk } });
  return kit(raw, s, (b, u) => {
    every(b, u, 0.2, () => {
      for (const a of b.alliesFor(u).filter((a) => inRange(u, a)))
        buff(
          b,
          a,
          'nightingale:res',
          {
            resFlat: t.magic_resistance,
            healingTakenMul: t.heal_scale ?? 1,
            resMul: n === 2 && u.skill.active ? 1 + bb.magic_resistance : 1,
            dodgeArts: n === 2 && u.skill.active ? bb.prob : 0,
          },
          0.3,
        );
    });
  });
}

function amgoat(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 0
      ? timed({}, raw, def, {
          onStart({ battle: b, unit: u, skill }) {
            buff(
              b,
              u,
              'eyja:duet',
              { aspd: bb['amgoat_s_1[a].attack_speed'], atkPct: skill.activations > 1 ? bb['amgoat_s_1[b].atk'] : 0 },
              skill.duration,
            );
          },
          onEnd({ battle: b, unit: u }) {
            b.removeBuff(u, 'eyja:duet');
          },
        })
      : n === 1
        ? next(bb, {
            attack: {
              atkScale: bb.fk,
              splashRadius: 1.5,
              splashScale: 0.5,
              onEachHit({ battle: b, target: e }) {
                buff(b, e, 'eyja:res', { resMul: 1 + bb.magic_resistance }, bb.duration);
              },
            },
          })
        : timed(bb, raw, def, { targeting: { rangeGrid: def.skill.rangeGrid, maxTargets: bb['attack@max_target'] } });
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => u.skill.gainSp(z.sp_min + Math.floor(b.rng() * (z.sp_max - z.sp_min)), 'eyja'));
    every(b, u, 0.25, () => {
      for (const a of b.alliesFor(u))
        if (a.def.profession === 'CASTER') buff(b, a, 'eyja:casters', { atkPct: t.atk }, 0.4);
    });
  });
}

function helage(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s =
    n === 0
      ? next(bb, { attack: { atkScale: bb.atk_scale, hits: 2 } })
      : timed(
          bb,
          raw,
          def,
          n === 1
            ? { mods: { atkPct: bb.atk, dodgePhys: bb.prob }, attack: { hits: 2 } }
            : { targeting: { rangeExtend: bb.ability_range_forward_extend, maxTargets: bb['attack@max_target'] } },
        );
  return kit(raw, s, (b, u) =>
    every(b, u, 0.1, () =>
      buff(
        b,
        u,
        'hellagur:talents',
        {
          aspd: t.min_attack_speed * Math.min(1, (1 - u.hpRatio) / (1 - t.min_hp_ratio)),
          hpRegen: b.blockedTargets(u, u.profile).length ? 0 : z.hp_recovery_per_sec,
          dmgTakenMul: u.hpRatio < (t.hp_ratio ?? 0) ? 1 - (t.damage_resistance ?? 0) : 1,
        },
        0.2,
      ),
    ),
  );
}

function poca(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0);
  const s =
    n < 2
      ? timed(bb, raw, def, { targeting: { maxTargets: bb['attack@max_target'] ?? 1 } })
      : timed(bb, raw, def, {
          duration: bb.hit_duration,
          attack: { noAttack: true },
          onStart({ battle: b, unit: u }) {
            u.trait.pocaTargets = enemies(b, u, bb.max_target, 'heaviest');
            u.trait.pocaTick = 0;
            for (const e of u.trait.pocaTargets) status(b, u, e, 'bind', bb.hit_duration);
          },
          onTick({ battle: b, unit: u, dt, skill }) {
            const xs = u.trait.pocaTargets.filter((e) => e.alive);
            if (!xs.length) {
              skill.end('targetsDead');
              return;
            }
            u.trait.pocaTick += dt;
            if (u.trait.pocaTick >= bb.hit_interval) {
              u.trait.pocaTick -= bb.hit_interval;
              for (const e of xs) damage(b, u, e, 1, 'phys', { isAttack: true });
            }
          },
          onEnd({ battle: b, unit: u }) {
            for (const e of u.trait.pocaTargets ?? []) b.removeStatus(e, 'bind');
          },
        });
  return kit(raw, s, (b, u) => {
    b.on(
      'hit',
      (c) => {
        if (c.source === u && c.dmg.isAttack && c.target.s.massLevel >= t.value)
          c.dmg.defIgnorePct = (c.dmg.defIgnorePct ?? 0) + t.def_penetrate;
      },
      { owner: u },
    );
    onHit(b, u, ({ target: e }) => {
      if (t.extra_atk_scale && e.s.massLevel >= t.value) damage(b, u, e, t.extra_atk_scale);
    });
  });
}

function haak(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s = timed(
    bb,
    raw,
    def,
    n
      ? {
          onStart({ battle: b, unit: u, skill }) {
            const xs = b.alliesFor(u).filter((a) => a !== u && inRange(u, a));
            xs.sort((a, z) => Math.hypot(a.x - u.x, a.y - u.y) - Math.hypot(z.x - u.x, z.y - u.y));
            const a = xs[0];
            if (!a) return;
            for (let i = 0; i < 15 && alive(a); i++)
              b.dealDamage(u, a, { amount: bb.damage, type: 'phys', isAttack: true, tags: ['aak:stim'] });
            const m = n === 1 ? { defPct: bb.def, hpPct: bb.max_hp } : { atkPct: bb.atk, aspd: bb.attack_speed };
            if (alive(a)) buff(b, a, 'aak:stim', m, skill.duration);
            // Self max HP belongs to the stim too (the standard modifier helper only covers ATK/DEF/ASPD).
            if (n === 1) buff(b, u, 'aak:hp', { hpPct: bb.max_hp }, skill.duration);
          },
        }
      : {},
  );
  return kit(raw, s, (b, u) => {
    deploy(b, u, () => buff(b, u, 'aak:healing', { healingTakenMul: z.heal_scale }));
    b.on(
      'hit',
      (c) => {
        if (c.source !== u || !c.dmg.isAttack || c.target.side !== 'enemy') return;
        const all = b.rng() < (t.prob ?? 0),
          roll = Math.floor(b.rng() * 4);
        if (all || roll === 0) b.heal(u, u, u.s.maxHp * t.hp_ratio, { self: true });
        if (all || roll === 1) c.dmg.amount *= t.atk_scale;
        if (all || roll === 2) status(b, u, c.target, 'sluggish', t.sluggish);
        if (all || roll === 3) status(b, u, c.target, 'stun', t.stun);
      },
      { owner: u },
    );
  });
}

function mgllan(bb, raw, def) {
  const n = raw.skill.index;
  return kit(
    raw,
    timed(bb, raw, def, {
      mods: n ? { atkPct: bb.atk ?? 0, aspd: bb.attack_speed ?? 0 } : {},
      onEnd({ battle: b, unit: u }) {
        for (const d of owned(b, u)) b.retreat(d, { reason: 'retreat' });
      },
    }),
    (b, u) => {
      b.on(
        'deploy',
        ({ unit: d }) => {
          if (d.ownerUnit !== u) return;
          status(b, u, d, 'camou', +(talText(raw, 1).match(/(\d+)秒/)?.[1] ?? 20));
        },
        { owner: u },
      );
      if (n === 0)
        every(b, u, bb['attack@interval'], () => {
          for (const x of [u, ...owned(b, u)])
            for (const e of enemies(b, x))
              status(
                b,
                u,
                e,
                u.skill.active ? 'bind' : 'sluggish',
                u.skill.active ? bb['attack@frozen_duration'] : bb['attack@sluggish'],
              );
        });
      every(b, u, 0.1, () => {
        for (const d of owned(b, u)) {
          d.profile.noAttack = n === 0;
          d.profile.dmgType = n === 1 ? 'arts' : 'phys';
          d.profile.splashRadius = n === 2 ? (u.skill.active ? 1.5 : 1.1) : n === 1 && u.skill.active ? 1.1 : 0;
          buff(
            b,
            d,
            'magallan:command',
            { atkPct: u.skill.active ? (bb.atk ?? 0) : 0, aspd: u.skill.active ? (bb.attack_speed ?? 0) : 0 },
            0.2,
          );
        }
      });
      b.on(
        'death',
        ({ unit }) => {
          if (unit === u) for (const d of owned(b, u)) b.retreat(d, { reason: 'retreat' });
        },
        { owner: u },
      );
    },
  );
}

export function phantomDeploy(b, u, bb, n) {
  if (n === 0) {
    buff(b, u, 'phantom:cover', { dodgePhys: bb.prob }, bb.duration, {
      shield: u.s.maxHp * bb.hp_ratio,
      tags: ['physShield'],
    });
  } else if (n === 1) {
    u.trait.phantomStacks = bb.times;
    buff(b, u, 'phantom:stacks', { atkPct: bb.atk * bb.times });
  } else
    area(b, u, u, 1.5, bb.atk_scale, 'phys', (e) => {
      b.push(e, bb.force, { from: u });
      const k = ['sluggish', 'bind', 'stun'][Math.floor(b.rng() * 3)];
      status(b, u, e, k, bb.stun ?? bb.root);
    });
}
function phatom(bb, raw, def) {
  const n = raw.skill.index;
  return kit(raw, { kind: 'passive' }, (b, u) => {
    deploy(b, u, () => phantomDeploy(b, u, bb, n));
    onAttack(b, u, () => {
      if (n === 1) buff(b, u, 'phantom:stacks', { atkPct: bb.atk * Math.max(0, --u.trait.phantomStacks) });
    });
    b.on(
      'deploy',
      ({ unit: d }) => {
        if (d.ownerUnit !== u) return;
        phantomDeploy(b, d, bb, n);
      },
      { owner: u },
    );
    b.on(
      'attack',
      ({ attacker: d }) => {
        if (d.ownerUnit === u && n === 1)
          buff(b, d, 'phantom:stacks', { atkPct: bb.atk * Math.max(0, --d.trait.phantomStacks) });
      },
      { owner: u },
    );
  });
}

function thorns(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const s = timed(
    bb,
    raw,
    def,
    n === 1
      ? { attack: { noAttack: true } }
      : n === 2
        ? {
            onStart({ battle: b, unit: u, skill }) {
              if (skill.activations > 1) {
                skill.timeLeft = Infinity;
                buff(b, u, 'thorns:second', {
                  atkPct: bb['thorns_s_3[b].atk'] - bb.atk,
                  aspd: bb['thorns_s_3[b].attack_speed'] - bb.attack_speed,
                });
              }
            },
            onEnd({ battle: b, unit: u }) {
              b.removeBuff(u, 'thorns:second');
            },
          }
        : {},
  );
  return kit(raw, s, (b, u) => {
    let last = -Infinity,
      counter = -Infinity;
    onAttack(b, u, () => {
      last = b.time;
    });
    onHit(b, u, ({ target: e }) =>
      dot(
        b,
        u,
        e,
        'thorns:poison',
        e.def.applyWay === 'RANGED' ? t['damage[ranged]'] : t['damage[normal]'],
        t.duration,
        'arts',
        t.max_cnt ?? 1,
      ),
    );
    every(b, u, 1, () => {
      if (b.time - last >= z.delay) b.heal(u, u, u.s.maxHp * z.hp_recovery_per_sec_by_max_hp_ratio, { self: true });
    });
    b.on(
      'damaged',
      (c) => {
        if (c.target !== u || !c.dmg.isAttack || n !== 1 || !u.skill.active || b.time - counter < bb.cooldown) return;
        counter = b.time;
        for (const e of enemies(b, u, bb.max_target)) damage(b, u, e, 1, 'phys', { isAttack: true });
      },
      { owner: u },
    );
    // Override the lord's distance penalty only while S3 is active; melee attacks stay at 100%.
    const baseMul = u.profile.dmgMul;
    u.profile.dmgMul = (b, self, e) => (n === 2 && self.skill.active ? 1 : (baseMul?.(b, self, e) ?? 1));
  });
}

export default {
  char_003_kalts: kalts,
  char_010_chen: chen,
  char_017_huang: huang,
  char_112_siege: siege,
  char_113_cqbw: cqbw,
  char_134_ifrit: ifrit,
  char_147_shining: shining,
  char_179_cgbird: cgbird,
  char_180_amgoat: amgoat,
  char_188_helage: helage,
  char_197_poca: poca,
  char_225_haak: haak,
  char_248_mgllan: mgllan,
  char_250_phatom: phatom,
  char_293_thorns: thorns,
};
