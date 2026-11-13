"""Цэцэрлэгийн жилийн төлөвлөгөөний .docx файлуудаас өгөгдөл задлах.

Хэрэглээ:  python3 tools/extract_docx.py файл1.docx файл2.docx ... > data/plan-data.json

Баримт бичиг бүр нэг бүлгийн (бага/дунд/ахлах/бэлтгэл) 7 чиглэлийн хүснэгттэй.
Сарын нүд: цэнхэр (B4C6E7) = уялдаа (бусад чиглэлийн үр дүнгийн код),
ногоон (C5E0B3) = давтамж, өнгөгүй = хэрэгжүүлэхгүй.
"""
import json, re, sys, zipfile
from xml.etree import ElementTree as ET

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
BLUE, GREEN = 'B4C6E7', 'C5E0B3'
MONTHS = ['09', '10', '11', '12', '01', '02', '03', '04', '05']
GROUP_ORDER = ['БАГА', 'ДУНД', 'АХЛАХ', 'БЭЛТГЭЛ']


def paras(el):
    return [''.join(t.text or '' for t in p.iter(W + 't')) for p in el.iter(W + 'p')]


def cell_info(tc):
    pr = tc.find(W + 'tcPr')
    span, vm, fill = 1, None, ''
    if pr is not None:
        g = pr.find(W + 'gridSpan')
        span = int(g.get(W + 'val')) if g is not None else 1
        v = pr.find(W + 'vMerge')
        if v is not None:
            vm = 'restart' if v.get(W + 'val') == 'restart' else 'continue'
        s = pr.find(W + 'shd')
        if s is not None:
            fill = (s.get(W + 'fill') or '').upper()
    return span, vm, fill


def parse_outcome(lines):
    lines = [l.strip() for l in lines if l.strip()]
    head = lines[0] if lines else ''
    m = re.match(r'^([А-ЯӨҮЁA-Z]+\d+\.\d+[а-яөүё]?)\.?\s*(.*)$', head)
    code, text = (m.group(1), m.group(2)) if m else ('', head)
    links = []
    for l in lines[1:]:
        lm = re.match(r'^[•\-]?\s*(\d\d)\s*сар\s*[–-]\s*([А-ЯӨҮЁA-Z]+\d+\.\d+[а-яөүё]?)\.?\s*(.*)$', l)
        if lm:
            links.append({'month': lm.group(1), 'code': lm.group(2), 'text': lm.group(3)})
    return code, text, links


def parse_doc(path):
    root = ET.fromstring(zipfile.ZipFile(path).read('word/document.xml'))
    body = root.find(W + 'body')
    group = {'name': '', 'level': '', 'teacher': '', 'school': '', 'year': '',
             'approver': '', 'date': '', 'place': '', 'directions': []}
    pending = None
    for el in body:
        if el.tag == W + 'p':
            t = ''.join(paras(el)).strip()
            m = re.search(r'^(.*?ЦЭЦЭРЛЭГИЙН)\s+(\d{4}-\d{4}) ОНЫ ХИЧЭЭЛИЙН ЖИЛИЙН (\S+) БҮЛГИЙН [“"](.+?)[”"] ЧИГЛЭЛ', t)
            if m:
                group['school'], group['year'], group['name'] = m.group(1), m.group(2), m.group(3)
                pending = {'name': m.group(4), 'rows': []}
                continue
            m = re.match(r'^(\d{4}\.\d\d\.\d\d)\s+(.+)$', t)
            if m:
                group['date'], group['place'] = m.group(1), m.group(2).strip()
            m = re.search(r'хөтөлбөр"?\s*\((\d{4})\)-ийн (.+?)-ээс авав', t)
            if m:
                group['level'] = m.group(2)
            m = re.match(r'^БАГШ\s+(.+)$', t)
            if m:
                group['teacher'] = m.group(1).strip()
            m = re.match(r'^ОРЛОН ГҮЙЦЭТГЭГЧ\s+(.+)$', t)
            if m:
                group['approver'] = m.group(1).strip()
        elif el.tag == W + 'tbl' and pending is not None:
            area = ''
            for tr in el.findall(W + 'tr')[2:]:
                tcs = tr.findall(W + 'tc')
                if len(tcs) < 14:
                    continue  # нийлбэр мөрүүд
                a = '\n'.join(paras(tcs[0])).strip()
                _, vm, _ = cell_info(tcs[0])
                if vm != 'continue' and a:
                    area = a
                sub = '\n'.join(paras(tcs[1])).strip()
                code, text, links = parse_outcome(paras(tcs[2]))
                months = []
                for i, tc in enumerate(tcs[3:12]):
                    _, _, fill = cell_info(tc)
                    v = ''.join(paras(tc)).strip()
                    if fill == BLUE or v:
                        ln = next((l for l in links if l['month'] == MONTHS[i]), None)
                        months.append({'t': 'u', 'code': v or (ln and ln['code']) or '',
                                       'text': ln['text'] if ln else ''})
                    elif fill == GREEN:
                        months.append({'t': 'd'})
                    else:
                        months.append({'t': ''})
                pending['rows'].append({'area': area, 'sub': sub or (pending['rows'][-1]['sub'] if pending['rows'] and vm else ''),
                                        'code': code, 'text': text, 'months': months})
            group['directions'].append(pending)
            pending = None
    return group


def main(paths):
    groups = [parse_doc(p) for p in paths]
    groups.sort(key=lambda g: GROUP_ORDER.index(g['name']) if g['name'] in GROUP_ORDER else 99)
    print(json.dumps({'months': MONTHS, 'groups': groups}, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:])
