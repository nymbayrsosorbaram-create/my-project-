"""Бэлтгэл бүлгийн сарын төлөвлөлтийг үүсгэх: Ахлах бүлгийн хуваарийн бүтэц (өдөр, үр дүнгийн дараалал)
-ийг IV түвшний код руу шилжүүлж, шинээр бичсэн үйл ажиллагаа, чанга уншлагыг нэгтгэнэ."""
import json, re, sys, importlib, pathlib
HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(HERE))
from readings import READINGS
REPO = HERE.resolve().parents[1]
plan = json.loads((REPO / 'data/plan-data.json').read_text())
G = {g['name']: g for g in plan['groups']}
TXT = {r['code']: r['text'] for d in G['БЭЛТГЭЛ']['directions'] for r in d['rows']}
up = lambda c: re.sub(r'^([А-ЯӨҮЁ]+)3\.', r'\g<1>4.', c) if c else c
NAMES = ['Тойргийн цаг\nҮйл ажиллагаа-1', 'Чиглүүлэгтэй үйл ажиллагаа\nҮйл ажиллагаа-2', 'Чөлөөт тоглоом\nҮйл ажиллагаа-3',
         'Номын цаг\nҮйл ажиллагаа-4', 'Төвийн үйл ажиллагаа\nҮйл ажиллагаа-5', 'Зугаалга\nҮйл ажиллагаа-6', 'Хөгжөөн баясах\nҮйл ажиллагаа-7']
TIMES = ['1000-1020', '1020-1045', '1045-1100', '1100-1130', '1130-1140', '1140-1200', '1700-1730']
ORD = ['эхний', 'хоёр дахь', 'гурав дахь']
REMARK = {'09': '9 сарын сүүлийн 14 хоног (2026.09.17–09.30)-ийн төлөвлөлт. Эхний 2 долоо хоног дасан зохицох үе.',
          '10': '', '11': '11.26 – Монгол Улс тунхагласан өдөр (амралтын өдөр).'}
# Хуваарийн үндсэн/уялдаа үр дүнгээр гарахгүй ч үйл ажиллагаанд хэрэгжих өдрүүд
EXTRA = {
 '09': {'НСХ4.3в': '09.25', 'ХЭМ4.1а': 'Өдөр бүр', 'ХЭМ4.2г': 'Өдөр бүр', 'ХЯ4.3а': '09.21, 09.29',
        'МАТ4.1а': '09.21', 'ЗУ4.1а': '09.30'},
 '10': {'ХЭМ4.1а': 'Өдөр бүр', 'ХЭМ4.1г': '10.01, 10.30', 'ХЭМ4.2г': 'Өдөр бүр', 'ЗУ4.1а': '10.29'},
 '11': {'ХЯ4.1а': '11.19'},
}
LEARN = [
 '- Номын нэр, хавтасны зургийг харж, ном юуны тухай байхыг таамаглаж хэлнэ.\n- Багшийн уншихыг анхааралтай, тайван сонсоно.\n- Түр зогсох үед «Дараа нь юу болох бол?» гэсэн асуултад таамаглалаа хэлнэ.\n- Шинэ үгийн утгыг сонсож, багштай хамт давтан хэлнэ.\n- Уншсаны дараах асуултад өөрийн үгээр хариулна.',
 '- Номын эхлэл, өрнөл, төгсгөлийг санаж ярина.\n- Асуултад учир шалтгааныг холбон хариулна.\n- Шинэ үгийг үйлдлээр үзүүлж, өгүүлбэрт хэрэглэнэ.\n- Дүрд тоглож, үйл явдлыг дахин бүтээнэ.',
 '- Номын нэр, зохиолч, зураачийг нэрлэнэ.\n- Зургийг харж, үйл явдлыг өөрөө дарааллаар нь ярина.\n- Шинэ сурсан үгсээр өгүүлбэр зохионо.\n- Номтой холбоотой бүтээл хийж, танилцуулна.']


def reading_days(m):
    out = {}
    for r in READINGS[m]:
        for mm, dd, n in re.findall(r'(\d\d)\.(\d\d) \((\d)-р уншлага\)', r['days']):
            y = 2026 if mm >= '09' else 2027
            out[f'{y}-{mm}-{dd}'] = (r, int(n))
    return out


