"""Exercise the real asset runtime in Chromium using original synthetic fixtures.

Install the optional test dependency: python -m pip install playwright
Uses system Chromium when available, or Playwright's managed Chromium.
Does not launch the proprietary engine, download media, or benchmark retail data.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]


def main() -> int:
    server = subprocess.Popen(
        ['node', str(ROOT / 'tools/tests/tooling/demand_runtime_server.mjs')],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    try:
        url = server.stdout.readline().strip()
        if not url.startswith('http://127.0.0.1:'):
            raise RuntimeError('Harness server failed: ' + server.stderr.read())
        with sync_playwright() as p:
            options = {'headless': True, 'args': ['--no-sandbox']}
            executable = shutil.which('chromium') or shutil.which('chromium-browser')
            if executable:
                options['executable_path'] = executable
            browser = p.chromium.launch(**options)
            page = browser.new_page()
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.goto(url)
            try:
                page.wait_for_function('window.__demandResult', timeout=120_000)
            except Exception:
                print(json.dumps({'pageErrors': errors}, indent=2))
                raise
            result = page.evaluate('window.__demandResult')
            result['browser'] = browser.version
            result['fixture'] = 'synthetic; not a retail performance result'
            print(json.dumps(result, indent=2))
            browser.close()
            return 0 if result['passed'] == result['tests'] and not errors else 1
    finally:
        server.terminate()
        server.wait(timeout=10)


if __name__ == '__main__':
    sys.exit(main())
