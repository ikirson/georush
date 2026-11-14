#!/usr/bin/env python3
"""Build GeoRush's country-partitioned populated-place data from GeoNames.
Downloads official daily GeoNames extracts and writes public/data/{ISO}.json + manifest.json.
"""
import csv, io, json, os, sys, urllib.request, zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / 'public' / 'data'
CACHE = ROOT / '.geonames-cache'
DATA.mkdir(parents=True, exist_ok=True); CACHE.mkdir(exist_ok=True)
BASE = 'https://download.geonames.org/export/dump/'
FILES = {'all': 'allCountries.zip', 'alt': 'alternateNamesV2.zip', 'country': 'countryInfo.txt'}

def fetch(key, filename):
    path = CACHE / filename
    if path.exists() and path.stat().st_size > 1000:
        print(f'Using cached {filename} ({path.stat().st_size:,} bytes)')
        return path
    url = BASE + filename
    print(f'Downloading {url}')
    req = urllib.request.Request(url, headers={'User-Agent':'GeoRush/0.1 data builder'})
    with urllib.request.urlopen(req, timeout=120) as response, open(path, 'wb') as out:
        total = 0
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk: break
            out.write(chunk); total += len(chunk)
            if total and total % (25*1024*1024) < 1024*1024: print(f'  {total//(1024*1024)} MB')
    return path

def read_countries(path):
    countries = {}
    with open(path, encoding='utf-8') as f:
        for line in f:
            if line.startswith('#') or not line.strip(): continue
            c = line.rstrip('\n').split('\t')
            if len(c) > 4 and c[0] and c[2].isdigit():
                countries[c[0]] = {'iso':c[0], 'numeric':c[2], 'name':c[4]}
    return countries

def main():
    country_path = fetch('country', FILES['country'])
    all_path = fetch('all', FILES['all'])
    alt_path = fetch('alt', FILES['alt'])
    countries = read_countries(country_path)
    places = defaultdict(list); id_lookup = {}; total = 0
    print('Reading GeoNames populated places (feature class P)…')
    with zipfile.ZipFile(all_path) as z:
        name = next(n for n in z.namelist() if n.endswith('.txt'))
        with z.open(name) as raw:
            text = io.TextIOWrapper(raw, encoding='utf-8')
            reader = csv.reader(text, delimiter='\t')
            for row in reader:
                if len(row) < 19 or row[6] != 'P': continue
                iso = row[8]
                if iso not in countries: continue
                gid = row[0]; names = {row[1], row[2]}
                # GeoNames' convenience field contains ASCII/transliterated aliases.
                if row[3]: names.update(x for x in row[3].split(',') if x)
                names = sorted(n.strip() for n in names if n and n.strip())
                record = {'id':gid, 'n':names}
                places[iso].append(record); id_lookup[gid] = record; total += 1
                if total % 250000 == 0: print(f'  {total:,} populated places')
    print(f'Loaded {total:,} populated places. Reading English alternate names…')
    alt_total = 0
    with zipfile.ZipFile(alt_path) as z:
        name = next(n for n in z.namelist() if n.endswith('.txt'))
        with z.open(name) as raw:
            text = io.TextIOWrapper(raw, encoding='utf-8')
            reader = csv.reader(text, delimiter='\t')
            for row in reader:
                if len(row) < 8 or len(row[2]) not in (2, 3): continue
                # Keep language-based variants; omit colloquial/slang and historic names.
                if row[6] == '1' or row[7] == '1': continue
                record = id_lookup.get(row[1])
                alias = row[3].strip()
                if record and alias and len(alias) <= 120:
                    record['n'].append(alias); alt_total += 1
    print(f'Added {alt_total:,} language-based alternate names.')
    manifest = {'source':'GeoNames', 'license':'CC BY 4.0', 'attribution':'Geographical data from GeoNames (https://www.geonames.org/)', 'generated_at':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(), 'total_populated_places':total, 'countries':[]}
    for iso, info in countries.items():
        records = places.get(iso, [])
        if not records: continue
        # De-duplicate names per place while preserving stable ordering.
        for rec in records: rec['n'] = sorted(set(rec['n']))
        out = DATA / f'{iso}.json'
        with open(out, 'w', encoding='utf-8') as f: json.dump(records, f, ensure_ascii=False, separators=(',',':'))
        manifest['countries'].append({**info, 'count':len(records), 'file':f'{iso}.json'})
        print(f'  {iso}: {len(records):,} places ({out.stat().st_size/1024/1024:.1f} MB)')
    manifest['countries'].sort(key=lambda c:c['name'].casefold())
    with open(DATA/'manifest.json','w',encoding='utf-8') as f: json.dump(manifest,f,ensure_ascii=False,indent=2)
    print(f"\nDone. {total:,} places across {len(manifest['countries'])} countries/territories.")
    print(f"Output: {DATA}")

if __name__ == '__main__': main()
