"""Extract recruit battle models by Unity references, preserving front/back and split alpha.

Uses the same UnityPy + aklz4 decoder as extract.py. Run through extract-operators.mjs.
"""
import argparse
import json
import re
from functools import lru_cache
from pathlib import Path
import aklz4  # registers the local client's LZ4 decoder
import UnityPy
from extract import ROOT, resolve_game_root


@lru_cache(maxsize=2)
def load_bundle(source):
    return UnityPy.load(str(source))


def blob(obj):
    value = obj.read().m_Script
    return value.encode('utf-8', 'surrogateescape') if isinstance(value, str) else bytes(value)


def extract_model(root, ident, out, source_override=None):
    source = root / 'chararts' / (ident + '.ab')
    if ident.startswith('token_'):
        source = root / 'pkgrps/btl_pfb_tokens_0.ab'
    if source_override:
        source = source_override
    if not source.exists():
        raise ValueError(f'missing {source}')
    env = load_bundle(source)
    objects = {o.path_id: o for o in env.objects}

    def ref(pointer):
        if pointer.get('m_FileID', 0):
            raise ValueError('external model dependency')
        return objects[pointer['m_PathID']]

    trees = [o.read_typetree() for o in env.objects if o.type.name == 'MonoBehaviour']
    token_skeleton = next((t for t in trees if t.get('m_Name') == ident + '_SkeletonData' and 'skeletonJSON' in t), None) if ident.startswith('token_') else None
    if ident.startswith('token_') and token_skeleton is None and source_override is None:
        for candidate in sorted((root / 'pkgrps').glob('btl_pfb_tokens_*.ab')):
            if candidate == source:
                continue
            try:
                return extract_model(root, ident, out, candidate)
            except ValueError:
                pass
        skin = root / 'skinpack' / (ident + '.ab')
        if skin.exists():
            return extract_model(root, ident, out, skin)
    tree = next((t for t in trees if '_front' in t), None)
    if tree is None:
        single = next((t for t in trees if '_skeleton' in t and '_animations' in t), None)
        if single:
            tree = {'_front': {'skeleton': single['_skeleton']}}
    if tree is None and token_skeleton is None:
        raise ValueError('no battle front/back component')
    result = {}
    for facing in ('front', 'back'):
        if ident.startswith('token_'):
            if facing == 'back' or token_skeleton is None:
                continue
            skeleton = token_skeleton
        else:
            pointer = tree.get('_' + facing, {}).get('skeleton', {})
            if not pointer.get('m_PathID'):
                continue
            renderer = ref(pointer).read_typetree()
            skeleton = ref(renderer['skeletonDataAsset']).read_typetree()
        atlas = ref(skeleton['atlasAssets'][0]).read_typetree()
        target = out / ident / facing
        target.mkdir(parents=True, exist_ok=True)
        (target / 'model.skel').write_bytes(blob(ref(skeleton['skeletonJSON'])))
        text = blob(ref(atlas['atlasFile'])).decode('utf-8-sig')
        # Atlas pages are separated by blank lines. Each page's material supplies its exact texture.
        pages = [part.splitlines()[0].strip() for part in text.strip().split('\n\n') if part.strip()]
        if len(pages) != len(atlas['materials']):
            raise ValueError(f'atlas pages/materials mismatch: {pages}')
        for page, material in zip(pages, atlas['materials']):
            if Path(page).name != page:
                raise ValueError('invalid atlas page path')
            props = ref(material).read_typetree()['m_SavedProperties']
            textures = dict(props['m_TexEnvs'])
            img = ref(textures['_MainTex']['m_Texture']).read().image.convert('RGBA')
            alpha = textures.get('_AlphaTex', {}).get('m_Texture', {})
            if dict(props.get('m_Floats', [])).get('_UseAlphaTex') and alpha.get('m_PathID'):
                mask = ref(alpha).read().image.getchannel('R')
                if mask.size != img.size:
                    raise ValueError('alpha texture size mismatch')
                img.putalpha(mask)
            img.save(target / page)
        (target / 'model.atlas').write_text(text, encoding='utf-8')
        result[facing] = target.relative_to(ROOT / 'public').as_posix()
    if not result:
        raise ValueError('no Spine skeleton (may be a 3D object)')
    return result


