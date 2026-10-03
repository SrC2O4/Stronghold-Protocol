// Summoners and deployable devices. Automatic placements never overwrite occupied/reserved tiles.
import { frontOf } from '../../dir.js';
import { genericSkillSpec } from '../generic.js';
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
  after,
  timed,
  next,
  instant,
  kit,
} from './recruitSupport.js';

function tokenId(b, u) {
  return (u.def.tokens ?? []).map((t) => (typeof t === 'string' ? t : t.tokenId)).find((id) => b.producesToken(u, id));
}
function grant(b, u, count = 1, cap = 3, opts = {}) {
  const id = tokenId(b, u);
  if (!id) return [];
  const out = [];
  for (let i = 0; i < count && owned(b, u).length < cap; i++) {
    const waiting = b.allyUnits.find((t) => t.ownerUnit === u && t.def.id === id && !t.alive && !t.removed);
    if (waiting && b.redeploy(waiting, { free: true })) {
      out.push(waiting);
      continue;
    }
    const d = summonToken(b, u, id, opts.placement ?? 'melee', { spawn: { ...opts.spawn } });
    if (d) out.push(d);
  }
  return out;
}
function onToken(b, u, fn) {
  b.on(
    'deploy',
    ({ unit: d }) => {
      if (d.ownerUnit === u) {
        if (d.skill) {
          d.skill.end('ownerManaged');
          d.skill.noSkill = true;
        }
        fn(d);
      }
    },
    { owner: u, priority: 100 },
  );
}
function retire(b, u) {
  for (const d of owned(b, u)) b.retreat(d, { reason: 'expired' });
}
function seed(bb, raw, def) {
  const s = genericSkillSpec(def.skill, bb, def);
  if (s.mods && bb.base_attack_time != null) s.mods.batPct = bb.base_attack_time / raw.stats.bat;
  return s;
}
const alliesNear = (b, u, p, r = 1.5) => b.alliesFor(u).filter((a) => Math.hypot(a.x - p.x, a.y - p.y) <= r);
const addShield = (b, a, key, value, cap) =>
  buff(b, a, key, {}, Infinity, { shield: Math.min(cap, (a.findBuff(key)?.shield ?? 0) + value) });

function necras(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1);
  const raise = (b, u) => {
    const xs = owned(b, u);
    if (xs.length < t.max_token_cnt) {
      const d = grant(b, u, 1, t.max_token_cnt)[0];
      if (d && n === 0) area(b, u, d, bb.range_radius, bb.atk_scale, 'arts');
      return d;
    }
    const d = xs.find((d) => !d.trait.necrasUp) ?? xs[0];
    d.trait.necrasUp = (d.trait.necrasUp ?? 0) + 1;
    buff(b, d, 'necras:upgrade', { hpPct: t.max_hp, atkPct: t.atk, defPct: t.def, blockCnt: t.block_cnt });
    d.hp = d.s.maxHp;
    if (n === 0) area(b, u, d, bb.range_radius, bb.atk_scale, 'arts');
    return d;
  };
  const s =
    n === 0
      ? instant(({ battle: b, unit: u }) => {
          const cnt = Math.max(1, owned(b, u).length);
          retire(b, u);
          for (let i = 0; i < cnt; i++) raise(b, u);
        })
      : n === 1
        ? timed({}, raw, def, {
            duration: bb.hit_duration,
            attack: { noAttack: true },
            onStart({ battle: b, unit: u }) {
              u.trait.necrasTargets = enemies(b, u, bb.max_target);
              u.trait.necrasCd = 0;
              for (const e of u.trait.necrasTargets) status(b, u, e, 'sleep', bb.hit_duration);
            },
            onTick({ battle: b, unit: u, dt }) {
              u.trait.necrasCd += dt;
              if (u.trait.necrasCd < bb.interval) return;
              u.trait.necrasCd -= bb.interval;
              for (const e of u.trait.necrasTargets)
                if (e.alive) damage(b, u, e, bb.atk_scale, 'arts', { ignoreSleep: true });
            },
          })
        : instant(({ battle: b, unit: u }) => {
            for (const e of enemies(b, u)) damage(b, u, e, bb['attack@atk_scale'], 'arts');
            const xs = owned(b, u);
            const d = xs[0] ?? raise(b, u);
            if (!d) return;
            for (const other of xs.slice(1, 3)) {
              b.retreat(other, { reason: 'expired', permanent: true });
              d.trait.necrasSpecial = Math.min(bb['attack@max_stack_cnt'], (d.trait.necrasSpecial ?? 0) + 1);
              const k = d.trait.necrasSpecial;
              buff(b, d, 'necras:special', {
                atkPct: bb['attack@atk'] * k,
                defPct: bb['attack@def'] * k,
                hpPct: bb['attack@max_hp'] * k,
                blockCnt: bb['attack@block_cnt'],
              });
              b.heal(u, d, d.s.maxHp * bb['attack@hp_ratio'], { self: true });
            }
          });
  return kit(raw, s, (b, u) => {
    onToken(b, u, (d) => {
      d.profile.dmgType = 'arts';
    });
    b.on(
      'death',
      ({ unit: e, reason }) => {
        if (e.side === 'enemy' && reason === 'killed' && alive(u) && [u, ...owned(b, u)].some((a) => inRange(a, e))) {
          buff(b, u, 'necras:harvest', { atkPct: t.atk }, t.atk_duration);
          raise(b, u);
          if (n === 1 && u.skill.active && u.trait.necrasTargets?.includes(e))
            for (let i = 0; i < bb.additional_token_cnt; i++) raise(b, u);
        }
      },
      { owner: u },
    );
    b.on(
      'hit',
      (c) => {
        if ((c.source === u || c.source?.ownerUnit === u) && c.target.hpRatio < z.hp_ratio)
          c.dmg.amount *= z.damage_scale;
      },
      { owner: u },
    );
    every(b, u, 0.1, () =>
      b.setExtraRange(
        u,
        owned(b, u).flatMap((d) => d.blocking.map((e) => Math.round(e.y) * 21 + Math.round(e.x))),
      ),
    );
  });
}

