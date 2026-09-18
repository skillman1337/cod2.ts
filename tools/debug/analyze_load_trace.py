"""Summarize Chrome trace timings without treating nested slices as additive.
Usage: python tools/analyze_load_trace.py Trace.json.gz [--output report.json]
Output omits raw trace events, source maps, URLs' query strings and profile data.
"""
import argparse
import collections
import gzip
import json
from pathlib import Path
from urllib.parse import urlsplit

def summarize(trace):
    events = trace.get('traceEvents', [])
    if not isinstance(events, list):
        raise ValueError('traceEvents must be an array')
    meta = trace.get('metadata', {})
    window = meta.get('modifications', {}).get('initialBreadcrumb', {}).get('window', {})
    times = [e['ts'] for e in events if isinstance(e.get('ts'), (int, float)) and e['ts'] > 0]
    if not times:
        raise ValueError('No timed events found')
    start = window.get('min', min(times))
    end = window.get('max', max(e.get('ts', 0) + e.get('dur', 0) for e in events))
    threads = {(e.get('pid'), e.get('tid')): e.get('args', {}).get('name', '') for e in events if e.get('name') == 'thread_name'}
    totals = collections.defaultdict(lambda: [0, 0])
    for event in events:
        if event.get('ph') != 'X' or not isinstance(event.get('dur'), (int, float)):
            continue
        if event.get('name') not in ('CompressionStream Deflate', 'DecompressionStream Inflate', 'RunTask'):
            continue
        key = (event['pid'], event['tid'], event['name'])
        totals[key][0] += event['dur']; totals[key][1] += 1
    requests = []
    for e in events:
        if e.get('name') != 'ResourceSendRequest':
            continue
        url = urlsplit(e.get('args', {}).get('data', {}).get('url', ''))
        if url.path.endswith(('/index.ts', '/retail-pipeline.js', '/import.worker.js')):
            requests.append({'path': url.path, 'requestedAtSeconds': round((e['ts'] - start) / 1e6, 6)})
    return {
        'recordingWindowSeconds': round((end - start) / 1e6, 6),
        'recordingStartedUTC': meta.get('startTime'),
        'eventCount': len(events),
        'networkThrottling': meta.get('networkThrottling'),
        'networkThrottlingConditions': meta.get('networkThrottlingConditions'),
        'timingCaution': 'Recording duration is not a measured time-to-menu. Slice categories can overlap; do not sum them into a wall-clock breakdown.',
        'slices': [{'thread': threads.get((pid, tid), 'unknown'), 'pid': pid, 'tid': tid, 'name': name, 'seconds': round(us / 1e6, 6), 'count': n} for (pid, tid, name), (us, n) in totals.items()],
        'requestLandmarks': sorted(requests, key=lambda row: row['requestedAtSeconds']),
    }

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('trace', type=Path)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    try:
        opener = gzip.open if args.trace.suffix == '.gz' else open
        with opener(args.trace, 'rt', encoding='utf-8') as handle:
            result = summarize(json.load(handle))
        text = json.dumps(result, indent=2)
        if args.output:
            args.output.write_text(text + '\n', encoding='utf-8')
        else:
            print(text)
    except (OSError, ValueError, TypeError, KeyError) as error:
        parser.exit(1, f'Trace analysis failed: {error}\n')

if __name__ == '__main__':
    main()