def extract_icons(root, chess, out, report):
    """Export the official skill and uniequip Sprite images used by selectable operators."""
    wanted_skills = {s.get('iconId') or s.get('skillId') for c in chess.values() for s in c.get('skills', [])}
    wanted_modules = {m.get('icon') or m.get('uniEquipId') for c in chess.values() for m in c.get('modules', [])}
    wanted_skills.discard(None)
    wanted_modules.discard(None)
    report.setdefault('skills', {})
    report.setdefault('modules', {})
    jobs = [
        ('skill_icons_*.ab', 'skills', wanted_skills, 'skill_icon_'),
        ('ui_equip_small_img_hub_*.ab', 'modules', wanted_modules, ''),
    ]
    for pattern, group, wanted, prefix in jobs:
        for source in sorted((root / 'spritepack').glob(pattern)):
            env = UnityPy.load(str(source))
            for obj in env.objects:
                if obj.type.name != 'Sprite':
                    continue
                sprite = obj.read()
                name = sprite.m_Name
                ident = name.removeprefix(prefix) if prefix else name
                if ident not in wanted or not re.fullmatch(r'[A-Za-z0-9_\-\[\]]+', ident):
                    continue
                safe_id = re.sub(r'[^A-Za-z0-9_-]', '_', ident)
                target = out.parent / group / f'{safe_id}.png'
                target.parent.mkdir(parents=True, exist_ok=True)
                sprite.image.save(target)
                report[group][ident] = '/' + target.relative_to(ROOT / 'public').as_posix()
        missing = wanted - report[group].keys()
        print(f'{group}: {len(report[group])}/{len(wanted)} icons, {len(missing)} missing in client', flush=True)
        report.setdefault('iconMissing', {})[group] = sorted(missing)


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--game')
    ap.add_argument('--only', help='extract a single character for diagnostics')
    ap.add_argument('--retry', action='store_true', help='retry only failed models from the previous extraction')
    ap.add_argument('--icons-only', action='store_true', help='extract skill and module icons without re-extracting battle models')
    args = ap.parse_args()
    root = resolve_game_root(args.game)
    if not root or not root.is_dir():
        ap.error(f'No Arknights install found{" at " + str(root) if root else ""}: pass --game <dir> or set "gameDir" in local.config.json')
    chess = json.loads((ROOT / 'data/chess.json').read_text(encoding='utf-8'))
    records = [c for c in chess.values() if c.get('recruit') and not c['isGolden']]
    ids = sorted({c['charId'] for c in records})
    if args.only:
        ids = [args.only]
    out = ROOT / 'public/assets/local/operators'
    cache = ROOT / '.cache/local-operators.json'
    report = json.loads(cache.read_text(encoding='utf-8')) if args.icons_only and cache.exists() else {'source': 'local-client', 'chars': {}, 'tokens': {}, 'failures': {}}
    token_ids = sorted({token for c in records for token in c['tokens']}) if not args.only else []
    pending = ids + token_ids
    if args.icons_only:
        pending = []
    elif args.retry:
        report = json.loads((ROOT / '.cache/local-operators.json').read_text(encoding='utf-8'))
        pending = list(report['failures'])
    for ident in pending:
        try:
            models = extract_model(root, ident, out)
            report['tokens' if ident.startswith('token_') else 'chars'][ident] = {'spine': models}
            report['failures'].pop(ident, None)
            print(f'{ident}: {", ".join(models)}', flush=True)
        except Exception as exc:
            report['failures'][ident] = str(exc)
            print(f'{ident}: FAIL {exc}', flush=True)
    # Official small portraits and avatars, without exporting full-size illustrations.
    wanted = set() if args.retry or args.icons_only else set(ids)
    for pattern, field in [('ui_char_avatar_*.ab', 'avatar'), ('char_portrait_*.ab', 'portrait')]:
        for src in sorted((root / 'spritepack').glob(pattern)):
            if not wanted:
                break
            env = UnityPy.load(str(src))
            for obj in env.objects:
                if obj.type.name != 'Sprite':
                    continue
                sprite = obj.read()
                name = sprite.m_Name
                ident = name if name in wanted else name.rsplit('_', 1)[0]
                if ident not in wanted or name not in (ident, ident + '_1', ident + '_2'):
                    continue
                target = out / ident / f'{field}_{name}.png'
                target.parent.mkdir(parents=True, exist_ok=True)
                sprite.image.save(target)
                key = field + ('E2' if name.endswith('_2') else '')
                report['chars'].setdefault(ident, {})[key] = '/' + target.relative_to(ROOT / 'public').as_posix()
    if not args.retry:
        extract_icons(root, chess, out, report)
    path = cache
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False), encoding='utf-8')
    print(f'Extracted {len(report["chars"])} operators; {len(report["failures"])} failures. {path}')


if __name__ == '__main__':
    main()