function ling(bb, raw, def) {
  const n = raw.skill.index,
    z = talent(raw, 1);
  const s =
    n === 1
      ? instant(({ battle: b, unit: u }) => {
          grant(b, u, bb.cnt, 4);
          for (const a of [u, ...owned(b, u)])
            for (const e of enemies(b, a, bb.value)) {
              damage(b, a, e, bb.atk_scale, 'arts');
              status(b, u, e, 'bind', bb['ling_s2_unmovable.duration']);
            }
          for (const d of owned(b, u)) if (d.hpRatio < bb.hp_ratio) b.retreat(d, { reason: 'retreat' });
        })
      : timed(bb, raw, def, {
          onStart({ battle: b, unit: u }) {
            if (n === 0) grant(b, u, bb.cnt, 4);
            u.trait.lingCd = 0;
          },
          onTick({ battle: b, unit: u, dt }) {
            for (const d of owned(b, u)) {
              buff(b, d, 'ling:command', { atkPct: bb.atk, defPct: bb.def ?? 0, aspd: bb.attack_speed ?? 0 }, 0.2);
              if (n === 0) d.profile.dmgType = 'arts';
            }
            if (n === 2) {
              u.trait.lingCd += dt;
              if (u.trait.lingCd >= bb.interval) {
                u.trait.lingCd -= bb.interval;
                for (const d of owned(b, u)) area(b, u, d, 1.1, bb.atk_scale, 'arts');
              }
            }
          },
          onEnd({ battle: b, unit: u }) {
            for (const d of owned(b, u)) {
              b.removeBuff(d, 'ling:command');
              if (n === 0) d.profile.dmgType = 'phys';
            }
            if (n === 2) grant(b, u, bb.cnt, 4);
          },
        });
  return kit(raw, s, (b, u) => {
    let stacks = 0;
    onToken(b, u, (d) => {
      if (n === 1) d.profile.dmgType = 'arts';
      if (n !== 2) return;
      const other = owned(b, u).find((a) => a !== d && !a.trait.lingGreater && inRange(d, a));
      if (other) {
        b.retreat(other, { reason: 'expired', permanent: true });
        d.trait.lingGreater = true;
        buff(b, d, 'ling:greater', { hpMul: 2, atkMul: 2, defMul: 2, blockCnt: 2 });
        d.profile.dmgType = 'arts';
        d.profile.hitAllBlocked = true;
        d.hp = d.s.maxHp;
      }
    });
    b.on(
      'death',
      ({ unit: d }) => {
        if (d.ownerUnit === u && alive(u)) {
          stacks = Math.min(z.max_stack_cnt, stacks + 1);
          buff(b, u, 'ling:farewell', { atkPct: z.atk * stacks });
          u.skill.gainSp(z.sp, 'ling');
        }
      },
      { owner: u },
    );
  });
}

