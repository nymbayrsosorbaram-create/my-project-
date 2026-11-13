"""src/app.html + data/*.json -> index.html (нэг файлтай, интернетгүй ажиллана)."""
import json, pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
tpl = (root / 'src' / 'app.html').read_text(encoding='utf-8')
data = json.loads((root / 'data' / 'plan-data.json').read_text(encoding='utf-8'))


def month_from_sample(s):
    """extract_month.py-ийн гаралтыг системийн сарын бүтэц рүү хөрвүүлэх."""
    date_like = re.compile(r'^\s*\d\d\.\d\d(\s*,\s*\d\d\.\d\d)*\s*$')
    return {
        'approverTitle': s['approverTitle'], 'approver': s['approver'],
        'exclude': sorted({'ХӨГЖИМ'}),
        'links': {f['code']: f['link'] for f in s['filter']},
        'notes': {f['code']: f['days'] for f in s['filter'] if f['days'] and not date_like.match(f['days'])},
        'schedule': [{'date': d['date'], 'code': d['code'], 'link': d['link']} for d in s['schedule']],
        'acts': {a['date']: {k: a[k] for k in ('method', 'link', 'competence', 'materials', 'criteria', 'steps')}
                 for a in s['acts']},
        'readings': s['readings'],
    }


for p in sorted((root / 'data').glob('month-*.json')):
    s = json.loads(p.read_text(encoding='utf-8'))
    g = next((g for g in data['groups'] if g['name'] == s['group']), None)
    if g:
        g.setdefault('monthly', {})[s['month']] = month_from_sample(s)

payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
assert '/*__PLAN_DATA__*/null' in tpl
(root / 'index.html').write_text(tpl.replace('/*__PLAN_DATA__*/null', payload), encoding='utf-8')
print('index.html', (root / 'index.html').stat().st_size, 'bytes')
