"""Сарын төлөвлөлтийн (.docx) загвараас өгөгдөл задлах.

Хэрэглээ: python3 tools/extract_month.py сарын_төлөвлөлт.docx > data/month-ahlah-11.json

Баримтын бүтэц:
  1. Сарын суралцахуйн үр дүн, уялдааны шүүлт
  2. Чиглүүлэгтэй үйл ажиллагааны хуваарь
  3. Чиглүүлэгтэй үйл ажиллагааны төлөвлөлт (өдөр бүр)
  4. Чанга уншлагын арга зүй — төлөвлөгөөний хуудас
"""
import json, re, sys, zipfile
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
CODE = r'[А-ЯӨҮЁ]+\d+\.\d+[а-яөүё]?'


def ptext(p):
    return ''.join(t.text or '' for t in p.iter(W + 't'))


def ctext(tc):
    return '\n'.join(ptext(p) for p in tc.iter(W + 'p')).strip()


def rows(tbl):
    return [[ctext(tc) for tc in tr.findall(W + 'tc')] for tr in tbl.findall(W + 'tr')]


def split_code(s):
    m = re.match(rf'^({CODE})\.?\s*(.*)$', s.strip(), re.S)
    return (m.group(1), m.group(2).strip()) if m else ('', s.strip())


def nolink(s):  # "—", "-" = уялдаагүй
    s = s.strip()
    return '' if s in ('—', '-', '–') else s


def ddmm(s):  # 2026.11.02 -> 2026-11-02
    m = re.match(r'(\d{4})\.(\d\d)\.(\d\d)', s)
    return f'{m.group(1)}-{m.group(2)}-{m.group(3)}' if m else s


ACT_KEYS = {'Суралцахуйн арга': 'method', 'Суралцахуйн үр дүн уялдаа': 'link', 'Чадамж': 'competence',
            'Хэрэглэгдэхүүн': 'materials', 'Үнэлгээний шалгуур': 'criteria'}


