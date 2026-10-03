// Shared primitives for individually authored recruit kits. Values are selected-loadout blackboards.
import { bodyInKeys } from '../../body.js';
import { sortEnemyTargets, absoluteRangeKeys } from '../../targeting.js';

export const alive = (u) => !!u?.alive && u.deployed && !u.removed;
export const inRange = (u, t) => bodyInKeys(t, u.rangeKeySet);
export const talent = (raw, i) => raw.talents?.find((t) => t.index === i)?.bb ?? {};
export const talText = (raw, i) => raw.talents?.find((t) => t.index === i)?.desc ?? '';
export const owned = (b, u, id) => b.allyUnits.filter((t) => t.ownerUnit === u && (!id || t.def.id === id) && alive(t));
export const enemies = (b, u, n = Infinity, priority) => {
  const grid = u.skill?.active && u.skill.spec.targeting?.rangeGrid;
  const keys = grid ? absoluteRangeKeys(grid, u.tileR, u.tileC, u.dir, 0) : u.rangeKeys;
  const xs = b.enemiesInKeys(keys, u, { ...u.profile, ...(u.skill?.active ? u.skill.spec.targeting : {}) });
  sortEnemyTargets(b, u, xs, priority ?? u.profile.priority);
  return xs.slice(0, n);
};
export const buff = (b, u, key, mods, duration = Infinity, extra = {}) =>
  b.addBuff(u, { key, mods, duration, ...extra });
export const status = (b, u, t, key, duration, value) => b.applyStatus(t, key, { source: u, duration, value });
export const damage = (b, u, t, scale, type = 'phys', extra = {}) =>
  b.dealDamage(u, t, { amount: u.s.atk * scale, type, tags: ['recruit'], ...extra });
export function area(b, u, at, radius, scale, type = 'phys', effect) {
  for (const e of b.foesInRadius(at.x, at.y, radius)) {
    damage(b, u, e, scale, type);
    effect?.(e);
  }
  b.fx('aoe', { x: at.x, y: at.y, r: radius, id: u.id });
}
export const deploy = (b, u, fn) =>
  b.on(
    'deploy',
    ({ unit }) => {
      if (unit === u) fn();
    },
    { owner: u },
  );
export const every = (b, u, interval, fn) =>
  b.every(
    interval,
    () => {
      if (alive(u)) fn();
    },
    { owner: u },
  );
export const onHit = (b, u, fn) =>
  b.on(
    'damaged',
    (ctx) => {
      if (ctx.source === u && ctx.dmg?.isAttack && ctx.target.side === 'enemy') fn(ctx);
    },
    { owner: u },
  );
export const onAttack = (b, u, fn) =>
  b.on(
    'attack',
    (ctx) => {
      if (ctx.attacker === u) fn(ctx);
    },
    { owner: u },
  );
export const after = (b, u, delay, fn) => {
  const seq = u.deploySeq;
  return b.after(
    delay,
    () => {
      if (alive(u) && u.deploySeq === seq) fn();
    },
    { owner: u },
  );
};
export const bat = (bb, raw) => (bb.base_attack_time ?? 0) / raw.stats.bat;
export const statMods = (bb, raw) => ({
  atkPct: bb.atk ?? 0,
  defPct: bb.def ?? 0,
  aspd: bb.attack_speed ?? 0,
  batPct: bat(bb, raw),
});
export const timed = (bb, raw, def, extra = {}) => ({
  kind: raw.skill.duration < 0 ? 'toggle' : 'duration',
  mods: statMods(bb, raw),
  ...(def.skill.rangeGrid ? { targeting: { rangeGrid: def.skill.rangeGrid } } : {}),
  ...extra,
});
export const next = (bb, extra = {}) => ({ kind: 'charges', attack: { atkScale: bb.atk_scale ?? 1 }, ...extra });
export const instant = (fn, extra = {}) => ({ kind: 'charges', onStart: fn, ...extra });
// Only the selected authored spec is exposed; unrelated skills never get marked implemented.
export const kit = (raw, spec, install, trait) => ({ skills: { [raw.skill.skillId]: spec }, install, trait });
export function dot(b, u, t, key, amount, duration, type = 'arts', maxStacks = 1) {
  b.addBuff(t, {
    key: `${key}:${u.id}`,
    source: u,
    duration,
    interval: 1,
    refresh: maxStacks > 1 ? 'stack' : 'replace',
    maxStacks,
    onTick: ({ buff: a }) => b.dealDamage(u, t, { amount: amount * (a?.stacks ?? 1), type, tags: ['recruitDot'] }),
  });
}
