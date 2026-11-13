"""src/app.html + data/plan-data.json -> index.html (нэг файлтай, интернетгүй ажиллана)."""
import json, pathlib
root = pathlib.Path(__file__).resolve().parent.parent
tpl = (root / 'src' / 'app.html').read_text(encoding='utf-8')
data = json.loads((root / 'data' / 'plan-data.json').read_text(encoding='utf-8'))
payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
assert '/*__PLAN_DATA__*/null' in tpl
(root / 'index.html').write_text(tpl.replace('/*__PLAN_DATA__*/null', payload), encoding='utf-8')
print('index.html', (root / 'index.html').stat().st_size, 'bytes')
