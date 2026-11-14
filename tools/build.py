"""src/app.html + data/*.json -> index.html (нэг файлтай, интернетгүй ажиллана)."""
import json, pathlib, re
root = pathlib.Path(__file__).resolve().parent.parent
tpl = (root / 'src' / 'app.html').read_text(encoding='utf-8')
data = json.loads((root / 'data' / 'plan-data.json').read_text(encoding='utf-8'))


def extra_days(f, schedule):
    """Хуваариас автоматаар гарахгүй, гараар бичсэн өдөр/тэмдэглэл (ж: 'Өдөр бүр', '01.04')."""
    auto = {d['date'][5:].replace('-', '.') for d in schedule if d['code'] == f['code'] or d['link'] == f['code']}
    return ', '.join(t for t in (x.strip() for x in f['days'].split(',')) if t and t not in auto)


def month_from_sample(s, g):
    """extract_month.py-ийн гаралтыг системийн сарын бүтэц рүү хөрвүүлэх."""
    return {
        'approveWord': s.get('approveWord', 'БАТЛАВ'), 'approverTitle': s['approverTitle'], 'approver': s['approver'],
        # Загварт ороогүй чиглэлийг (ж: Ахлах бүлэгт Хөгжим) шүүлтээс хасна
        'exclude': [d['name'] for d in g['directions'] if not any(f['dir'].upper() == d['name'] for f in s['filter'])],
        'remark': s.get('remark', ''),
        'links': {f['code']: f['link'] for f in s['filter']},
        'notes': {code: note for code, note in ((f['code'], extra_days(f, s['schedule'])) for f in s['filter']) if note},
        'schedule': [{'date': d['date'], 'code': d['code'], 'link': d['link']} for d in s['schedule']],
        'acts': {a['date']: {k: a[k] for k in ('method', 'link', 'competence', 'materials', 'criteria', 'steps')}
                 for a in s['acts']},
        'readings': s['readings'],
    }


for p in sorted((root / 'data').glob('month-*.json')):
    s = json.loads(p.read_text(encoding='utf-8'))
    g = next((g for g in data['groups'] if g['name'] == s['group']), None)
    if g:
        g.setdefault('monthly', {})[s['month']] = month_from_sample(s, g)

# Файл ирээгүй сарууд: жилийн төлөвлөгөөнөөс шүүлт, хуваарийг автоматаар үүсгэсэн ноорог.
# Жинхэнэ файл (data/month-*.json) нэмэгдвэл ноорог автоматаар солигдоно.
import datetime
HOLIDAYS = {'03-08'}  # Олон улсын эмэгтэйчүүдийн өдөр
DRAFTS = [('АХЛАХ', '05'), ('ДУНД', '02'), ('ДУНД', '03'), ('ДУНД', '04'), ('ДУНД', '05')]


def draft_month(g, m):
    mi = data['months'].index(m)
    others = [o for o in g.get('monthly', {}).values() if not o.get('draft')]
    exclude = others[0]['exclude'] if others else []
    rows = {'u': [], 'd': []}
    for d in g['directions']:
        if d['name'] in exclude:
            continue
        for r in d['rows']:
            c = r['months'][mi]
            if c['t']:
                rows[c['t']].append((r['code'], c.get('code', '') if c['t'] == 'u' else ''))
    queue = rows['u'] + rows['d']
    y = int(g['year'][:4]) + (0 if m >= '09' else 1)
    # Өөр бүлэгт тухайн сарын жинхэнэ хуваарь байвал түүний өдрүүдийг (амралтыг хассан) ашиглана
    ref = next((o for x in data['groups'] for k, o in x.get('monthly', {}).items() if k == m and not o.get('draft')), None)
    if ref:
        dates = [d['date'] for d in ref['schedule']]
    else:
        dates, day = [], datetime.date(y, int(m), 1)
        while day.month == int(m):
            if day.weekday() < 5 and day.strftime('%m-%d') not in HOLIDAYS:
                dates.append(day.isoformat())
            day += datetime.timedelta(days=1)
    sched = []
    for dt in dates:
        code, link = queue.pop(0) if queue else ('', '')
        sched.append({'date': dt, 'code': code, 'link': link})
    approver = next((o for o in others), {})
    return {'draft': True, 'approveWord': 'БАТЛАВ', 'approverTitle': approver.get('approverTitle', 'АРГАЗҮЙЧ'),
            'approver': approver.get('approver', ''), 'exclude': exclude, 'links': {}, 'notes': {}, 'remark': '',
            'schedule': sched, 'acts': {}, 'readings': []}


for gname, m in DRAFTS:
    g = next(g for g in data['groups'] if g['name'] == gname)
    if m not in g.get('monthly', {}):
        g.setdefault('monthly', {})[m] = draft_month(g, m)

payload = json.dumps(data, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
assert '/*__PLAN_DATA__*/null' in tpl
(root / 'index.html').write_text(tpl.replace('/*__PLAN_DATA__*/null', payload), encoding='utf-8')
print('index.html', (root / 'index.html').stat().st_size, 'bytes')
