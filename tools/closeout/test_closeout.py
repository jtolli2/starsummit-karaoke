import contextlib
import io
import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from . import cli


def clean_git_readonly(argv, timeout=20):
    if argv and argv[0] == 'git' and argv[-3:] == ['status', '--porcelain', '-z']:
        return '', None
    if argv and argv[0] == 'git' and argv[-2:] == ['rev-parse', 'HEAD']:
        return 'test-head\n', None
    if argv and argv[0] == 'git' and argv[-2:] == ['branch', '--show-current']:
        return 'test-branch\n', None
    return None, 'unavailable'


class CloseoutEvidenceTests(unittest.TestCase):
    def test_fingerprint_detects_changed_and_missing_scoped_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'input.txt'
            target.write_text('before', encoding='utf-8')
            nested = root / 'src' / 'nested.ts'
            nested.parent.mkdir()
            nested.write_text('one', encoding='utf-8')
            before, _ = cli.fingerprint(root, ['input.txt', 'gone.txt', 'src'])
            target.write_text('after', encoding='utf-8')
            nested.write_text('two', encoding='utf-8')
            after, entries = cli.fingerprint(root, ['input.txt', 'gone.txt', 'src'])
            self.assertNotEqual(before, after)
            self.assertEqual({entry['path']: entry['type'] for entry in entries}['gone.txt'], 'missing')
            self.assertIn('src/nested.ts', {entry['path'] for entry in entries})

    def test_capture_discards_output_and_marks_nonzero_or_scope_change(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            artifacts = Path(directory) / 'artifacts'
            root.mkdir()
            scope_file = root / 'scope.txt'
            scope_file.write_text('stable', encoding='utf-8')
            artifact = artifacts / 'run.json'
            stdout = io.StringIO()
            args = ['capture-run', '--root', str(root), '--implementation-sha', 'impl',
                    '--scope', 'scope.txt', '--runtime', 'Python test', '--output', str(artifact),
                    '--', sys_executable(), '-c', "print('secret output')"]
            with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly), \
                 contextlib.redirect_stdout(stdout):
                self.assertEqual(cli.main(args), 0)
            record = json.loads(artifact.read_text(encoding='utf-8'))
            self.assertNotIn('secret output', artifact.read_text(encoding='utf-8'))
            self.assertNotIn('secret output', stdout.getvalue())
            self.assertEqual(record['status'], 'verified')
            self.assertEqual(record['command'][-1], '[inline code omitted]')

            changed = artifacts / 'changed.json'
            command = [sys_executable(), '-c', "from pathlib import Path; Path('scope.txt').write_text('changed')"]
            args[args.index(str(artifact))] = str(changed)
            args[args.index('--') + 1:] = command
            with patch.object(cli, 'run_readonly', side_effect=clean_git_readonly), \
                 contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(cli.main(args), 2)
            changed_record = json.loads(changed.read_text(encoding='utf-8'))
            self.assertEqual(changed_record['status'], 'mismatch')
            self.assertTrue(changed_record['scopeChanged'])

    def test_command_sanitization_redacts_sensitive_flag_values(self):
        result = cli.sanitized_argv(['tool', '--token', 'secret-token', '--api-key=secret-key', 'arg'])
        self.assertEqual(result, ['tool', '--token', '[redacted]', '--api-key=[redacted]', 'arg'])

    def test_capture_refuses_existing_or_repository_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'repo'
            root.mkdir()
            output = io.StringIO()
            args = ['capture-run', '--root', str(root), '--implementation-sha', 'impl',
                    '--scope', '.', '--runtime', 'Python', '--output', str(root / 'record.json'),
                    '--', sys_executable(), '-c', 'raise SystemExit(0)']
            with contextlib.redirect_stdout(output):
                self.assertEqual(cli.main(args), 2)
            self.assertEqual(json.loads(output.getvalue())['reason'], 'artifact_must_be_outside_repository')

    def test_mount_requires_verified_app_and_service_labels(self):
        inspect = [{'Name': '/container', 'Id': 'container-id',
                    'State': {'Running': True, 'Health': {'Status': 'healthy'}},
                    'Config': {'Labels': {'coolify.applicationId': 'app-id',
                                          'com.docker.compose.service': 'pocketbase'}},
                    'Mounts': [{'Name': 'volume-id', 'Type': 'volume', 'Destination': '/pb/pb_data', 'RW': True}]}]
        with patch.object(cli, 'run_readonly', return_value=(json.dumps(inspect), None)):
            result = cli._mount('host', 'container', 'pocketbase', 'app-id', 'volume-id', '/pb/pb_data')
        self.assertEqual(result['status'], 'verified')
        with patch.object(cli, 'run_readonly', return_value=(json.dumps(inspect), None)):
            mismatch = cli._mount('host', 'container', 'frontend', 'app-id', 'volume-id', '/pb/pb_data')
        self.assertEqual(mismatch['reason'], 'container_service_mismatch')
        stopped = json.loads(json.dumps(inspect))
        stopped[0]['State']['Running'] = False
        with patch.object(cli, 'run_readonly', return_value=(json.dumps(stopped), None)):
            mismatch = cli._mount('host', 'container', 'pocketbase', 'app-id', 'volume-id', '/pb/pb_data')
        self.assertEqual(mismatch['reason'], 'container_not_running')
        unhealthy = json.loads(json.dumps(inspect))
        unhealthy[0]['State']['Health']['Status'] = 'unhealthy'
        with patch.object(cli, 'run_readonly', return_value=(json.dumps(unhealthy), None)):
            mismatch = cli._mount('host', 'container', 'pocketbase', 'app-id', 'volume-id', '/pb/pb_data')
        self.assertEqual(mismatch['reason'], 'container_health_not_healthy')
        malformed_config = json.loads(json.dumps(inspect))
        malformed_config[0]['Config'] = None
        with patch.object(cli, 'run_readonly', return_value=(json.dumps(malformed_config), None)):
            unavailable = cli._mount('host', 'container', 'pocketbase', 'app-id', 'volume-id', '/pb/pb_data')
        self.assertNotEqual(unavailable['status'], 'verified')

    def test_deployed_sha_comes_from_latest_finished_deployment(self):
        records = [
            {'id': 1, 'status': 'finished', 'commit': 'aaaaaaa',
             'created_at': '2026-10-01T00:00:00Z', 'finished_at': '2026-10-01T00:00:00Z'},
            {'id': 2, 'status': 'running', 'commit': 'bbbbbbb',
             'created_at': '2026-10-02T00:00:00Z', 'finished_at': None},
            {'id': 3, 'status': 'finished', 'commit': 'ccccccc',
             'created_at': '2026-10-03T00:00:00Z', 'finished_at': '2026-10-03T00:00:00Z'},
        ]
        self.assertEqual(cli._sha_from(records), 'ccccccc')
        self.assertEqual(cli._latest_finished_deployment(records)['id'], 3)
        self.assertEqual(cli._latest_deployment(records)['id'], 3)
        records.append({'id': 4, 'status': 'running', 'commit': 'pending',
                        'created_at': '2026-10-04T00:00:00Z'})
        self.assertEqual(cli._latest_deployment(records)['status'], 'running')

    def test_malformed_newest_deployment_timestamp_does_not_fall_back_to_older_release(self):
        records = [
            {'id': 1, 'status': 'finished', 'commit': 'aaaaaaa',
             'created_at': '2026-10-01T00:00:00Z', 'finished_at': '2026-10-01T00:01:00Z'},
            {'id': 2, 'status': 'finished', 'commit': 'bbbbbbb',
             'created_at': 'invalid', 'finished_at': '2026-10-02T00:01:00Z'},
        ]

        self.assertIsNone(cli._latest_deployment(records))

    def test_stale_tablet_status_is_unavailable_and_redacts_token_and_party_code(self):
        observed = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
        payload = {'party': {'id': 'party-id', 'code': 'party-code-secret', 'status': 'active',
                             'expiresAt': 'later'},
                   'controller': {'connected': True, 'connectionState': 'connected',
                                  'device': {'id': 'device', 'name': 'Fire', 'password': 'never-show'},
                                  'state': {'playerState': 'playing', 'videoId': 'video-id',
                                            'observedAt': observed}},
                   'queue': [{'id': 'queue-id', 'status': 'playing',
                              'song': {'youtubeId': 'video-id'}}]}

        class Response:
            def __enter__(self): return self
            def __exit__(self, *unused): return False
            def read(self): return json.dumps(payload).encode()

        class Opener:
            def open(self, request, timeout):
                self.authorization = request.get_header('Authorization')
                self.url = request.full_url
                return Response()

        opener = Opener()
        stdout = io.StringIO()
        with patch.object(cli.urllib.request, 'build_opener', return_value=opener), \
             patch.object(sys, 'stdin', io.StringIO('bearer-secret\n')), \
             contextlib.redirect_stdout(stdout):
            result = cli.main(['tablet-status', '--endpoint', 'https://example.test',
                               '--party-id', 'party-id', '--token-stdin'])
        record = json.loads(stdout.getvalue())
        self.assertEqual(result, 2)
        self.assertEqual(record['status'], 'unavailable')
        self.assertEqual(opener.authorization, 'Bearer bearer-secret')
        self.assertNotIn('party-code-secret', stdout.getvalue())
        self.assertNotIn('bearer-secret', stdout.getvalue())
        self.assertNotIn('never-show', stdout.getvalue())
        self.assertNotIn('party-code-secret', opener.url)

    def test_tablet_status_requires_fresh_connected_selected_video_playing(self):
        observed = datetime.now(timezone.utc).isoformat()
        payload = {'party': {'id': 'party-id', 'status': 'active', 'expiresAt': 'later'},
                   'controller': {'connected': True, 'connectionState': 'connected', 'device': None,
                                  'state': {'playerState': 'playing', 'videoId': 'video-id',
                                            'observedAt': observed}},
                   'queue': [{'id': 'queue-id', 'status': 'playing',
                              'song': {'youtubeId': 'video-id'}}]}

        class Response:
            def __enter__(self): return self
            def __exit__(self, *unused): return False
            def read(self): return json.dumps(payload).encode()

        class Opener:
            def open(self, request, timeout): return Response()

        output = io.StringIO()
        with patch.object(cli.urllib.request, 'build_opener', return_value=Opener()), \
             patch.object(sys, 'stdin', io.StringIO('ephemeral\n')), \
             contextlib.redirect_stdout(output):
            result = cli.main(['tablet-status', '--endpoint', 'https://example.test',
                               '--party-id', 'party-id', '--token-stdin'])
        record = json.loads(output.getvalue())
        self.assertEqual(result, 0)
        self.assertEqual(record['status'], 'verified')
        self.assertEqual(record['convergence']['selectedVideoId'], 'video-id')
        payload['controller']['state']['videoId'] = 'different-video'
        output = io.StringIO()
        with patch.object(cli.urllib.request, 'build_opener', return_value=Opener()), \
             patch.object(sys, 'stdin', io.StringIO('ephemeral\n')), \
             contextlib.redirect_stdout(output):
            result = cli.main(['tablet-status', '--endpoint', 'https://example.test',
                               '--party-id', 'party-id', '--token-stdin'])
        self.assertEqual(result, 2)
        self.assertEqual(json.loads(output.getvalue())['status'], 'mismatch')

    def test_handoff_never_treats_empty_or_secret_bearing_records_as_authorization(self):
        with tempfile.TemporaryDirectory() as directory:
            record_path = Path(directory) / 'record.json'
            record_path.write_text(json.dumps({'schemaVersion': cli.SCHEMA_VERSION, 'kind': 'run',
                                               'status': 'verified', 'commandFingerprint': 'fingerprint',
                                               'collectorSha256': 'collector', 'scopeFingerprintBefore': 'same',
                                               'scopeFingerprintAfter': 'same', 'exitCode': 0, 'timedOut': False,
                                               'party': {'code': 'party-secret'},
                                               'authorization': 'Bearer bearer-secret'}), encoding='utf-8')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = cli.main(['handoff', '--implementation-sha', 'implementation',
                                   '--documentation-head', 'documentation', '--record', str(record_path),
                                   '--approved-action', 'Authorization source token=secret-value', '--format', 'json'])
            rendered = output.getvalue()
            handoff = json.loads(rendered)
            self.assertEqual(result, 0)
            self.assertEqual(handoff['evidenceStatus'], 'unavailable')
            self.assertEqual(handoff['status'], 'unavailable')
            self.assertEqual(handoff['recordValidation']['rejectedRecordCount'], 1)
            self.assertEqual(handoff['readiness']['requiredDomains']['release'], 'unavailable')
            self.assertFalse(handoff['approval']['authorizationGrantedByRecord'])
            self.assertNotIn('party-secret', rendered)
            self.assertNotIn('bearer-secret', rendered)
            self.assertNotIn('secret-value', rendered)
            markdown = io.StringIO()
            with contextlib.redirect_stdout(markdown):
                cli.main(['handoff', '--implementation-sha', 'implementation',
                          '--documentation-head', 'documentation', '--record', str(record_path)])
            self.assertIn('# Closeout handoff', markdown.getvalue())
            manifest_record = Path(directory) / 'manifest.json'
            manifest_record.write_text(json.dumps({'schemaVersion': cli.SCHEMA_VERSION, 'kind': 'manifest',
                                                   'status': 'verified', 'claims': {'scopeSnapshot': 'verified',
                                                                                    'executionEvidence': 'unavailable'}}),
                                       encoding='utf-8')
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                cli.main(['handoff', '--implementation-sha', 'implementation',
                          '--documentation-head', 'documentation', '--record', str(manifest_record), '--format', 'json'])
            self.assertEqual(json.loads(output.getvalue())['status'], 'unavailable')
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = cli.main(['handoff', '--implementation-sha', 'implementation',
                               '--documentation-head', 'documentation', '--format', 'json'])
        self.assertEqual(result, 0)
        self.assertEqual(json.loads(output.getvalue())['status'], 'unavailable')


def sys_executable():
    import sys
    return sys.executable


if __name__ == '__main__':
    unittest.main()