def book_step(m, date, prev_book):
    rd = reading_days(m)
    if date in rd:
        r, n = rd[date]
        v = list(r[f'r{n}'].values())
        one = lambda s: '; '.join(x.strip() for x in s.split('\n') if x.strip())
        head = f'Чанга уншлага – {ORD[n-1]} уншлага ({n}): «{r["book"]}» (Чанга уншлагын төлөвлөгөөний хуудсыг үзнэ үү.)\n'
        if n == 1:
            body = ('- Номын нэр, хавтас, зохиолч, зураачийг танилцуулж, хэмнэлийг алдагдуулахгүй уншина.\n'
                    f'- Түр зогсож асуух: {one(v[0])}\n- Шинэ үг: {one(v[1])}\n- Уншсаны дараа: {one(v[2])}')
        elif n == 2:
            body = (f'- Эргэн санах: {one(v[0])}\n- Түр зогсож асуух: {one(v[1])}\n- Шинэ үг: {one(v[2])}\n- Уншсаны дараа: {one(v[3])}')
        else:
            body = ('- Номын үйл явдлыг багшийн чиглүүлэг дор хүүхдүүдээр түлхүү яриулна.\n'
                    f'- Уншиж байхдаа: {one(v[1])}\n- Уншсаны дараа: {one(v[2])}')
        return head + body, LEARN[n - 1], r
    if prev_book:
        return (f'Номын цаг: «{prev_book["book"]}» номын зургийг дарааллаар нь үзүүлж, үйл явдлыг хүүхдүүдээр дахин яриулна.\n'
                '- Дуртай хэсгээ сонгож, дүрд тоглуулна.\n- «Хэрвээ чи ... байсан бол яах байсан бэ?» гэж асууна.',
                '- Зургийг харж үйл явдлыг дарааллаар нь ярина.\n- Дуртай дүрдээ орж тоглоно.\n- Өөрийн бодлоо шалтгаантай нь хэлнэ.', prev_book)
    return ('Номын цаг: Номын булангаас хүүхэд бүр дуртай номоо сонгож, зургаар нь найздаа ярьж өгнө. Багш 2–3 хүүхдийн сонгосон номыг чанга уншина.',
            '- Дуртай номоо сонгож, яагаад сонгосноо хэлнэ.\n- Номын зургаар найздаа ярина.\n- Багшийн уншихыг анхааралтай сонсоно.', None)


def build(m, prev_book=None):
    A = importlib.import_module(f'm{m}').A
    ah = json.loads((REPO / f'data/month-ahlah-{m}.json').read_text())
    mi = plan['months'].index(m)
    ANN = {r['code']: r['months'][mi] for d in G['БЭЛТГЭЛ']['directions'] for r in d['rows']}
    # Уялдаа мөрийн линкийг Бэлтгэл бүлгийн жилийн төлөвлөгөөнөөс авна (Ахлахынхаас ялгаатай байж болно)
    fil = [{'code': up(f['code']), 'text': TXT[up(f['code'])],
            'link': ANN[up(f['code'])]['code'] if f['form'] == 'Уялдаа' else up(f['link']),
            'form': f['form'], 'days': f['days'], 'dir': f['dir']} for f in ah['filter']]
    FL = {f['code']: f for f in fil}
    sched = [{'date': s['date'], 'code': up(s['code']),
              'link': FL[up(s['code'])]['link'] if FL[up(s['code'])]['form'] == 'Уялдаа' else up(s['link'])} for s in ah['schedule']]
    # Хуваарь өөрчлөгдсөн тул хэрэгжүүлэх өдрийг (огноон хэсгийг) дахин тооцно, тэмдэглэлийг хадгална
    for f in fil:
        dates = sorted({x['date'][5:].replace('-', '.') for x in sched if x['code'] == f['code'] or x['link'] == f['code']})
        notes = [t.strip() for t in f['days'].split(',') if t.strip() and not re.match(r'^\d\d\.\d\d$', t.strip())]
        for t in EXTRA.get(m, {}).get(f['code'], '').split(','):
            t = t.strip()
            if re.match(r'^\d\d\.\d\d$', t):
                dates = sorted(set(dates) | {t})
            elif t and t not in notes:
                notes.append(t)
        f['days'] = ', '.join(dates + notes)
    acts = []
    for s in sched:
        a = A[s['date']]
        steps = []
        for i, st in enumerate(a['steps']):
            if st is None:
                t, l, prev_book = book_step(m, s['date'], prev_book)
            else:
                t, l = st
            steps.append({'time': TIMES[i], 'name': NAMES[i], 'teacher': t, 'learner': l})
        acts.append({'date': s['date'], 'code': s['code'], 'method': a['method'],
                     'link': f"{s['link']}. {TXT[s['link']]}" if s['link'] else '',
                     'competence': a['competence'], 'materials': a['materials'], 'criteria': a['criteria'], 'steps': steps})
    extra = set(A) - {s['date'] for s in sched}
    assert not extra, f'{m}: хуваарьт байхгүй өдөр {extra}'
    out = {'group': 'БЭЛТГЭЛ', 'month': m, 'year': '2026' if m >= '09' else '2027', 'approveWord': 'БАТЛАВ',
           'approverTitle': 'АРГАЗҮЙЧ', 'approver': 'Ц.ОДОНЧИМЭГ', 'teacher': 'Б.ЗОЛЦЭЦЭГ', 'remark': REMARK.get(m, ''),
           'filter': fil, 'schedule': sched, 'acts': acts, 'readings': READINGS[m]}
    (REPO / f'data/month-beltgel-{m}.json').write_text(json.dumps(out, ensure_ascii=False, indent=1))
    print(m, 'filter', len(fil), 'days', len(sched), 'acts', len(acts), 'readings', len(READINGS[m]))
    return READINGS[m][-1] if READINGS[m] else prev_book


if __name__ == '__main__':
    prev = None
    for m in sys.argv[1:]:
        prev = build(m, prev)