function trapKit(type, bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  const place = (b, u, cnt = 1) =>
    grant(b, u, cnt, type === 'wang' ? 9 : type === 'doroth' ? 10 : 4, { placement: 'path' });
  if (type !== 'ela' || n === 0)
    Object.assign(s, {
      kind: 'charges',
      attack: undefined,
      mods: {},
      onStart({ battle: b, unit: u }) {
        place(b, u, bb.cnt ?? 1);
      },
    });
  else {
    s.onEnd = ({ battle: b, unit: u }) => place(b, u, bb.cnt ?? 1);
    if (n === 2) {
      s.kind = 'ammo';
      s.ammo = bb['attack@trigger_time'];
    }
    if (n === 1) {
      s.attack = { splashRadius: bb['attack@projectile_range'] };
      s.mods = { defPct: bb.def, defIgnoreFlat: bb.def_penetrate_fixed };
    }
  }
  return kit(raw, s, (b, u) => {
    let layers = 0;
    const mines = new Map();
    const explode = (d) => {
      if (!alive(d) || d.trait.exploding) return;
      d.trait.exploding = true;
      const radius =
        type === 'ela' ? bb.projectile_range : type === 'wang' ? (n === 2 ? 1.5 : 0.7) : n === 0 ? 0.7 : 1.5;
      let xs = b.foesInRadius(d.x, d.y, radius).filter((e) => !e.isFlying);
      if (type === 'wang') {
        const peers = owned(b, u).filter((a) => a !== d && (a.tileR === d.tileR || a.tileC === d.tileC));
        if (!peers.length) {
          d.trait.exploding = false;
          return;
        }
        if (n === 1)
          xs = b
            .aliveEnemies()
            .filter(
              (e) =>
                (Math.abs(e.x - d.x) < 0.6 && Math.abs(e.y - d.y) <= 3) ||
                (Math.abs(e.y - d.y) < 0.6 && Math.abs(e.x - d.x) <= 3),
            );
      }
      for (const e of xs) {
        if (type === 'ela') {
          status(b, u, e, n === 1 ? 'stun' : 'sluggish', n === 1 ? bb.stun : bb.sluggish);
          buff(
            b,
            e,
            `ela:mark:${u.id}`,
            n === 2 ? { dmgTakenMul: bb.damage_scale } : {},
            bb.duration ?? bb.sluggish ?? bb.stun,
          );
        } else if (type === 'wang' && n === 0) {
          status(b, u, e, 'sluggish', bb['attack@sluggish']);
          b.addBuff(e, {
            key: `wang:dot:${u.id}`,
            duration: bb['attack@sluggish'],
            interval: 1,
            onTick: () => damage(b, u, e, bb['attack@atk_scale'], 'arts'),
          });
        } else {
          damage(b, u, e, bb.atk_scale ?? bb['attack@atk_scale'], type === 'wang' || n === 2 ? 'arts' : 'phys');
          if (type === 'doroth' && n === 0) buff(b, e, 'dorothy:armor', { defPct: bb.def }, bb.duration);
          else if (type === 'doroth' && n === 1) status(b, u, e, 'bind', xs.length === 1 ? bb.duration_2 : bb.duration);
          else if (type === 'doroth') status(b, u, e, 'sluggish', bb.sluggish);
          else buff(b, e, 'wang:slow', { moveMul: 1 + bb['attack@move_speed'] }, bb['attack@duration']);
        }
      }
      if (type === 'doroth') {
        layers = Math.min(z.max_stack_cnt, layers + 1);
        buff(b, u, 'dorothy:dream', { atkPct: z.atk * layers });
        if (n === 2)
          for (const a of owned(b, u))
            if (a !== d && Math.hypot(a.x - d.x, a.y - d.y) <= 1.5) after(b, u, 0.3, () => explode(a));
      }
      b.fx('aoe', { x: d.x, y: d.y, r: radius, id: u.id });
      b.retreat(d, { reason: 'expired', permanent: true });
      mines.delete(d.id);
    };
    onToken(b, u, (d) => {
      d.profile.noAttack = true;
      buff(b, d, 'trap:inert', { blockCnt: -99 }, Infinity, { flags: { untargetable: true } });
      mines.set(d.id, d);
      d.trait.exploding = false;
    });
    if (type === 'doroth') deploy(b, u, () => place(b, u, t['attack@max_cnt'] ?? 2));
    every(b, u, 0.1, () => {
      for (const d of mines.values())
        if (alive(d) && b.enemiesInRadius(d.x, d.y, type === 'ela' ? 1.5 : 0.6).some((e) => !e.isFlying)) explode(d);
    });
    if (type === 'ela')
      b.on(
        'hit',
        (c) => {
          if (c.source === u && c.dmg.isAttack && (c.target.findBuff(`ela:mark:${u.id}`) || b.rng() < z.prob))
            c.dmg.amount *= z.atk_scale;
        },
        { owner: u },
      );
  });
}

