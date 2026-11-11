import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("patch", Path(__file__).parents[1] / "scripts/icloud-auth-classification.py")
patch = importlib.util.module_from_spec(spec)
spec.loader.exec_module(patch)

class ClassificationTests(unittest.TestCase):
    def test_behavior_and_no_sensitive_echo(self):
        code, types = patch.transform(patch.OLD, 'export type ErrorCode = "AUTH_FAILED";')
        self.assertIn('"PERMISSION_DENIED"', types)
        js = """class CalendarError extends Error {
          constructor(code,message,retryable=false) {super(message);this.code=code;this.retryable=retryable;}
        }
        function validate(response) { CODE }
        for (const [status,expected] of [[401,'AUTH_FAILED'],[403,'PERMISSION_DENIED']]) {
          try {validate({status,body:'password=CANARY',url:'https://user:CANARY@example.test'});throw Error('missing');}
          catch(e) {if(e.code!==expected || e.retryable || e.message.includes('CANARY')) process.exit(1);}
        }
        validate({status:207}); console.log('CLASSIFICATION_OK');
        """.replace("CODE", code)
        result = subprocess.run(["node", "--input-type=module", "-e", js], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("CLASSIFICATION_OK", result.stdout)

    def test_dry_run_apply_and_repeat_refusal(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            client = root / "dist/caldav/client.js"
            types = root / "dist/domain/errors.d.ts"
            client.parent.mkdir(parents=True)
            types.parent.mkdir(parents=True)
            client.write_text(patch.OLD)
            types.write_text('"AUTH_FAILED"')
            self.assertEqual(patch.main([tmp]), 0)
            self.assertEqual(client.read_text(), patch.OLD)
            self.assertEqual(patch.main([tmp, "--apply-staged"]), 0)
            self.assertIn("PERMISSION_DENIED", client.read_text())
            self.assertEqual(patch.main([tmp, "--apply-staged"]), 1)

    def test_fail_closed(self):
        for client, types in [("changed source CANARY", '"AUTH_FAILED"'), (patch.OLD * 2, '"AUTH_FAILED"')]:
            with self.assertRaises(ValueError):
                patch.transform(client, types)
        self.assertEqual(patch.main(["/root/.local/share/metis-integrations/icloud-calendar"]), 1)

    def test_symlink_escape(self):
        with tempfile.TemporaryDirectory() as tmp, tempfile.TemporaryDirectory() as outside:
            root = Path(tmp)
            (root / "dist").symlink_to(outside, target_is_directory=True)
            self.assertEqual(patch.main([tmp, "--apply-staged"]), 1)

if __name__ == "__main__":
    unittest.main()