def parse(path):
    body = ET.fromstring(zipfile.ZipFile(path).read('word/document.xml')).find(W + 'body')
    out = {'group': '', 'month': '', 'year': '', 'approveWord': 'БАТЛАВ', 'approverTitle': '', 'approver': '', 'teacher': '', 'remark': '',
           'filter': [], 'schedule': [], 'acts': [], 'readings': []}
    mode, cur, rmode, unit = None, None, None, 'Хуудас'
    pending_appr = None  # 'БАТЛАВ' дан мөрөнд, нэр нь дараагийн мөрөнд байх хувилбар
    for el in body:
        if el.tag == W + 'p':
            t = ptext(el).strip()
            if not t:
                continue
            m = re.match(r'^(БАТЛАВ|ХЯНАСАН)\s+(\S+)\s+(\S+)', t)
            if m and not out['approver']:
                out['approveWord'], out['approverTitle'], out['approver'] = m.group(1), m.group(2), m.group(3)
            if t in ('БАТЛАВ', 'ХЯНАСАН') and not out['approver']:
                pending_appr = t
                continue
            if pending_appr:
                m = re.match(r'^(\S+)\s+(\S+)$', t)
                if m:
                    out['approveWord'], out['approverTitle'], out['approver'] = pending_appr, m.group(1), m.group(2)
                pending_appr = None
                continue
            if t.startswith('Тайлбар:') and mode not in ('reading',):
                out['remark'] = (out['remark'] + '\n' + t.split(':', 1)[1].strip()).strip()
                continue
            m = re.search(r'ЦЭЦЭРЛЭГИЙН (\S+) БҮЛГИЙН (\d{4}) ОНЫ (\d+) (?:ДУГААР|ДҮГЭЭР) САРЫН СУРАЛЦАХУЙН', t)
            if m:
                out['group'], out['year'], out['month'] = m.group(1), m.group(2), m.group(3).zfill(2)
                mode = 'filter'
            elif 'ЧИГЛҮҮЛЭГТЭЙ ҮЙЛ АЖИЛЛАГААНЫ ХУВААРЬ' in t:
                mode = 'schedule'
            elif t == 'ЧИГЛҮҮЛЭГТЭЙ ҮЙЛ АЖИЛЛАГААНЫ ТӨЛӨВЛӨЛТ':
                cur = {'date': '', 'code': '', 'method': '', 'link': '', 'competence': '', 'materials': '',
                       'criteria': '', 'steps': []}
                out['acts'].append(cur); mode = 'act-head'
            elif t == 'ЧАНГА УНШЛАГЫН АРГА ЗҮЙ':
                cur = {'days': '', 'book': '', 'author': '', 'goals': '', 'summary': '', 'words': [],
                       'r1': {}, 'r2': {}, 'r3': {}, 'text': ''}
                out['readings'].append(cur); mode = 'reading'; rmode = None; unit = 'Хуудас'
            elif t.startswith('Уншлагын өдрүүд:') and mode == 'reading':
                cur['days'] = t.split(':', 1)[1].strip()
            elif mode in ('act-head', 'act-meta') and ':' in t:
                k, v = t.split(':', 1)
                if k.strip() in ACT_KEYS:
                    cur[ACT_KEYS[k.strip()]] = v.strip()
            m = re.match(r'^БАГШ\s+(.+)$', t)
            if m:
                out['teacher'] = m.group(1).strip()
        elif el.tag == W + 'tbl':
            rs = rows(el)
            if mode == 'filter':
                for r in rs[1:]:
                    code, text = split_code(r[1])
                    out['filter'].append({'code': code, 'text': text, 'link': nolink(r[2]), 'form': r[3].strip(),
                                          'days': r[4].strip(), 'dir': r[5].strip()})
                mode = None
            elif mode == 'schedule':
                for r in rs[1:]:
                    code, _ = split_code(r[2])
                    out['schedule'].append({'date': ddmm(r[0]), 'code': code, 'link': nolink(r[3])})
                mode = None
            elif mode == 'act-head':
                r = rs[1]
                cur['code'] = split_code(r[1])[0]
                cur['date'] = ddmm(r[2])
                mode = 'act-meta'
            elif mode == 'act-meta':
                for r in rs[1:]:
                    cur['steps'].append({'time': r[0], 'name': r[1], 'teacher': r[2], 'learner': r[3] if len(r) > 3 else ''})
                mode = None
            elif mode == 'reading':
                for r in rs:
                    head = r[0]
                    if head.startswith('Номын нэр'):
                        cur['book'] = r[1].strip('«» ')
                    elif head.startswith('Зохиолч'):
                        cur['author'] = r[1]
                    elif head.startswith('Уншлагын зорилго'):
                        cur['goals'] = r[1]
                    elif head.startswith('Номын товч танилцуулга'):
                        rmode = 'summary'
                    elif head.startswith('Шинээр танилцуулах үгс'):
                        rmode = 'words'
                    elif head.startswith('Ном уншихын өмнө заах'):
                        pass
                    elif head.startswith('Эхний уншлага'):
                        rmode = 'r1'
                    elif head.startswith('Хоёр дахь уншлага'):
                        rmode = 'r2'
                    elif head.startswith('Гурав дахь уншлага'):
                        rmode = 'r3'
                    elif head.startswith('Номын бичвэр') or head.startswith('Хавсралт'):
                        rmode = 'text'
                    elif head in ('Хуудас', 'Хэсэг') and len(r) > 1 and r[1] == 'Бичвэр':
                        unit = head
                    elif rmode == 'summary' and len(r) == 1:
                        cur['summary'] = (cur['summary'] + '\n' + head).strip()
                    elif rmode == 'words' and len(r) >= 3:
                        cur['words'].append(r[:3])
                    elif rmode in ('r1', 'r2', 'r3'):
                        if len(r) >= 2:
                            cur[rmode][r[0]] = r[1]
                    elif rmode == 'text':
                        if len(r) >= 2 and re.match(r'^\d+$', r[0]):
                            cur['text'] = (cur['text'] + f'\n{unit} {r[0]}. ' + r[1]).strip()
                        else:
                            cur['text'] = (cur['text'] + '\n' + '\n'.join(r)).strip()
    return out


if __name__ == '__main__':
    print(json.dumps(parse(sys.argv[1]), ensure_ascii=False, indent=1))
