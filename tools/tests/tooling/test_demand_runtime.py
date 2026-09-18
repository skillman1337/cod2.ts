"""Exercise actual runtime workers in Chromium using original synthetic fixtures.

--base tests a project path; --dist also checks the production launcher and emitted
worker chunks. This is not a retail gameplay or performance acceptance test.
Managed Chromium is mandatory in CI. Diagnostics contain synthetic data only.
"""
import json
import os
from pathlib import Path
import queue
import re
import shutil
import subprocess
import sys
import threading
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[3]


def main() -> int:
    args = sys.argv[1:]
    base = args[args.index('--base') + 1] if '--base' in args else '/'
    label = re.sub(r'[^a-zA-Z0-9_-]', '_', base).strip('_') or 'root'
    diagnostics = ROOT / 'temp/test-results'
    diagnostics.mkdir(parents=True, exist_ok=True)
    result = {'base': base, 'fixture': 'synthetic; not a retail performance result'}
    server = subprocess.Popen(
        ['node', str(ROOT / 'tools/tests/tooling/demand_runtime_server.mjs'), *args],
        cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
    )
    page = None
    errors = []
    failures = []
    try:
        lines = queue.Queue()
        threading.Thread(target=lambda: lines.put(server.stdout.readline()), daemon=True).start()
        url = lines.get(timeout=15).strip()
        if not url.startswith('http://127.0.0.1:'):
            raise RuntimeError('Harness server did not provide its local URL')
        with sync_playwright() as p:
            options = {'headless': True, 'args': ['--no-sandbox']}
            executable = shutil.which('chromium') or shutil.which('chromium-browser')
            if executable and not os.environ.get('CI'):
                options['executable_path'] = executable
            browser = p.chromium.launch(**options)
            result['browser'] = browser.version
            try:
                if '--dist' in args:
                    # A separate empty context cannot inherit the fixture installation.
                    context = browser.new_context()
                    page = context.new_page()
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.on('response', lambda response: failures.append(response.url) if response.status >= 400 else None)
                    page.goto(url + 'launcher.html', wait_until='networkidle', timeout=30_000)
                    page.wait_for_function("['setup','error'].includes(document.querySelector('#cod2-setup')?.dataset.state)", timeout=20_000)
                    if page.locator('#cod2-setup').get_attribute('data-state') != 'setup':
                        raise RuntimeError('Built launcher did not reach first-visit setup: ' + page.locator('#setup-error').inner_text())
                    if not page.locator('#setup-choose').is_visible():
                        raise RuntimeError('Built launcher has no visible folder action')
                    if errors or failures:
                        raise RuntimeError('Built launcher has script or resource errors')
                    result['productionLauncher'] = 'first-visit setup visible; no retail game started'
                    context.close()
                context = browser.new_context()
                page = context.new_page()
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.goto(url, timeout=30_000)
                page.wait_for_function('window.__demandResult', timeout=120_000)
                result.update(page.evaluate('window.__demandResult'))
                result['pageErrors'] = errors
                if result['passed'] != result['tests'] or errors:
                    raise RuntimeError('One or more native synthetic checks failed')
                result['ok'] = True
            except Exception:
                if page and not page.is_closed():
                    try:
                        page.screenshot(path=str(diagnostics / f'demand-{label}.png'), full_page=True)
                    except Exception:
                        pass
                raise
            finally:
                browser.close()
    except Exception as error:
        result.update(ok=False, error=str(error), pageErrors=errors, failedLauncherResources=failures)
    finally:
        server.terminate()
        try:
            server.wait(timeout=10)
        except subprocess.TimeoutExpired:
            server.kill()
            server.wait(timeout=5)
        result['serverErrors'] = server.stderr.read()[-8000:]
        output = json.dumps(result, indent=2)
        (diagnostics / f'demand-{label}.json').write_text(output + '\n')
        print(output)
    return 0 if result.get('ok') else 1


if __name__ == '__main__':
    sys.exit(main())
