"""Real Chromium checks of the exact exported view/CSS, without retail assets.

Optional test dependencies: Python Playwright and Chromium. Uses the installed
Chromium executable when present, otherwise Playwright's managed Chromium.
No web server, network access, or production-only test hooks are required.
"""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

try:
    from playwright.sync_api import sync_playwright
    HAS_PLAYWRIGHT = True
except ImportError:
    HAS_PLAYWRIGHT = False
    sync_playwright = None

ROOT = Path(__file__).resolve().parents[3]


class DossierUI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not HAS_PLAYWRIGHT and os.environ.get("CI"):
            raise RuntimeError("CI must install Playwright; do not silently skip browser verification")
        if not HAS_PLAYWRIGHT:
            raise unittest.SkipTest("Playwright not installed in current Python environment")
        cls.tmp = tempfile.TemporaryDirectory()
        target = Path(cls.tmp.name) / 'preview.html'
        subprocess.run(['node', str(ROOT / 'tools/build/export_setup_preview.mjs'), str(target)], check=True, capture_output=True)
        cls.html = target.read_text()
        cls.pw = sync_playwright().start()
        executable = shutil.which('chromium') or shutil.which('chromium-browser')
        options = {'headless': True, 'args': ['--no-sandbox']}
        if executable and not os.environ.get('CI'):
            options['executable_path'] = executable
        cls.browser = cls.pw.chromium.launch(**options)

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.pw.stop()
        cls.tmp.cleanup()

    def setUp(self):
        self.errors = []
        self.page = self.browser.new_page(viewport={'width': 1448, 'height': 1086})
        self.page.on('pageerror', lambda error: self.errors.append(str(error)))
        self.page.set_content(self.html)
        self.page.wait_for_function('window.__cod2Preview')

    def tearDown(self):
        self.page.close()
        self.assertEqual(self.errors, [])

    def run_ui(self, code):
        return self.page.evaluate('() => { const ui = window.__cod2Preview.ui; ' + code + ' }')

    def scene(self, name):
        self.page.evaluate('(name) => window.__cod2Preview.scene(name)', name)

    def test_first_visit_has_one_primary_action(self):
        self.assertEqual(self.page.locator('#setup-title').inner_text(), 'Locate your\ngame folder once.')
        self.assertEqual(self.page.locator('.setup-primary:visible').count(), 1)
        self.assertTrue(self.page.locator('#setup-choose').is_visible())
        self.assertFalse(self.page.locator('#setup-loading').is_visible())
        self.assertFalse(self.page.locator('#setup-play').is_visible())
        self.assertIn('future launches', self.page.locator('#setup-help').inner_text())

    def test_loading_shows_real_stage_counts_bytes_and_path(self):
        self.run_ui("ui.show('cancel'); ui.begin('import'); ui.stage('Extracting textures', {label: 'Textures · 3 / 11', done: 2, total: 11}); ui.task({path: 'images/mp40_d.iwi', files: 245, bytes: 3*1024**2});")
        self.assertEqual(self.page.locator('#setup-count').inner_text(), '245 files cached')
        self.assertEqual(self.page.locator('#setup-bytes').inner_text(), '3.0 MB cached')
        self.assertEqual(self.page.locator('#setup-file').inner_text(), 'images/mp40_d.iwi')
        self.assertEqual(self.run_ui("return ui.el('progress').value;"), 2)
        self.assertEqual(self.run_ui("return ui.el('progress').max;"), 11)
        self.assertIn('not time remaining', self.page.locator('#setup-progress').get_attribute('aria-valuetext'))
        self.assertTrue(self.page.locator('#setup-working').is_disabled())

    def test_cached_begin_clears_previous_import_counters(self):
        self.scene('loading')
        self.run_ui("ui.begin('cache'); ui.show();")
        self.assertFalse(self.page.locator('#setup-count').is_visible())
        self.assertFalse(self.page.locator('#setup-bytes').is_visible())
        self.assertEqual(self.page.locator('#setup-status').inner_text(), 'Loading cached assets')
        self.assertEqual(self.page.locator('#setup-file').inner_text(), 'Opening browser storage')
        self.assertFalse(self.page.locator('#setup-cancel').is_visible())
        self.assertIn('No re-import', self.page.locator('#setup-help').inner_text())

    def test_unknown_work_remains_indeterminate(self):
        self.scene('loading')
        self.run_ui("ui.stage('Starting engine', {label: 'Engine'});")
        self.assertIsNone(self.page.locator('#setup-progress').get_attribute('value'))
        self.assertEqual(self.page.locator('#setup-track').get_attribute('data-determinate'), 'false')
        self.assertNotIn('Estimated remaining', self.page.locator('#cod2-setup').inner_text())
        self.run_ui("ui.task({path: 'table.json', done: 4, total: 10, unit: 'tables read'});")
        self.assertEqual(self.page.locator('#setup-count').inner_text(), '4 / 10 tables read')
        self.assertEqual(self.run_ui("return ui.el('progress').value;"), 4)

    def test_import_log_is_bounded_and_escapes_markup(self):
        self.run_ui("for (let i=0; i<170; i++) ui.log('Entry '+i); ui.log('<img src=x onerror=alert(1)>');")
        self.page.locator('#setup-log-toggle').click()
        log = self.page.locator('#setup-log').inner_text()
        self.assertEqual(len(log.splitlines()), 160)
        self.assertIn('<img src=x onerror=alert(1)>', log)
        self.assertEqual(self.page.locator('#setup-log img').count(), 0)
        self.page.locator('#setup-log').focus()
        self.page.keyboard.press('Escape')
        self.assertFalse(self.page.locator('#setup-log-region').is_visible())
        self.assertEqual(self.page.locator('#setup-log-toggle').get_attribute('aria-expanded'), 'false')
        self.assertEqual(self.page.evaluate('document.activeElement.id'), 'setup-log-toggle')

    def test_details_explain_storage_and_correct_windows_path(self):
        self.page.locator('#setup-details-toggle').click()
        text = self.page.locator('#setup-details').inner_text()
        self.assertIn(r'D:\Program Files (x86)\Activision\Call of Duty 2', text)
        self.assertIn('browser storage eviction', text)
        self.assertIn('read-only', text)
        self.scene('ready')
        self.assertTrue(self.page.locator('#setup-change').is_visible())
        self.assertTrue(self.page.locator('#setup-forget').is_visible())
        self.assertTrue(self.page.locator('#setup-rebuild').is_visible())

    def test_cancellation_restores_available_actions(self):
        self.page.locator('#setup-choose').click()
        self.assertTrue(self.page.locator('#setup-working').is_visible())
        self.page.locator('#setup-cancel').click()
        self.assertTrue(self.page.locator('#setup-choose').is_visible())
        self.assertFalse(self.page.locator('#setup-working').is_visible())
        self.assertFalse(self.page.locator('#setup-loading').is_visible())

    def test_error_stops_loading_and_preserves_recovery(self):
        self.scene('loading')
        self.run_ui("ui.fail('Test storage failure'); ui.show('choose');")
        self.assertEqual(self.page.locator('#setup-error').inner_text(), 'Test storage failure')
        self.assertEqual(self.page.locator('#setup-error').get_attribute('role'), 'alert')
        self.assertTrue(self.page.locator('#setup-choose').is_visible())
        self.assertFalse(self.page.locator('#setup-loading').is_visible())
        self.assertIn('not been modified', self.page.locator('#setup-help').inner_text())

    def test_elapsed_clock_stops_at_handoff_and_restarts_cleanly(self):
        self.run_ui("ui.begin('import');")
        self.page.wait_for_timeout(250)
        self.assertNotEqual(self.page.locator('#setup-elapsed').inner_text(), '0.0 s')
        self.run_ui("ui.finish();")
        frozen = self.page.locator('#setup-elapsed').text_content()
        self.page.wait_for_timeout(220)
        self.assertEqual(self.page.locator('#setup-elapsed').text_content(), frozen)
        self.assertFalse(self.page.locator('#cod2-setup').is_visible())
        self.run_ui("ui.begin('cache'); ui.stop();")
        self.assertTrue(self.page.locator('#cod2-setup').is_visible())
        self.assertEqual(self.page.locator('#setup-elapsed').inner_text(), '0.0 s')

    def test_task_updates_do_not_flood_live_announcements(self):
        self.scene('loading')
        self.run_ui("ui.stage('Loading textures', {label: 'Textures'}); for (let i=0;i<100;i++) ui.task({path:'images/'+i+'.iwi',files:i});")
        self.page.wait_for_timeout(220)
        self.assertEqual(self.page.locator('#setup-announcer').text_content(), 'Loading textures')
        self.assertEqual(self.page.locator('#setup-file').text_content(), 'images/99.iwi')
        self.run_ui("ui.ready();")
        text = self.page.locator('#setup-announcer').text_content()
        self.page.wait_for_timeout(220)
        self.assertEqual(self.page.locator('#setup-announcer').text_content(), text)
        self.assertNotEqual(text, 'Loading textures')

    def test_keyboard_actions_and_focus_recovery(self):
        self.page.locator('#setup-choose').focus()
        self.page.keyboard.press('Enter')
        self.assertEqual(self.page.locator('#cod2-setup').get_attribute('data-state'), 'loading')
        self.page.locator('#setup-cancel').focus()
        self.page.keyboard.press('Enter')
        self.assertEqual(self.page.evaluate('document.activeElement.id'), 'setup-choose')
        self.page.keyboard.press('Tab')
        self.assertEqual(self.page.evaluate('document.activeElement.id'), 'setup-log-toggle')
        self.page.keyboard.press('Enter')
        self.assertTrue(self.page.locator('#setup-log-region').is_visible())

    def test_reduced_motion_and_forced_colors(self):
        self.page.emulate_media(reduced_motion='reduce')
        self.scene('cache')
        self.assertEqual(self.page.locator('.setup-sweep').evaluate('(el)=>getComputedStyle(el).animationName'), 'none')
        self.assertEqual(self.page.locator('.setup-fill').evaluate('(el)=>getComputedStyle(el).transitionDuration'), '0s')
        self.page.emulate_media(forced_colors='active')
        self.assertEqual(self.page.locator('.setup-atmosphere').evaluate('(el)=>getComputedStyle(el).display'), 'none')
        self.assertTrue(self.page.locator('#setup-log-toggle').is_visible())

    def test_all_states_responsive_from_320_to_1920_pixels(self):
        for width, height in [(1920,1080),(1448,1086),(1366,768),(1024,768),(768,1024),(390,844),(320,640)]:
            self.page.set_viewport_size({'width':width,'height':height})
            for state in ['setup','loading','cache','ready','saved','error']:
                with self.subTest(width=width, state=state):
                    self.scene(state)
                    sizes = self.run_ui("return {visible: ui.panel.clientWidth, scroll: ui.panel.scrollWidth};")
                    self.assertLessEqual(sizes['scroll'], sizes['visible'])
                    self.assertFalse(self.run_ui("return [...ui.panel.querySelectorAll('h1,button,.setup-help,.setup-rail-title')].some(el=>el.clientWidth>0 && el.scrollWidth>el.clientWidth+2);"))
                    if width == 1366 and state != 'error':
                        self.assertLessEqual(self.run_ui('return ui.panel.scrollHeight;'), height)

    def test_art_is_tiny_and_preview_is_self_contained(self):
        self.assertLess(sum(p.stat().st_size for p in (ROOT/'browser/art').glob('*.webp')), 8192)
        self.assertNotIn("url('./art/", self.html)
        self.assertNotIn('<script src=', self.html)
        self.assertNotIn('<link rel="stylesheet"', self.html)
        self.assertEqual(self.page.locator('img').count(), 0, 'No UI screenshot is used as functional UI')
        self.assertFalse(list((ROOT/'browser').rglob('*.woff*')), 'No font files in the launcher')

    def test_preview_completes_import_and_cached_handoff(self):
        self.page.locator('#setup-choose').click()
        self.page.wait_for_function("document.querySelector('#cod2-setup').dataset.state === 'cached'", timeout=12000)
        self.assertTrue(self.page.locator('#setup-play').is_visible())
        self.assertIn('Menu handoff complete', self.page.locator('#setup-help').inner_text())


if __name__ == '__main__':
    unittest.main(verbosity=2)
