"""Independent behavior checks for the closeout evidence CLI.

Fixtures are deliberately created outside the checkout and retained after the run so
the generated evidence can be inspected when a case fails.
"""

import contextlib
import hashlib
import io
import json
import subprocess
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from . import cli


def retained_dir():
    return Path(tempfile.mkdtemp(prefix='closeout-behavior-'))


def clean_git_readonly(argv, timeout=20):
    if argv and argv[0] == 'git' and argv[-3:] == ['status', '--porcelain', '-z']:
        return '', None
    if argv and argv[0] == 'git' and argv[-2:] == ['rev-parse', 'HEAD']:
        return 'test-head\n', None
    if argv and argv[0] == 'git' and argv[-2:] == ['branch', '--show-current']:
        return 'test-branch\n', None
    return None, 'unavailable'


def invoke(args):
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        code = cli.main(args)
    try:
        record = json.loads(output.getvalue())
    except json.JSONDecodeError:
        record = None
    return code, output.getvalue(), record


class CloseoutBehaviorTests(unittest.TestCase):
    def test_release_requires_exact_completed_sha_live_mount_and_direct_health(self):
        deployment_rows = [
            {'id': 'old', 'status': 'finished', 'commit': 'aaaaaaa',
             'created_at': '2026-10-01T00:00:00Z', 'finished_at': '2026-10-01T00:01:00Z'},
            {'id': 'done', 'status': 'finished', 'commit': 'bbbbbbb',
             'created_at': '2026-10-02T00:00:00Z', 'finished_at': '2026-10-02T00:01:00Z'},
            {'id': 'newer-running', 'status': 'running', 'commit': 'ccccccc',
             'created_at': '2026-10-03T00:00:00Z'},
        ]
        inspect = [{
            'Name': '/pb-container',
            'Config': {'Labels': {'coolify.applicationId': 'app-1',
                                  'com.docker.compose.service': 'pocketbase'}},
            'State': {'Running': True, 'Health': {'Status': 'healthy'}},
            'Mounts': [{'Type': 'volume', 'Name': 'pb-volume',
                        'Destination': '/pb/pb_data', 'RW': True}],
        }]
        calls = []

        def fake_readonly(argv, timeout=20):
            calls.append(argv)
            if argv[:3] == ['coolify', 'app', 'get']:
                return json.dumps({'uuid': 'app-1', 'status': 'running:healthy',
                                   'git_commit_sha': 'wrong-configured-sha'}), None
            if argv[:4] == ['coolify', 'app', 'deployments', 'list']:
                return json.dumps(deployment_rows), None
            if argv[:3] == ['docker', '--context', 'staging']:
                return json.dumps(inspect), None
            return None, 'command_failed: sensitive fake output'

        class Response:
            status = 204
            def __enter__(self): return self
            def __exit__(self, *unused): return False

        class Opener:
            def __init__(self): self.requested = []
            def open(self, request, timeout):
                self.requested.append((request, timeout))
                return Response()

        opener = Opener()
        with patch.object(cli, 'run_readonly', side_effect=fake_readonly), \
             patch.object(cli.urllib.request, 'build_opener', return_value=opener):
            code, rendered, record = invoke([
                'release', '--app', 'app-1', '--product-sha', 'bbbbbbb',
                '--expected-volume', 'pb-volume', '--mount-destination', '/pb/pb_data',
                '--endpoint', 'https://karaoke.example/healthz', '--docker-context', 'staging',
                '--container', 'pb-container', '--service', 'pocketbase'])

        self.assertEqual(code, 2, 'a newer in-progress deployment must keep release status unavailable')
        self.assertEqual(record['status'], 'unavailable')
        self.assertEqual(record['observedProductSha'], 'bbbbbbb')
        self.assertEqual(record['latestFinishedDeployment']['finished_at'], '2026-10-02T00:01:00Z')
        self.assertEqual(record['latestDeploymentPhase']['id'], 'newer-running')
        self.assertEqual(record['latestDeploymentPhase']['created_at'], '2026-10-03T00:00:00Z')
        self.assertEqual(record['latestFinishedDeployment']['id'], 'done')
        self.assertEqual(record['retainedVolume']['mount']['status'], 'verified')
        self.assertEqual(record['endpoint']['httpStatus'], 204)
        self.assertEqual(opener.requested[0][0].get_method(), 'GET')
        self.assertNotIn('sensitive fake output', rendered)
        self.assertTrue(any(call[0] == 'docker' for call in calls))

    def test_release_never_uses_generated_storage_or_configured_sha_as_live_proof(self):
        def fake_readonly(argv, timeout=20):
            if argv[:3] == ['coolify', 'app', 'get']:
                return json.dumps({'uuid': 'app-1', 'status': 'running:healthy',
                                   'git_commit_sha': 'abcdef0',
                                   'storage': [{'name': 'expected-volume'}]}), None
            if argv[:4] == ['coolify', 'app', 'deployments', 'list']:
                return '[]', None
            return None, 'docker unavailable: raw diagnostic secret'

        with patch.object(cli, 'run_readonly', side_effect=fake_readonly), \
             patch.object(cli.urllib.request, 'build_opener', side_effect=OSError('private error')):
            code, rendered, record = invoke([
                'release', '--app', 'app-1', '--product-sha', 'abcdef0',
                '--expected-volume', 'expected-volume', '--mount-destination', '/pb/pb_data',
                '--endpoint', 'https://karaoke.example/healthz'])
        self.assertEqual(code, 2)
        self.assertEqual(record['status'], 'unavailable')
        self.assertIsNone(record['observedProductSha'])
        self.assertEqual(record['configuredSha'], 'abcdef0')
        self.assertEqual(record['container']['inspection']['status'], 'unavailable')
        self.assertNotIn('private error', rendered)
        self.assertNotIn('raw diagnostic secret', rendered)

    def test_release_fails_closed_when_newest_deployment_timestamp_is_invalid(self):
        records = [
            {'id': 'finished-old', 'status': 'finished', 'commit': 'abcdef0',
             'created_at': '2026-10-01T00:00:00Z', 'finished_at': '2026-10-01T00:01:00Z'},
            {'id': 'newest-unknown', 'status': 'finished', 'commit': '1234567',
             'created_at': 'not-a-timestamp', 'finished_at': '2026-10-02T00:01:00Z'},
        ]
        inspect = [{
            'Name': '/pb-container',
            'Config': {'Labels': {'coolify.applicationId': 'app-1',
                                  'com.docker.compose.service': 'pocketbase'}},
            'State': {'Running': True, 'Health': {'Status': 'healthy'}},
            'Mounts': [{'Type': 'volume', 'Name': 'pb-volume',
                        'Destination': '/pb/pb_data', 'RW': True}],
        }]

        def fake_readonly(argv, timeout=20):
            if argv[:3] == ['coolify', 'app', 'get']:
                return json.dumps({'uuid': 'app-1', 'status': 'running:healthy'}), None
            if argv[:4] == ['coolify', 'app', 'deployments', 'list']:
                return json.dumps(records), None
            if argv[:3] == ['docker', '--context', 'staging']:
                return json.dumps(inspect), None
            return None, 'command_failed'

        class Response:
            status = 204
            def __enter__(self): return self
            def __exit__(self, *unused): return False

        class Opener:
            def open(self, request, timeout): return Response()

        with patch.object(cli, 'run_readonly', side_effect=fake_readonly), \
             patch.object(cli.urllib.request, 'build_opener', return_value=Opener()):
            code, _, record = invoke([
                'release', '--app', 'app-1', '--product-sha', '1234567',
                '--expected-volume', 'pb-volume', '--mount-destination', '/pb/pb_data',
                '--endpoint', 'https://karaoke.example/healthz', '--docker-context', 'staging',
                '--container', 'pb-container', '--service', 'pocketbase'])

        self.assertEqual(code, 2)
        self.assertEqual(record['status'], 'unavailable')
        self.assertEqual(record['observedProductSha'], '1234567')
        self.assertIsNone(record['latestDeploymentPhase'])
        self.assertEqual(record['retainedVolume']['mount']['status'], 'verified')
        self.assertEqual(record['endpoint']['status'], 'verified')

    def test_manifest_reuse_survives_docs_head_but_invalidates_declared_inputs(self):
        fixture = retained_dir()
        root = fixture / 'repo'
        root.mkdir()
        (root / 'src').mkdir()
        (root / 'tests').mkdir()
        (root / 'src' / 'app.py').write_text('source-v1', encoding='utf-8')
        (root / 'tests' / 'test_app.py').write_text('test-v1', encoding='utf-8')
        (root / 'package.json').write_text('{"scripts":{"test":"ok"}}', encoding='utf-8')
        (root / 'bun.lock').write_text('runtime-deps-v1', encoding='utf-8')
        (root / 'README.md').write_text('docs-v1', encoding='utf-8')
        first = fixture / 'manifest.json'
        capture_record = fixture / 'captured-run.json'
        import sys

        command = [sys.executable, '-c', 'pass']
        command_json = json.dumps(command)
        base_args = ['manifest', '--root', str(root), '--implementation-sha', 'product-sha',
                     '--scope', 'src', 'tests', 'package.json', 'bun.lock',
                     '--command-json', command_json, '--selector', 'tests/test_app.py',
                     '--runtime', 'Bun test runtime']
        current_head = {'value': 'baseline-head'}

        def fake_git(_root, *args):
            if args == ('rev-parse', 'HEAD'):
                return current_head['value'], None
            if args == ('branch', '--show-current'):
                return 'main', None
            if args == ('status', '--porcelain', '-z'):
                return '', None
            return None, 'unavailable'

        with patch.object(cli, 'git', side_effect=fake_git), \
             patch.object(cli, 'run_readonly', side_effect=clean_git_readonly):
            code, _, captured = invoke([
                'capture-run', '--root', str(root), '--implementation-sha', 'product-sha',
                '--scope', 'src', 'tests', 'package.json', 'bun.lock',
                '--selector', 'tests/test_app.py', '--runtime', 'Bun test runtime',
                '--output', str(capture_record), '--', *command])
            self.assertEqual(code, 0)
            self.assertEqual(captured['implementationSha'], 'product-sha')
            self.assertEqual(captured['scopeFingerprintBefore'], captured['scopeFingerprintAfter'])
            self.assertEqual(captured['scopeChanged'], False)
            self.assertEqual(captured['selectors'], ['tests/test_app.py'])
            self.assertEqual(captured['runtime'], 'Bun test runtime')
            code, _, first_record = invoke([*base_args, '--compare-run', str(capture_record)])
            self.assertEqual(code, 0)
            first.write_text(json.dumps(first_record), encoding='utf-8')

            before_head = first_record['head']
            (root / 'README.md').write_text('docs-v2', encoding='utf-8')
            current_head['value'] = 'docs-only-head'
            code, _, after_docs = invoke([*base_args, '--compare-run', str(capture_record)])
            self.assertEqual(code, 0)
            self.assertNotEqual(after_docs['head'], before_head)
            self.assertTrue(after_docs['reuse']['reusable'])

            for filename, changed in [('src/app.py', 'source-v2'),
                                      ('tests/test_app.py', 'test-v2'),
                                      ('package.json', '{"scripts":{"test":"changed"}}'),
                                      ('bun.lock', 'runtime-deps-v2')]:
                with self.subTest(changed_input=filename):
                    path = root / filename
                    original = path.read_text(encoding='utf-8')
                    path.write_text(changed, encoding='utf-8')
                    code, _, changed_manifest = invoke([*base_args, '--compare-run', str(capture_record)])
                    self.assertEqual(code, 0)
                    self.assertFalse(changed_manifest['reuse']['reusable'], filename)
                    path.write_text(original, encoding='utf-8')

            code, _, changed_selector = invoke([*base_args, '--selector', 'tests/other.py',
                                                '--compare-run', str(capture_record)])
            self.assertEqual(code, 0)
            self.assertFalse(changed_selector['reuse']['reusable'])
            code, _, changed_command = invoke(['manifest', '--root', str(root),
                                               '--implementation-sha', 'product-sha',
                                               '--scope', 'src', 'tests', 'package.json', 'bun.lock',
                                               '--command-json', json.dumps(['bun', 'test:unit', '--run', '--reporter', 'dot']),
                                               '--selector', 'tests/test_app.py',
                                               '--runtime', 'Bun test runtime', '--compare-run', str(capture_record)])
            self.assertEqual(code, 0)
            self.assertFalse(changed_command['reuse']['reusable'])
            code, _, changed_runtime = invoke(['manifest', '--root', str(root),
                                               '--implementation-sha', 'product-sha',
                                               '--scope', 'src', 'tests', 'package.json', 'bun.lock',
                                               '--command-json', command_json, '--selector', 'tests/test_app.py',
                                               '--runtime', 'Bun runtime changed',
                                               '--compare-run', str(capture_record)])
            self.assertEqual(code, 0)
            self.assertFalse(changed_runtime['reuse']['reusable'])
            code, _, changed_product_sha = invoke(['manifest', '--root', str(root),
                                                   '--implementation-sha', 'other-product-sha',
                                                   '--scope', 'src', 'tests', 'package.json', 'bun.lock',
                                                   '--command-json', command_json, '--selector', 'tests/test_app.py',
                                                   '--runtime', 'Bun test runtime',
                                                   '--compare-run', str(capture_record)])
            self.assertEqual(code, 0)
            self.assertFalse(changed_product_sha['reuse']['reusable'])

    def test_manifest_does_not_present_an_imported_manifest_as_execution_evidence(self):
        fixture = retained_dir()
        root = fixture / 'repo'
        root.mkdir()
        (root / 'input.py').write_text('stable', encoding='utf-8')
        imported = fixture / 'imported.json'
        imported.write_text(json.dumps({'schemaVersion': 1, 'kind': 'run', 'status': 'verified',
                                        'command': ['made-up'], 'exitCode': 0}), encoding='utf-8')
        with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly):
            code, rendered, record = invoke([
                'manifest', '--root', str(root), '--implementation-sha', 'claimed-sha',
                '--scope', 'input.py', '--command-json', '["made-up"]', '--runtime', 'unknown',
                '--compare-run', str(imported)])
        self.assertEqual(code, 0, 'a manifest may describe a snapshot without claiming execution')
        self.assertEqual(record['status'], 'verified')
        self.assertFalse(record['reuse']['evidenceValid'])
        self.assertFalse(record['reuse']['reusable'])
        self.assertNotIn('execution verified', rendered.lower())

    def test_manifest_rejects_empty_missing_outside_and_symlink_scopes(self):
        fixture = retained_dir()
        root = fixture / 'repo'
        root.mkdir()
        (root / 'present.py').write_text('present', encoding='utf-8')
        (root / 'linked.py').symlink_to(root / 'present.py')
        base = ['manifest', '--root', str(root), '--implementation-sha', 'claimed-sha',
                '--command-json', '["echo","ok"]', '--runtime', 'Python test']

        with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly):
            for scope, expected_type in [('missing.py', 'missing'),
                                         ('../outside.py', 'outside_repository'),
                                         ('linked.py', 'symlink')]:
                with self.subTest(scope=scope):
                    code, _, record = invoke([*base, '--scope', scope])
                    self.assertEqual(code, 2)
                    self.assertEqual(record['status'], 'unavailable')
                    self.assertEqual(record['claims']['scopeSnapshot'], 'unavailable')
                    self.assertIn(expected_type, {entry['type'] for entry in record['invalidScope']})

        stderr = io.StringIO()
        with patch.object(__import__('sys'), 'stderr', stderr), self.assertRaises(SystemExit) as error:
            cli.main([*base, '--scope', '--compare-run', str(fixture / 'absent.json')])
        self.assertEqual(error.exception.code, 2)

    def test_manifest_preserves_first_porcelain_path_with_leading_status_space(self):
        fixture = retained_dir()
        root = fixture / 'repo'
        root.mkdir()
        (root / 'src.py').write_text('source', encoding='utf-8')
        dirty_path = '.agents/skills/feature/ACTIVE.md'
        dirty_file = root / dirty_path
        dirty_file.parent.mkdir(parents=True)
        dirty_file.write_text('local workflow change', encoding='utf-8')
        raw_status = f' M {dirty_path}\0'

        def git_output(argv, timeout=20):
            if argv and argv[0] == 'git' and argv[-3:] == ['status', '--porcelain', '-z']:
                return raw_status, None
            return clean_git_readonly(argv, timeout)

        with patch.object(cli, 'run_readonly', side_effect=git_output):
            code, _, record = invoke([
                'manifest', '--root', str(root), '--implementation-sha', 'product-sha',
                '--scope', 'src.py', '--command-json', '["echo","ok"]',
                '--runtime', 'Python test'])

        self.assertEqual(code, 0)
        self.assertEqual(record['dirtyPreservation']['status'], 'verified')
        self.assertEqual(record['dirtyPreservation']['paths'], [dirty_path])
        preserved = record['dirtyPreservation']['files']
        self.assertEqual(preserved, [{'path': dirty_path, 'type': 'file',
                                     'sha256': hashlib.sha256(b'local workflow change').hexdigest()}])

    def test_manifest_git_status_read_failure_is_unavailable_not_empty_preservation(self):
        fixture = retained_dir()
        root = fixture / 'repo'
        root.mkdir()
        (root / 'src.py').write_text('source', encoding='utf-8')

        def failed_status(argv, timeout=20):
            if argv and argv[0] == 'git' and argv[-3:] == ['status', '--porcelain', '-z']:
                return None, 'command_failed'
            return clean_git_readonly(argv, timeout)

        with patch.object(cli, 'run_readonly', side_effect=failed_status):
            code, _, record = invoke([
                'manifest', '--root', str(root), '--implementation-sha', 'product-sha',
                '--scope', 'src.py', '--command-json', '["echo","ok"]',
                '--runtime', 'Python test'])

        self.assertEqual(code, 2)
        self.assertEqual(record['status'], 'unavailable')
        self.assertEqual(record['claims']['scopeSnapshot'], 'unavailable')
        self.assertEqual(record['dirtyPreservation'], {
            'status': 'unavailable', 'reason': 'git_status_unavailable',
            'fingerprint': None, 'files': [], 'paths': [],
        })

    def test_unreadable_dirty_directory_is_unavailable_not_an_empty_snapshot(self):
        fixture = retained_dir()
        root = fixture / 'repo'
        (root / 'src').mkdir(parents=True)
        (root / 'src' / 'input.py').write_text('source', encoding='utf-8')

        def dirty_status(argv, timeout=20):
            if argv and argv[0] == 'git' and argv[-3:] == ['status', '--porcelain', '-z']:
                return ' M src\0', None
            return clean_git_readonly(argv, timeout)

        def inaccessible_walk(path, followlinks=False, onerror=None):
            if onerror:
                onerror(PermissionError(13, 'permission denied', str(Path(path) / 'input.py')))
            return iter(())

        with patch.object(cli, 'run_readonly', side_effect=dirty_status), \
             patch.object(cli.os, 'walk', side_effect=inaccessible_walk):
            preserved = cli.dirty_fingerprint(root)

        self.assertEqual(preserved['status'], 'unavailable')
        self.assertEqual(preserved['reason'], 'dirty_file_unavailable')
        self.assertIsNone(preserved['fingerprint'])
        self.assertEqual(preserved['paths'], ['src'])
        self.assertIn({'path': 'src/input.py', 'type': 'unavailable'}, preserved['files'])

    def test_manifest_malformed_non_object_comparison_record_fails_closed(self):
        fixture = retained_dir()
        root = fixture / 'repo'
        root.mkdir()
        (root / 'scope.py').write_text('stable', encoding='utf-8')
        comparison = fixture / 'comparison.json'
        comparison.write_text('[]', encoding='utf-8')
        with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly):
            code, _, record = invoke([
                'manifest', '--root', str(root), '--implementation-sha', 'product-sha',
                '--scope', 'scope.py', '--command-json', '["echo","ok"]',
                '--runtime', 'Python test', '--compare-run', str(comparison)])
        self.assertEqual(code, 0)
        self.assertEqual(record['status'], 'verified')
        self.assertFalse(record['reuse']['evidenceValid'])
        self.assertFalse(record['reuse']['reusable'])

    def test_capture_symlink_and_nested_symlink_scopes_fail_before_running_command(self):
        import sys

        fixture = retained_dir()
        root = fixture / 'repo'
        artifacts = fixture / 'artifacts'
        root.mkdir()
        artifacts.mkdir()
        real = root / 'real'
        real.mkdir()
        (real / 'source.py').write_text('source', encoding='utf-8')
        (root / 'direct.py').symlink_to(real / 'source.py')
        (root / 'linked-dir').symlink_to(real, target_is_directory=True)
        marker = root / 'command-ran.txt'
        command = [sys.executable, '-c',
                   f"from pathlib import Path; Path({str(marker)!r}).write_text('ran')"]

        for index, scope in enumerate(('direct.py', 'linked-dir/source.py')):
            with self.subTest(scope=scope):
                output = artifacts / f'symlink-{index}.json'
                code, _, record = invoke([
                    'capture-run', '--root', str(root), '--implementation-sha', 'product-sha',
                    '--scope', scope, '--runtime', 'Python test', '--output', str(output),
                    '--', *command])
                self.assertEqual(code, 2)
                self.assertEqual(record['status'], 'unavailable')
                self.assertFalse(output.exists())
                self.assertFalse(marker.exists())

    def test_handoff_rejects_release_and_run_records_for_different_implementation_sha(self):
        fixture = retained_dir()
        timestamp = datetime.now(timezone.utc).isoformat()
        release = {
            'schemaVersion': cli.SCHEMA_VERSION, 'kind': 'release', 'status': 'verified',
            'capturedAt': timestamp, 'callerApp': 'app-1', 'expectedProductSha': 'abcdef0',
            'observedProductSha': 'abcdef0', 'appRead': 'verified',
            'app': {'uuid': 'app-1', 'status': 'running:healthy'},
            'latestDeploymentPhase': {'status': 'finished'},
            'latestFinishedDeployment': {'status': 'finished', 'commit': 'abcdef0'},
            'retainedVolume': {'expectedName': 'pb-volume', 'mount': {
                'status': 'verified', 'actualVolume': 'pb-volume', 'volumeType': 'volume',
                'readWrite': True, 'running': True}},
            'endpoint': {'status': 'verified', 'httpStatus': 200,
                         'association': 'caller_supplied_target_unverified'},
            'container': {'name': 'pb-container', 'service': 'pocketbase'},
        }
        release_path = fixture / 'release.json'
        release_path.write_text(json.dumps(release), encoding='utf-8')
        code, _, release_handoff = invoke([
            'handoff', '--implementation-sha', '1234567', '--documentation-head', 'docs-sha',
            '--record', str(release_path), '--format', 'json'])
        self.assertEqual(code, 0)
        self.assertEqual(release_handoff['evidenceStatus'], 'unavailable')
        self.assertEqual(release_handoff['recordValidation']['rejectedRecordCount'], 1)

        root = fixture / 'repo'
        root.mkdir()
        (root / 'scope.py').write_text('stable', encoding='utf-8')
        run_path = fixture / 'run.json'
        import sys
        with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly):
            code, _, run = invoke([
                'capture-run', '--root', str(root), '--implementation-sha', 'abcdef0',
                '--scope', 'scope.py', '--runtime', 'Python test', '--output', str(run_path),
                '--', sys.executable, '-c', 'pass'])
        self.assertEqual(code, 0)
        self.assertEqual(run['status'], 'verified')
        code, _, run_handoff = invoke([
            'handoff', '--implementation-sha', '1234567', '--documentation-head', 'docs-sha',
            '--record', str(run_path), '--format', 'json'])
        self.assertEqual(code, 0)
        self.assertEqual(run_handoff['evidenceStatus'], 'unavailable')
        self.assertEqual(run_handoff['recordValidation']['rejectedRecordCount'], 1)

    def test_manifest_rejects_argv_changes_hidden_by_redaction(self):
        import sys

        fixture = retained_dir()
        root = fixture / 'repo'
        root.mkdir()
        (root / 'scope.py').write_text('stable', encoding='utf-8')
        run_path = fixture / 'run.json'
        first_command = [sys.executable, '-c', 'pass', '--token=secret-one']
        second_command = [sys.executable, '-c', 'pass', '--token=secret-two']
        with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly):
            code, _, run = invoke([
                'capture-run', '--root', str(root), '--implementation-sha', 'product-sha',
                '--scope', 'scope.py', '--runtime', 'Python test', '--output', str(run_path),
                '--', *first_command])
        self.assertEqual(code, 0)
        base = ['manifest', '--root', str(root), '--implementation-sha', 'product-sha',
                '--scope', 'scope.py', '--runtime', 'Python test']
        with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly):
            code, _, first = invoke([*base, '--command-json', json.dumps(first_command),
                                     '--compare-run', str(run_path)])
            self.assertEqual(code, 0)
            code, _, changed = invoke([*base, '--command-json', json.dumps(second_command),
                                       '--compare-run', str(run_path)])
        self.assertEqual(code, 0)
        self.assertEqual(first['command'], changed['command'])
        self.assertNotEqual(first['commandFingerprint'], changed['commandFingerprint'])
        self.assertFalse(changed['reuse']['reusable'])

    def test_manifest_rejects_runtime_executable_bytes_changed_under_same_label(self):
        fixture = retained_dir()
        root = fixture / 'repo'
        root.mkdir()
        (root / 'scope.py').write_text('stable', encoding='utf-8')
        executable = fixture / 'runtime'
        executable.write_text('#!/usr/bin/env python3\nraise SystemExit(0)\n', encoding='utf-8')
        executable.chmod(0o755)
        command = [str(executable), 'run']
        run_path = fixture / 'run.json'
        with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly):
            code, _, run = invoke([
                'capture-run', '--root', str(root), '--implementation-sha', 'product-sha',
                '--scope', 'scope.py', '--runtime', 'Python runtime version X',
                '--output', str(run_path), '--', *command])
        self.assertEqual(code, 0)
        base = ['manifest', '--root', str(root), '--implementation-sha', 'product-sha',
                '--scope', 'scope.py', '--command-json', json.dumps(command),
                '--runtime', 'Python runtime version X', '--compare-run', str(run_path)]
        with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly):
            code, _, before = invoke(base)
        self.assertEqual(code, 0)
        self.assertTrue(before['reuse']['reusable'])

        executable.write_text('#!/usr/bin/env python3\n# changed bytes\nraise SystemExit(0)\n', encoding='utf-8')
        executable.chmod(0o755)
        with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly):
            code, _, after = invoke(base)
        self.assertEqual(code, 0)
        self.assertNotEqual(before['executableSha256'], after['executableSha256'])
        self.assertFalse(after['reuse']['reusable'])

    def test_capture_timeout_and_scope_invalidity_never_verify_and_discard_output(self):
        fixture = retained_dir()
        root = fixture / 'repo'
        artifacts = fixture / 'artifacts'
        root.mkdir()
        artifacts.mkdir()
        (root / 'scope.txt').write_text('stable', encoding='utf-8')
        timeout_artifact = artifacts / 'timeout.json'
        with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly):
            code, rendered, timed_out = invoke([
                'capture-run', '--root', str(root), '--implementation-sha', 'sha',
                '--scope', 'scope.txt', '--runtime', 'Python test', '--timeout', '1',
                '--output', str(timeout_artifact), '--', __import__('sys').executable,
                '-c', "import time; print('token=secret-from-stdout'); time.sleep(3)"])
        self.assertEqual(code, 2)
        self.assertEqual(timed_out['status'], 'unavailable')
        self.assertTrue(timed_out['timedOut'])
        self.assertNotIn('secret-from-stdout', rendered)
        self.assertNotIn('secret-from-stdout', timeout_artifact.read_text(encoding='utf-8'))

        invalid_scope = artifacts / 'invalid-scope.json'
        code, _, record = invoke([
            'capture-run', '--root', str(root), '--implementation-sha', 'sha',
            '--scope', '../outside', '--runtime', 'Python test',
            '--output', str(invalid_scope), '--', __import__('sys').executable, '-c', 'pass'])
        self.assertEqual(code, 2)
        self.assertEqual(record['status'], 'unavailable')
        self.assertFalse(invalid_scope.exists())

    def test_device_identity_mismatch_stops_before_package_access_and_hash_mismatch_is_visible(self):
        calls = []
        def fake_run(argv, **kwargs):
            calls.append(argv)
            if argv == ['adb', 'devices', '-l']:
                return subprocess.CompletedProcess(argv, 0,
                    stdout='List of devices attached\nother device product:trona model:KFTRWI device:trona\n', stderr='')
            return subprocess.CompletedProcess(argv, 0, stdout='sensitive package output', stderr='')

        fixture = retained_dir()
        apk = fixture / 'app.apk'
        apk.write_bytes(b'expected apk')
        with patch.object(cli.subprocess, 'run', side_effect=fake_run):
            code, rendered, record = invoke([
                'device', '--serial', 'wanted', '--expected-model', 'KFTRWI',
                '--expected-product', 'trona', '--expected-device', 'trona',
                '--apk-path', str(apk), '--apk-sha256', hashlib.sha256(b'expected apk').hexdigest(),
                '--package', 'net.example.companion'])
        self.assertEqual(code, 2)
        self.assertEqual(record['status'], 'unavailable')
        self.assertEqual(calls, [['adb', 'devices', '-l']])
        self.assertNotIn('sensitive package output', rendered)

        def matching_device_run(argv, **kwargs):
            if argv == ['adb', 'devices', '-l']:
                return subprocess.CompletedProcess(argv, 0,
                    stdout='List of devices attached\nwanted device product:trona model:KFTRWI device:trona\n', stderr='')
            command = argv[3:]
            if command == ['shell', 'getprop', 'ro.build.version.release']:
                return subprocess.CompletedProcess(argv, 0, stdout='14\n', stderr='')
            if command == ['shell', 'pm', 'path', 'net.example.companion']:
                return subprocess.CompletedProcess(argv, 0, stdout='package:/data/app/base.apk\n', stderr='')
            if command == ['shell', 'dumpsys', 'package', 'net.example.companion']:
                return subprocess.CompletedProcess(argv, 0,
                    stdout='Packages:\n  Package [net.example.companion] (123):\n    versionName=1.0\n    versionCode=1\n', stderr='')
            if command == ['shell', 'sha256sum', '--', '/data/app/base.apk']:
                return subprocess.CompletedProcess(argv, 0, stdout=hashlib.sha256(b'other apk').hexdigest() + '  /data/app/base.apk\n', stderr='')
            raise AssertionError(argv)

        with patch.object(cli.subprocess, 'run', side_effect=matching_device_run):
            code, rendered, record = invoke([
                'device', '--serial', 'wanted', '--expected-model', 'KFTRWI',
                '--expected-product', 'trona', '--expected-device', 'trona',
                '--apk-path', str(apk), '--apk-sha256', hashlib.sha256(b'expected apk').hexdigest(),
                '--package', 'net.example.companion'])
        self.assertEqual(code, 2)
        self.assertEqual(record['status'], 'mismatch')
        self.assertTrue(record['installedApk']['packagePresent'])
        self.assertEqual(record['installedApk']['versionName'], '1.0')
        self.assertNotIn('Package [net.example.companion]', rendered)

        realistic_path = '/data/app/net.starsummit.karaoke.companion-v0IAZiH787-mV3urNRpccw==/base.apk'
        expected_hash = hashlib.sha256(b'expected apk').hexdigest()
        hash_commands = []

        def realistic_install_run(argv, **kwargs):
            if argv == ['adb', 'devices', '-l']:
                return subprocess.CompletedProcess(argv, 0,
                    stdout='List of devices attached\nwanted device product:trona model:KFTRWI device:trona\n', stderr='')
            command = argv[3:]
            if command == ['shell', 'getprop', 'ro.build.version.release']:
                return subprocess.CompletedProcess(argv, 0, stdout='14\n', stderr='')
            if command == ['shell', 'pm', 'path', 'net.example.companion']:
                return subprocess.CompletedProcess(argv, 0, stdout=f'package:{realistic_path}\n', stderr='')
            if command == ['shell', 'dumpsys', 'package', 'net.example.companion']:
                return subprocess.CompletedProcess(argv, 0,
                    stdout='Package [net.example.companion] versionName=1.0 versionCode=1', stderr='')
            if command == ['shell', 'sha256sum', '--', realistic_path]:
                hash_commands.append(command)
                return subprocess.CompletedProcess(argv, 0, stdout=f'{expected_hash}  {realistic_path}\n', stderr='')
            raise AssertionError(argv)

        with patch.object(cli.subprocess, 'run', side_effect=realistic_install_run):
            code, _, record = invoke([
                'device', '--serial', 'wanted', '--expected-model', 'KFTRWI',
                '--expected-product', 'trona', '--expected-device', 'trona',
                '--apk-path', str(apk), '--apk-sha256', expected_hash,
                '--package', 'net.example.companion'])
        self.assertEqual(code, 0)
        self.assertEqual(record['status'], 'verified')
        self.assertEqual(record['installedApk']['path'], realistic_path)
        self.assertTrue(hash_commands)

    def test_device_rejects_untrusted_adb_shell_package_and_installed_path_values(self):
        fixture = retained_dir()
        apk = fixture / 'app.apk'
        apk.write_bytes(b'expected apk')
        expected_hash = hashlib.sha256(b'expected apk').hexdigest()
        identity = ('List of devices attached\nwanted device product:trona '
                    'model:KFTRWI device:trona\n')

        package_calls = []
        def invalid_package(argv, timeout=20):
            package_calls.append(argv)
            if argv == ['adb', 'devices', '-l']:
                return identity, None
            if argv[4:] == ['getprop', 'ro.build.version.release']:
                return '14', None
            return 'sensitive output', None

        with patch.object(cli, 'run_readonly', side_effect=invalid_package):
            code, _, _ = invoke([
                'device', '--serial', 'wanted', '--expected-model', 'KFTRWI',
                '--expected-product', 'trona', '--expected-device', 'trona',
                '--apk-path', str(apk), '--apk-sha256', expected_hash,
                '--package', 'net.example.app;id'])
        self.assertEqual(code, 2)
        unsafe_package_read = any('pm' in argv or 'dumpsys' in argv or 'sha256sum' in argv
                                  for argv in package_calls)

        path_calls = []
        def injected_path(argv, timeout=20):
            path_calls.append(argv)
            if argv == ['adb', 'devices', '-l']:
                return identity, None
            if argv[4:] == ['getprop', 'ro.build.version.release']:
                return '14', None
            if argv[4:] == ['pm', 'path', 'net.example.companion']:
                return 'package:/data/app/base.apk; id', None
            if argv[4:] == ['dumpsys', 'package', 'net.example.companion']:
                return 'Package [net.example.companion] versionName=1.0', None
            return expected_hash + '  injected-path\n', None

        with patch.object(cli, 'run_readonly', side_effect=injected_path):
            code, rendered, record = invoke([
                'device', '--serial', 'wanted', '--expected-model', 'KFTRWI',
                '--expected-product', 'trona', '--expected-device', 'trona',
                '--apk-path', str(apk), '--apk-sha256', expected_hash,
                '--package', 'net.example.companion'])
        self.assertEqual(code, 2)
        self.assertNotEqual(record['status'], 'verified')
        unsafe_path_read = any('sha256sum' in argv for argv in path_calls)
        self.assertNotIn('injected-path', rendered)
        self.assertFalse(unsafe_package_read, 'invalid package text reached an adb package query')
        self.assertFalse(unsafe_path_read, 'untrusted pm path reached adb shell sha256sum')

    def test_tablet_status_requires_fresh_current_matching_controller_evidence(self):
        fixture = retained_dir()
        now = datetime.now(timezone.utc)
        payload = {
            'party': {'id': 'party-1', 'code': 'private-party-code', 'status': 'active',
                      'expiresAt': 'later'},
            'queue': [{'status': 'playing', 'song': {'youtubeId': 'selected-video'}}],
            'controller': {'connected': True, 'connectionState': 'connected',
                           'device': {'id': 'fire-id', 'name': 'Fire'},
                           'state': {'playerState': 'PLAYING', 'videoId': 'selected-video',
                                     'observedAt': now.isoformat()}},
        }

        class Response:
            def __init__(self, data): self.data = data
            def __enter__(self): return self
            def __exit__(self, *unused): return False
            def read(self): return json.dumps(self.data).encode()

        class Opener:
            def __init__(self, data): self.data = data; self.requests = []
            def open(self, request, timeout):
                self.requests.append(request)
                return Response(self.data)

        class FrozenDateTime:
            @staticmethod
            def now(tz=None): return now
            @staticmethod
            def fromisoformat(value): return datetime.fromisoformat(value)

        for age, expected in [(90, 'verified'), (91, 'unavailable')]:
            with self.subTest(age=age):
                payload['controller']['state']['observedAt'] = (now - timedelta(seconds=age)).isoformat()
                opener = Opener(payload)
                output = io.StringIO()
                with patch.object(cli.urllib.request, 'build_opener', return_value=opener), \
                     patch.object(cli, 'datetime', FrozenDateTime), \
                     patch.object(__import__('sys').stdin, 'readline', return_value='tablet-token-secret\n'), \
                     contextlib.redirect_stdout(output):
                    code = cli.main(['tablet-status', '--endpoint', 'https://tablet.example',
                                     '--party-id', 'party-1', '--token-stdin'])
                rendered = output.getvalue()
                record = json.loads(rendered)
                self.assertEqual(record['status'], expected)
                self.assertEqual(record['schemaVersion'], cli.SCHEMA_VERSION)
                self.assertNotIn('private-party-code', rendered)
                self.assertNotIn('tablet-token-secret', rendered)
                self.assertEqual(opener.requests[0].get_header('Authorization'), 'Bearer tablet-token-secret')
                self.assertEqual(opener.requests[0].full_url,
                                 'https://tablet.example/api/karaoke/tablet/status?partyId=party-1')
                if age == 90:
                    self.assertEqual(code, 0)
                else:
                    self.assertEqual(code, 2)

        for altered in [
            {**payload, 'party': {**payload['party'], 'id': 'different-party'}},
            {**payload, 'controller': {**payload['controller'], 'connected': False}},
            {**payload, 'controller': {**payload['controller'], 'state': {
                **payload['controller']['state'], 'videoId': 'different-video'}}},
            {'party': payload['party'], 'controller': payload['controller']},
        ]:
            with self.subTest(invalid_payload=altered):
                opener = Opener(altered)
                with patch.object(cli.urllib.request, 'build_opener', return_value=opener), \
                     patch.object(__import__('sys').stdin, 'readline', return_value='tablet-token-secret\n'):
                    code, _, record = invoke(['tablet-status', '--endpoint', 'https://tablet.example',
                                              '--party-id', 'party-1', '--token-stdin'])
                self.assertEqual(code, 2)
                self.assertNotEqual(record['status'], 'verified')

    def test_handoff_markdown_keeps_pending_proof_exact_approval_and_fails_closed(self):
        fixture = retained_dir()
        evidence = fixture / 'device.json'
        evidence.write_text(json.dumps({'schemaVersion': 1, 'kind': 'device', 'status': 'verified',
                                        'serial': 'fire-serial'}), encoding='utf-8')
        artifact = fixture / 'handoff.md'
        code, stdout, record = invoke([
            'handoff', '--implementation-sha', 'product-sha', '--documentation-head', 'docs-sha',
            '--record', str(evidence), '--diff', 'source change at product-sha',
            '--test', 'python3 -B -m unittest tools.closeout.test_behavior',
            '--approval-source', 'human approval note 2026-10-16',
            '--approved-action', 'deploy exact reviewed SHA', '--target', 'staging app app-1',
            '--effect', 'replace running app revision', '--exclusion', 'production cutover',
            '--output', str(artifact)])
        self.assertEqual(code, 0)
        text = artifact.read_text(encoding='utf-8')
        self.assertIn('product-sha', text)
        self.assertIn('docs-sha', text)
        self.assertIn('human approval note 2026-10-16', text)
        self.assertIn('staging app app-1', text)
        self.assertIn('replace running app revision', text)
        self.assertIn('production cutover', text)
        for required in ('TV identity', 'playback progression', 'natural completion', 'restart'):
            self.assertIn(required, text)
        self.assertNotIn('"authorizationGrantedByRecord": true', text)
        self.assertNotEqual(text.lstrip()[:1], '{', 'operator handoff artifact should be Markdown')

        code, _, status = invoke([
            'handoff', '--implementation-sha', 'product-sha', '--documentation-head', 'docs-sha',
            '--record', str(evidence), '--output', str(artifact)])
        self.assertEqual(code, 2)
        self.assertEqual(status['reason'], 'output_exists')

        malformed = fixture / 'malformed.json'
        malformed.write_text('{broken', encoding='utf-8')
        code, rendered, unavailable = invoke([
            'handoff', '--implementation-sha', 'product-sha', '--documentation-head', 'docs-sha',
            '--record', str(malformed)])
        self.assertEqual(code, 2)
        self.assertEqual(unavailable['status'], 'unavailable')
        self.assertNotIn('broken', rendered)

    def test_handoff_rejects_typed_release_device_and_tablet_records_without_required_proof(self):
        fixture = retained_dir()
        timestamp = datetime.now(timezone.utc).isoformat()
        base = ['handoff', '--implementation-sha', 'product-sha',
                '--documentation-head', 'docs-sha', '--format', 'json']

        for kind in ('release', 'device', 'tablet-status'):
            for include_timestamp in (False, True):
                with self.subTest(kind=kind, include_timestamp=include_timestamp):
                    record = {'schemaVersion': cli.SCHEMA_VERSION, 'kind': kind, 'status': 'verified'}
                    if include_timestamp:
                        record['capturedAt'] = timestamp
                    path = fixture / f'{kind}-{include_timestamp}.json'
                    path.write_text(json.dumps(record), encoding='utf-8')
                    code, _, handoff = invoke([*base, '--record', str(path)])
                    self.assertEqual(code, 0)
                    self.assertEqual(handoff['evidenceStatus'], 'unavailable')
                    self.assertEqual(handoff['recordValidation']['acceptedEvidenceCount'], 0)
                    self.assertEqual(handoff['recordValidation']['rejectedRecordCount'], 1)
                    self.assertEqual(handoff['readiness']['requiredDomains'][kind], 'unavailable')

        malformed_release = {
            'schemaVersion': cli.SCHEMA_VERSION, 'kind': 'release', 'status': 'unavailable',
            'capturedAt': timestamp, 'expectedProductSha': 'product-sha',
            'retainedVolume': 'unavailable',
        }
        path = fixture / 'malformed-retained-volume.json'
        path.write_text(json.dumps(malformed_release), encoding='utf-8')
        code, _, handoff = invoke([*base, '--record', str(path)])
        self.assertEqual(code, 0)
        self.assertEqual(handoff['evidenceStatus'], 'unavailable')
        self.assertEqual(handoff['recordValidation']['rejectedRecordCount'], 1)


if __name__ == '__main__':
    unittest.main()