function bgsnow(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    s =
      n === 1
        ? instant(({ battle: b, unit: u }) => {
            for (const a of [u, ...owned(b, u)])
              for (let i = 0; i < 3; i++) {
                const e = enemies(b, a, 1)[0];
                if (e) damage(b, a, e, bb.atk_scale);
              }
          })
        : seed(bb, raw, def);
  // The critical / frontal multiplier is applied once below for both owner and typewriter.
  if (n !== 1) s.attack = {};
  return kit(raw, s, (b, u) => {
    onToken(b, u, (d) => {
      after(b, d, t.duration, () => b.retreat(d, { reason: 'expired' }));
      if (n === 1) d.base.respawnTime = d.def.stats.respawnTime * bb.respawn_time;
    });
    every(b, u, 0.1, () => {
      for (const d of owned(b, u))
        buff(
          b,
          d,
          'pozy:skill',
          u.skill.active ? { atkPct: bb.atk ?? 0, batPct: (bb.base_attack_time ?? 0) / d.base.bat } : {},
          0.2,
        );
    });
    b.on(
      'hit',
      (c) => {
        const a = c.source;
        if ((a !== u && a?.ownerUnit !== u) || !c.dmg.isAttack) return;
        if (n === 0 && u.skill.active && b.rng() < bb.prob) c.dmg.amount *= bb.atk_scale;
        if (n === 2 && u.skill.active)
          c.dmg.amount *=
            Math.abs(c.target.y - a.y) < 0.6 && Math.abs(c.target.x - a.x) <= 3
              ? bb['bgsnow_s_3[atk_up].atk_scale']
              : bb.atk_scale;
        if (a !== u)
          buff(
            b,
            c.target,
            'pozy:armor',
            { defPct: Math.abs(a.x - u.x) + Math.abs(a.y - u.y) <= 1.5 ? -0.23 : -0.18 },
            4,
          );
      },
      { owner: u },
    );
  });
}

function ebnhlz(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 0) s.mods = { batPct: bb.base_attack_time - 1 };
  if (n === 1)
    Object.assign(s, {
      kind: 'charges',
      attack: undefined,
      onStart({ battle: b, unit: u }) {
        const count = 1 + (u.trait.stored ?? 0);
        u.trait.stored = 0;
        grant(b, u, count, 4, { placement: 'path', spawn: { duration: 30 } });
      },
    });
  return kit(raw, s, (b, u) => {
    onToken(b, u, (d) => {
      d.profile.noAttack = true;
      buff(b, d, 'eben:trap', {}, Infinity, { flags: { untargetable: true } });
      every(b, d, 0.1, () => {
        if (b.enemiesInRadius(d.x, d.y, 0.8).length) {
          area(b, u, d, 1.5, bb.atk_scale, 'arts', (e) => b.pull(e, bb.force, { to: d }));
          b.retreat(d, { reason: 'expired', permanent: true });
        }
      });
    });
    b.on(
      'beforeAttack',
      (c) => {
        if (c.attacker === u && n === 2 && u.skill.active)
          c.targets = c.targets.filter((e) => e.isBoss || e.def.rank === 'ELITE' || e.def.rank === 'BOSS');
      },
      { owner: u },
    );
    onHit(b, u, ({ target: e }) => {
      if (b.enemiesInRadius(e.x, e.y, z.range_radius).length === 1) damage(b, u, e, z.atk_scale, 'arts');
    });
  });
}

function ironmn(bb, raw, def) {
  const n = raw.skill.index,
    s = seed(bb, raw, def);
  s.onStart = ({ battle: b, unit: u }) => {
    if (n !== 1) grant(b, u, 1, 2);
  };
  s.onEnd = ({ battle: b, unit: u }) => {
    if (n === 0) retire(b, u);
    if (n === 1) grant(b, u, 1, 2);
  };
  return kit(raw, s, (b, u) => {
    onToken(b, u, (d) => {
      d.profile.noAttack = true;
      d.trait.deviceSp = 0;
    });
    every(b, u, 0.25, () => {
      const xs = owned(b, u);
      buff(
        b,
        u,
        'stainless:work',
        { spRecoveryFlat: xs.some((d) => Math.hypot(d.x - u.x, d.y - u.y) <= 1.5) ? 0.2 : 0 },
        0.4,
      );
      for (const d of xs) {
        const [r, c] = frontOf(d.tileR, d.tileC, d.dir);
        const a = b.unitAt(r, c);
        if (n === 0 && a?.side === 'ally')
          buff(b, a, `stainless:atk:${d.id}`, { atkPct: 0.12 * (u.skill.active ? bb.fake_scale : 1) }, 0.4);
        if (n === 1 && a?.side === 'ally') {
          d.trait.deviceSp += 0.25;
          const iv = u.skill.active ? bb.fake_interval : 3.5;
          if (d.trait.deviceSp >= iv) {
            d.trait.deviceSp -= iv;
            a.skill?.gainSp(1, 'stainless');
          }
        }
      }
    });
    // In this auto-battle adaptation adjacent allies operate the cannon once per their attack.
    b.on(
      'attack',
      (c) => {
        if (n !== 2 || c.attacker.side !== 'ally') return;
        for (const d of owned(b, u))
          if (Math.hypot(c.attacker.x - d.x, c.attacker.y - d.y) <= 1.5) {
            d.trait.shots = (d.trait.shots ?? 0) + 1;
            if (d.trait.shots % 5 === 0) {
              const e = enemies(b, d, 1)[0] ?? enemies(b, u, 1)[0];
              if (e) {
                area(b, u, e, 1.1, 3);
                b.loseHp(d, d.s.maxHp * 0.05, { source: d });
              }
            }
          }
      },
      { owner: u },
    );
  });
}

function ray(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 0)
    s.onHit = ({ battle: b, unit: u, target: e }) => {
      if (e) b.push(e, bb.force, { from: u, dir: u.dir });
    };
  if (n === 2) {
    s.onStart = ({ unit: u }) => {
      u.trait.ammo = u.profile.ammoMax ?? 8;
      u.trait.rayKill = false;
    };
    s.onEnd = ({ unit: u }) => {
      if (u.trait.rayKill) u.skill.gainSp(bb.sp, 'ray');
    };
    s.onHit = ({ battle: b, unit: u, target: e }) => e && status(b, u, e, 'bind', bb['attack@unmove_duration']);
  }
  return kit(raw, s, (b, u) => {
    let last = null,
      count = 0;
    onToken(b, u, (d) => {
      d.profile.noAttack = true;
      buff(b, d, 'ray:scout', {}, Infinity, { flags: { untargetable: true } });
      after(b, d, 25, () => b.retreat(d, { reason: 'expired' }));
    });
    every(b, u, 0.1, () =>
      b.setExtraRange(
        u,
        owned(b, u).flatMap((d) => d.rangeKeys),
      ),
    );
    b.on(
      'hit',
      (c) => {
        if (c.source !== u || !c.dmg.isAttack) return;
        count = last === c.target.id ? Math.min(z.max_stack_cnt, count + 1) : 1;
        last = c.target.id;
        buff(b, u, 'ray:focus', { atkPct: z.atk * count });
        if (owned(b, u).some((d) => inRange(d, c.target))) c.dmg.amount *= 1 + t.damage_scale;
      },
      { owner: u },
    );
    b.on(
      'kill',
      (c) => {
        if (c.killer === u && u.skill.active) u.trait.rayKill = true;
      },
      { owner: u },
    );
  });
}

function radian(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 1),
    s = seed(bb, raw, def);
  s.onStart = ({ battle: b, unit: u }) => {
    grant(b, u, bb.cnt, 3);
    if (n === 0)
      for (const a of [u, ...owned(b, u)])
        buff(b, a, 'radian:shield', {}, u.skill.duration, { shield: a.s.maxHp * bb.hp_ratio });
  };
  s.onTick = ({ battle: b, unit: u }) => {
    for (const d of owned(b, u)) buff(b, d, 'radian:skill', { atkPct: bb.atk ?? 0, defPct: bb.def ?? 0 }, 0.2);
  };
  return kit(raw, s, (b, u) => {
    onToken(b, u, (d) => {
      buff(b, d, 'radian:inspire', {
        atkFlat: d.base.atk * t.atk,
        defFlat: d.base.def * t.def,
        hpFlat: d.base.maxHp * t.max_hp,
      });
      d.profile.dmgType = n === 2 ? 'arts' : 'phys';
      if (n === 1) d.profile.hitsFn = () => (u.skill.active ? 3 : 1);
    });
    b.on(
      'damaged',
      (c) => {
        if (n === 2 && u.skill.active && (c.source === u || c.source?.ownerUnit === u) && c.dmg.isAttack) {
          status(b, u, c.target, 'sluggish', bb.sluggish);
          buff(b, c.target, 'radian:artsWeak', { artsTakenMul: bb.damage_scale }, bb['weak[magic][limit]']);
        }
      },
      { owner: u },
    );
  });
}

function monstr(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 0)
    s.attack = { healScale: bb.heal_scale, heal: { mode: 'chain', count: bb['chain.max_target'], falloff: 0.15 } };
  if (n === 2) {
    s.attack = { dmgType: 'true', heal: null, hitAllBlocked: true };
    s.mods = { atkPct: bb.atk, hpFlat: bb.max_hp, blockCnt: bb.block_cnt, batPct: bb.base_attack_time / raw.stats.bat };
    s.onStart = ({ battle: b, unit: u }) => {
      u.trait.monHome = [u.tileR, u.tileC];
      const d = owned(b, u)[0];
      if (d) {
        const tile = [d.tileR, d.tileC];
        b.retreat(d, { reason: 'retreat' });
        b.relocate(u, ...tile);
      }
    };
    s.onEnd = ({ battle: b, unit: u }) => {
      if (u.trait.monHome) b.relocate(u, ...u.trait.monHome);
    };
    s.onHit = ({ battle: b, unit: u }) => b.heal(u, u, u.s.atk * bb['attack@heal_scale'], { self: true });
  }
  return kit(raw, s, (b, u) => {
    onToken(b, u, (d) => {
      d.profile.noAttack = true;
    });
    every(b, u, 0.2, () => {
      for (const d of owned(b, u))
        for (const a of alliesNear(b, u, d)) buff(b, a, 'monstr:inspire', { atkPct: t.atk }, 0.3);
    });
    every(b, u, 1, () => {
      if (n === 2 && u.skill.active) b.loseHp(u, bb.damage_per_second, { source: u });
    });
    b.on(
      'heal',
      (c) => {
        if (c.target.ownerUnit === u && c.source !== u) {
          c.amount = 0;
          return;
        }
        if (c.source !== u && c.source?.ownerUnit !== u) return;
        const factor = n === 1 && u.skill.active ? bb.talent_scale : 1;
        for (const a of [u, c.target]) buff(b, a, 'monstr:haste', { aspd: z.attack_speed * factor }, z.buff_duration);
        if (n === 1 && u.skill.active && c.source === u && c.target.ownerUnit === u) {
          const a = b
            .alliesFor(u)
            .filter((a) => a !== c.target && a.hp < a.s.maxHp)
            .sort((a, z) => a.hpRatio - z.hpRatio)[0];
          if (a) b.heal(c.target, a, c.amount);
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

function kalts2(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def),
    seen = new Set();
  if (n === 1) {
    s.kind = 'ammo';
    s.ammo = bb['attack@trigger_time'];
    s.attack = { dmgType: 'true', heal: null, atkScale: bb['attack@atk_scale'], splashRadius: 1.5 };
    s.onHit = ({ battle: b, unit: u, target: e }) => {
      if (!e) return;
      status(b, u, e, 'sluggish', bb['attack@sluggish']);
      for (const a of alliesNear(b, u, e)) b.heal(u, a, u.s.atk * bb['attack@heal_scale']);
    };
  }
  if (n === 2) {
    s.attack = { heal: { mode: 'multi', count: 2 } };
    s.onStart = ({ battle: b, unit: u }) => grant(b, u, 1, 1);
  }
  return kit(
    raw,
    s,
    (b, u) => {
      deploy(b, u, () =>
        buff(b, u, 'kalts2:flight', { hpPct: t.max_hp, defPct: t.def, blockCnt: t.block_cnt }, Infinity, {
          flags: { float: true, blockFly: true },
        }),
      );
      onToken(b, u, (d) => {
        d.profile.noAttack = true;
        const tile = [d.tileR, d.tileC];
        b.retreat(d, { reason: 'expired', permanent: true });
        b.relocate(u, ...tile);
      });
      every(b, u, 0.2, () => {
        const xs = b.alliesFor(u).filter((a) => a !== u && inRange(u, a));
        for (const a of xs)
          if (!seen.has(a.id)) {
            seen.add(a.id);
            buff(
              b,
              a,
              'kalts2:entry',
              { hpRegen: z.hp_recovery_per_sec * (a.def.raw?.nationId === 'rhodes' ? z.rhodes_bonus : 1) },
              z.buff_duration,
              { shieldHits: 1 },
            );
          }
        for (const id of seen) if (!xs.some((a) => a.id === id)) seen.delete(id);
      });
    },
    { dmgType: 'heal', heal: { mode: 'single' }, blockFly: true },
  );
}

function nasti(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 1),
    s = seed(bb, raw, def);
  s.onStart = ({ battle: b, unit: u }) => {
    if (n !== 1) grant(b, u, 1, 2);
  };
  s.onEnd = ({ battle: b, unit: u }) => {
    if (n === 1) grant(b, u, 1, 2);
  };
  if (n === 0) s.attack = { hitAllBlocked: true };
  if (n === 1) s.attack = { noAttack: true };
  return kit(raw, s, (b, u) => {
    onToken(b, u, (d) => {
      d.profile.noAttack = true;
    });
    every(b, u, 0.5, () => {
      for (const d of owned(b, u)) {
        const [r, c] = frontOf(d.tileR, d.tileC, d.dir);
        const a = b.unitAt(r, c);
        if (a?.side !== 'ally') continue;
        if (n === 0)
          buff(
            b,
            a,
            'nasti:def',
            { defPct: u.skill.active ? bb['talent@def'] : 0.15, blockCnt: u.skill.active ? 1 : 0 },
            0.6,
          );
        if (n === 1 && u.skill.active) {
          a.skill?.gainSp(1, 'nasti');
          addShield(
            b,
            a,
            'nasti:shield',
            u.s.maxHp * bb['talent@shield_each_hp_rate'],
            u.s.maxHp * bb['talent@shield_max_hp_rate'],
          );
          b.loseHp(d, 1, { source: d });
        }
        if (n === 2) buff(b, a, 'nasti:platform', { atkPct: 0.15, defPct: 0.15 }, 0.6);
      }
      if (n === 1 && u.skill.active)
        addShield(
          b,
          u,
          'nasti:shield',
          u.s.maxHp * bb['attack@nasti_s2[update_shield].shield_each_hp_rate'],
          u.s.maxHp * bb['attack@nasti_s2[update_shield].shield_max_hp_rate'],
        );
    });
    every(b, u, 6, () => {
      const ranged = b.enemies.some((e) => e.def.applyWay === 'RANGED');
      for (const a of b.alliesFor(u))
        if (a === u || (ranged && a.def.position === 'RANGED')) {
          buff(
            b,
            a,
            'nasti:ward',
            {
              dmgTakenMul:
                1 - (ranged ? t['nasti_t2[res_plus].damage_resistance'] : t['nasti_t2[res].damage_resistance']),
            },
            6.1,
          );
          if (ranged) a.skill?.gainSp(1, 'nasti');
        }
    });
  });
}

function closur(bb, raw, def) {
  const n = raw.skill.index,
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  const allies = (b, u) => b.alliesFor(u).filter((a) => owned(b, u).some((d) => inRange(d, a)));
  s.onStart = ({ battle: b, unit: u, skill }) => {
    u.trait.closurDp = 0;
    u.trait.closurHits = 0;
    u.trait.closurGranted = 0;
    if (n === 0) for (const a of allies(b, u)) buff(b, a, 'closure:shield', {}, Infinity, { shieldHits: 1 });
    else b.addDp(u.ownerId, bb.cost ?? 0);
  };
  s.onTick = ({ battle: b, unit: u, dt, skill }) => {
    const total =
      n === 0 ? Math.min(bb.cost_add_max, bb.cost + (skill.activations - 1) * bb.cost_per_add) : bb.cost_period;
    u.trait.closurDp += dt;
    const desired = Math.min(total, Math.floor((u.trait.closurDp / skill.duration) * total));
    if (desired > u.trait.closurGranted) {
      b.addDp(u.ownerId, desired - u.trait.closurGranted);
      u.trait.closurGranted = desired;
    }
    if (n === 1)
      for (const a of allies(b, u)) buff(b, a, 'closure:guard', { defPct: bb.def, blockCnt: bb.block_cnt }, 0.2);
  };
  if (n === 2)
    s.onAttack = ({ unit: u, skill }) => {
      u.trait.closurHits++;
      skill.spec.targeting = {
        maxTargets: 1 + Math.min(bb.max_trigger_cnt, Math.floor(u.trait.closurHits / bb.attack_trigger_cnt)),
      };
    };
  if (n === 2)
    s.onHit = ({ battle: b, unit: u, target: e }) => {
      if (e)
        b.addBuff(e, {
          key: `closure:slow:${u.id}`,
          duration: bb['attack@slow_down_time'],
          refresh: 'stack',
          maxStacks: bb['attack@max_stack_cnt'],
          mods: { moveFlat: -bb['attack@slow_down'] },
        });
    };
  return kit(
    raw,
    s,
    (b, u) => {
      deploy(b, u, () => {
        if (!owned(b, u).length) grant(b, u, 1, 1);
      });
      onToken(b, u, (d) => {
        d.profile.noAttack = true;
      });
      every(b, u, 0.2, () => {
        const xs = allies(b, u);
        b.setExtraRange(
          u,
          n === 2 && u.skill.active
            ? xs.flatMap((a) => a.rangeKeys)
            : xs.flatMap((a) => a.blocking.map((e) => Math.round(e.y) * 21 + Math.round(e.x))),
        );
        for (const a of b.alliesFor(u))
          if (a.def.raw?.nationId === 'rhodes') buff(b, a, 'closure:rhodes', { atkPct: z.atk }, 0.3);
      });
    },
    { install: () => {} },
  );
}

function aphris(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 1) {
    s.attack = { noAttack: true };
    s.onStart = ({ unit: u }) => {
      u.trait.aphrisCd = 0;
    };
    s.onTick = ({ battle: b, unit: u, dt }) => {
      u.trait.aphrisCd += dt;
      if (u.trait.aphrisCd >= bb.interval) {
        u.trait.aphrisCd -= bb.interval;
        for (const e of enemies(b, u)) damage(b, u, e, bb.atk_scale, 'arts');
      }
    };
  }
  if (n === 2) {
    s.kind = 'ammo';
    s.ammo = bb['attack@trigger_time'];
    s.onStart = ({ battle: b, unit: u }) => {
      retire(b, u);
      buff(b, u, 'aphris:charge', {}, bb.charge_time, { flags: { disarm: true } });
    };
    s.onEnd = ({ battle: b, unit: u }) => retire(b, u);
    s.onHit = ({ battle: b, unit: u, target: e }) => {
      if (e) {
        const cnt = owned(b, u).length;
        if (cnt) damage(b, u, e, bb['attack@extra_atk_scale'] * cnt, 'arts');
        status(b, u, e, 'sluggish', bb['attack@origin_sluggish'] + cnt * bb['attack@extra_sluggish']);
      }
    };
  }
  return kit(raw, s, (b, u) => {
    onToken(b, u, (d) => {
      d.profile.noAttack = true;
      buff(b, d, 'aphris:relay', {}, Infinity, { flags: { untargetable: true } });
      if (n !== 0)
        after(b, d, 35, () => {
          if (!(n === 2 && u.skill.active)) b.retreat(d, { reason: 'expired' });
        });
    });
    every(b, u, 0.2, () => {
      const ds = owned(b, u);
      buff(b, u, 'aphris:relayAtk', { atkPct: ds.length ? t.atk : 0 }, 0.3);
      b.setExtraRange(
        u,
        ds.flatMap((d) => d.rangeKeys),
      );
      for (const a of b.alliesFor(u).filter((a) => inRange(u, a)))
        buff(b, a, 'aphris:penetration', { resIgnoreFlat: z.magic_resist_penetrate_fixed }, 0.3);
    });
  });
}

function mcnist(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 0) {
    s.kind = 'ammo';
    s.ammo = bb['attack@trigger_time'];
    s.attack = {
      atkScale: bb['attack@atk_scale'],
      hits: bb['attack@times'],
      splashRadius: bb['attack@projectile_range'],
    };
  }
  if (n === 1) {
    s.kind = 'ammo';
    s.ammo = bb.trigger_time;
    s.onAttack = (c) => {
      c.noAmmo = true;
    };
    s.onStart = ({ battle: b, unit: u }) => {
      for (const a of [u, ...owned(b, u)])
        buff(b, a, 'mechanist:barrier', {}, Infinity, { shield: a.s.maxHp * bb.hp_ratio });
    };
  }
  if (n === 2) s.attack = { atkScale: bb['attack@atk_scale'], dmgType: 'arts', allInRange: true };
  return kit(raw, s, (b, u) => {
    const cover = (a) => buff(b, a, 'mechanist:barrier', {}, Infinity, { shield: a.s.maxHp * t.hp_ratio });
    deploy(b, u, () => cover(u));
    onToken(b, u, (d) => {
      cover(d);
      after(b, d, 30, () => b.retreat(d, { reason: 'expired' }));
    });
    b.on(
      'damaged',
      (c) => {
        const a = c.target;
        if ((a !== u && a.ownerUnit !== u) || n !== 1 || !u.skill.active) return;
        const sh = a.findBuff('mechanist:barrier');
        if (sh?.shield > 0 || a.trait.mechanistBurst === b.time) return;
        a.trait.mechanistBurst = b.time;
        area(b, u, a, bb.range_radius, bb.atk_scale, 'arts', (e) => status(b, u, e, 'tremble', bb.not_combat));
        if (u.skill.ammoLeft > 0) {
          u.skill.ammoLeft--;
          buff(b, a, 'mechanist:barrier', {}, Infinity, { shield: a.s.maxHp * bb.hp_ratio });
          if (!u.skill.ammoLeft) u.skill.end('ammo');
        }
      },
      { owner: u },
    );
    every(b, u, 0.2, () => {
      if (n === 2 && u.skill.active)
        b.setExtraRange(
          u,
          owned(b, u).flatMap((d) => d.blocking.map((e) => Math.round(e.y) * 21 + Math.round(e.x))),
        );
    });
  });
}

export default {
  char_450_necras: necras,
  char_2023_ling: ling,
  char_2027_wang: (...x) => trapKit('wang', ...x),
  char_4048_doroth: (...x) => trapKit('doroth', ...x),
  char_4123_ela: (...x) => trapKit('ela', ...x),
  char_4055_bgsnow: bgsnow,
  char_4046_ebnhlz: ebnhlz,
  char_4072_ironmn: ironmn,
  char_4117_ray: ray,
  char_4195_radian: radian,
  char_4179_monstr: monstr,
  char_1052_kalts2: kalts2,
  char_4212_nasti: nasti,
  char_4228_closur: closur,
  char_4229_aphris: aphris,
  char_4230_mcnist: mcnist,
};
