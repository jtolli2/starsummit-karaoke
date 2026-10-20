from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from . import SCHEMA_VERSION


def envelope(kind: str, status: str, **fields):
    return {'schemaVersion': SCHEMA_VERSION, 'kind': kind, 'status': status,
            'summary': f'{kind.replace("-", " ").title()}: {status}',
            'capturedAt': datetime.now(timezone.utc).isoformat(), **fields}


def emit(record):
    print(json.dumps(record, sort_keys=True, indent=2))


def run_readonly(argv, timeout=20):
    try:
        result = subprocess.run(argv, capture_output=True, text=True, timeout=timeout,
                                check=False, env={**os.environ, 'NO_COLOR': '1'})
        if result.returncode:
            return None, 'command_failed'
        return result.stdout, None
    except (OSError, subprocess.TimeoutExpired):
        return None, 'unavailable'


def parse_json(stdout):
    try:
        return json.loads(stdout)
    except (ValueError, TypeError):
        return None


def git(root, *args):
    out, error = run_readonly(['git', '-C', str(root), *args])
    return (out.strip() if out else None), error


def _allowlisted_app(app):
    if not isinstance(app, dict):
        return {}
    keys = ('uuid', 'name', 'status', 'git_commit_sha', 'commit_sha',
            'docker_compose_domains', 'updated_at')
    return {key: app[key] for key in keys if key in app and isinstance(app[key], (str, int, bool, type(None)))}


def _timestamp(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    except ValueError:
        return None


def _deployment_records(records):
    if isinstance(records, dict):
        records = records.get('data', records.get('deployments', [records]))
    return records if isinstance(records, list) else []


def _sha_from(records):
    rows = _deployment_records(records)
    if any(not isinstance(item, dict) for item in rows):
        return None
    if any(str(item.get('status', '')).lower() == 'finished' and not _timestamp(item.get('finished_at'))
           for item in rows):
        return None
    completed = [item for item in rows if str(item.get('status', '')).lower() == 'finished']
    if not completed:
        return None
    latest_stamp = max(_timestamp(item.get('finished_at')) for item in completed)
    latest_rows = [item for item in completed if _timestamp(item.get('finished_at')) == latest_stamp]
    if len(latest_rows) != 1:
        return None
    latest = latest_rows[0]
    value = latest.get('commit')
    return value if isinstance(value, str) and len(value) >= 7 else None


def _latest_finished_deployment(records):
    rows = _deployment_records(records)
    if any(not isinstance(item, dict) for item in rows):
        return None
    if any(str(item.get('status', '')).lower() == 'finished' and not _timestamp(item.get('finished_at'))
           for item in rows):
        return None
    completed = [item for item in rows if str(item.get('status', '')).lower() == 'finished']
    if not completed:
        return None
    latest_stamp = max(_timestamp(item.get('finished_at')) for item in completed)
    latest_rows = [item for item in completed if _timestamp(item.get('finished_at')) == latest_stamp]
    if len(latest_rows) != 1:
        return None
    item = latest_rows[0]
    return {key: item[key] for key in ('id', 'deployment_uuid', 'status', 'commit', 'created_at', 'finished_at')
            if key in item and isinstance(item[key], (str, int, bool, type(None)))}


def _latest_deployment(records):
    rows = _deployment_records(records)
    if any(not isinstance(item, dict) for item in rows):
        return None
    if any(not _timestamp(item.get('created_at')) for item in rows):
        return None
    eligible = [(item, _timestamp(item.get('created_at'))) for item in rows]
    eligible = [(item, stamp) for item, stamp in eligible if stamp]
    if not eligible:
        return None
    latest_stamp = max(stamp for _, stamp in eligible)
    latest_rows = [item for item, stamp in eligible if stamp == latest_stamp]
    if len(latest_rows) != 1:
        return None
    item = latest_rows[0]
    return {key: item[key] for key in ('id', 'deployment_uuid', 'status', 'commit', 'created_at', 'finished_at')
            if key in item and isinstance(item[key], (str, int, bool, type(None)))}


def _health(url):
    if not url:
        return {'status': 'unavailable', 'reason': 'endpoint_not_supplied'}
    try:
        parsed = urllib.parse.urlsplit(url)
        if parsed.username or parsed.password or parsed.query or parsed.fragment:
            return {'status': 'unavailable', 'reason': 'endpoint_must_not_include_credentials_or_query'}
        req = urllib.request.Request(url, method='GET', headers={'User-Agent': 'closeout-evidence/1'})
        opener = urllib.request.build_opener(_NoRedirect())
        with opener.open(req, timeout=8) as response:
            return {'status': 'verified' if 200 <= response.status < 300 else 'mismatch',
                    'httpStatus': response.status, 'endpoint': f'{parsed.scheme}://{parsed.netloc}{parsed.path}'}
    except urllib.error.HTTPError as exc:
        return {'status': 'unavailable', 'httpStatus': exc.code, 'reason': 'http_error'}
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return {'status': 'unavailable', 'reason': 'request_failed'}


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _mount(docker_context, container, service, app_uuid, expected_volume, destination):
    if not docker_context or not container or not service:
        return {'status': 'unavailable', 'reason': 'docker_target_not_supplied'}
    cmd = ['docker', '--context', docker_context, 'inspect', container]
    out, error = run_readonly(cmd)
    obj = parse_json(out) if out else None
    if error or not isinstance(obj, list) or len(obj) != 1 or not isinstance(obj[0], dict):
        return {'status': 'unavailable', 'reason': error or 'invalid_inspect_response'}
    item = obj[0]
    actual_name = str(item.get('Name', '')).lstrip('/')
    actual_id = item.get('Id')
    identity_matches = actual_name == container or (isinstance(actual_id, str) and actual_id.startswith(container))
    if not identity_matches:
        return {'status': 'mismatch', 'reason': 'container_identity_mismatch'}
    config = item.get('Config') if isinstance(item.get('Config'), dict) else {}
    labels = config.get('Labels') if isinstance(config.get('Labels'), dict) else {}
    associated = labels.get('coolify.applicationId') == app_uuid or labels.get('com.docker.compose.project') == app_uuid
    if not associated:
        return {'status': 'mismatch', 'reason': 'container_app_association_mismatch'}
    if labels.get('com.docker.compose.service') != service:
        return {'status': 'mismatch', 'reason': 'container_service_mismatch'}
    state = item.get('State') if isinstance(item.get('State'), dict) else {}
    if state.get('Running') is not True:
        return {'status': 'mismatch', 'reason': 'container_not_running'}
    health = state.get('Health') if isinstance(state.get('Health'), dict) else None
    if health and health.get('Status') != 'healthy':
        return {'status': 'mismatch', 'reason': 'container_health_not_healthy', 'health': health.get('Status')}
    mounts = item.get('Mounts') if isinstance(item.get('Mounts'), list) else []
    matched = [m for m in mounts if isinstance(m, dict) and m.get('Destination') == destination]
    if len(matched) != 1:
        return {'status': 'mismatch', 'reason': 'mount_destination_mismatch'}
    actual = matched[0].get('Name')
    volume_type = matched[0].get('Type')
    if volume_type != 'volume':
        return {'status': 'mismatch', 'reason': 'mount_is_not_named_volume', 'actualType': volume_type}
    if matched[0].get('RW') is not True:
        return {'status': 'mismatch', 'reason': 'mount_not_readwrite'}
    health_state = health.get('Status') if health else 'unreported'
    status = 'verified' if actual == expected_volume and health_state in ('healthy', 'unreported') else 'mismatch'
    return {'status': status, 'actualVolume': actual, 'volumeType': volume_type,
            'destination': destination, 'readWrite': matched[0].get('RW'),
            'running': state.get('Running'), 'containerHealth': health_state}


def release(args):
    safe_name = lambda value: bool(re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', value or ''))
    if (not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*', args.app) or
            not re.fullmatch(r'[A-Fa-f0-9]{7,64}', args.product_sha) or
            not safe_name(args.expected_volume) or
            not re.fullmatch(r'/[A-Za-z0-9_./-]+', args.mount_destination) or
            any(part in ('.', '..') for part in args.mount_destination.split('/')) or
            (args.docker_context is not None and not safe_name(args.docker_context)) or
            (args.container is not None and not safe_name(args.container)) or
            (args.service is not None and not safe_name(args.service))):
        emit(envelope('release', 'unavailable', reason='invalid_release_target'))
        return 2
    app_out, app_error = run_readonly(['coolify', 'app', 'get', args.app, '--format', 'json'])
    dep_out, dep_error = run_readonly(['coolify', 'app', 'deployments', 'list', args.app, '--format', 'json'])
    app_raw, deployments = parse_json(app_out), parse_json(dep_out)
    app = _allowlisted_app(app_raw)
    latest_deployment = _latest_finished_deployment(deployments)
    latest_phase = _latest_deployment(deployments)
    deployed_sha = _sha_from(deployments)
    sha_state = 'unavailable' if deployed_sha is None else ('verified' if deployed_sha == args.product_sha else 'mismatch')
    app_state = ('unavailable' if app_error or not app or app.get('uuid') is None else
                 ('mismatch' if app.get('uuid') != args.app else
                  ('verified' if app.get('status') == 'running:healthy' else 'unavailable')))
    mount = _mount(args.docker_context, args.container, args.service, args.app, args.expected_volume, args.mount_destination)
    health = _health(args.endpoint)
    phase_state = ('unavailable' if latest_phase is None else
                   ('verified' if str(latest_phase.get('status', '')).lower() == 'finished' else 'unavailable'))
    states = [app_state, sha_state, phase_state, mount['status'], health['status']]
    status = 'mismatch' if 'mismatch' in states else ('verified' if all(s == 'verified' for s in states) else 'unavailable')
    emit(envelope('release', status, callerApp=args.app, expectedProductSha=args.product_sha,
                  observedProductSha=deployed_sha, app=app,
                  appRead=app_state, configuredSha=app.get('git_commit_sha'),
                  latestFinishedDeployment=latest_deployment, latestDeploymentPhase=latest_phase,
                  shaSource='latest_finished_coolify_deployment_commit',
                  deploymentsRead='unavailable' if dep_error else 'available',
                  retainedVolume={'expectedName': args.expected_volume, 'mount': mount},
                  endpoint={'target': health.get('endpoint', urllib.parse.urlsplit(args.endpoint).path),
                            'association': 'caller_supplied_target_unverified', **health},
                  container={'name': args.container, 'service': args.service, 'inspection': mount},
                  limits=['Coolify deployment commit evidence is not runtime image label evidence.',
                          'Coolify generated storage metadata is not live mount evidence.']))
    return 0 if status == 'verified' else 2


def fingerprint(root, paths):
    entries = []
    root = Path(root).resolve()

    def add_file(path, label):
        try:
            if path.is_symlink():
                entries.append({'path': label, 'type': 'symlink', 'target': os.readlink(path)})
            elif path.is_file():
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                entries.append({'path': label, 'type': 'file', 'sha256': digest})
            else:
                entries.append({'path': label, 'type': 'other'})
        except OSError:
            entries.append({'path': label, 'type': 'unavailable'})

    for raw in sorted(set(paths)):
        path = Path(os.path.abspath(root / raw))
        if path != root and root not in path.parents:
            entries.append({'path': raw, 'type': 'outside_repository'})
            continue
        cursor = root
        linked_ancestor = None
        try:
            for part in path.relative_to(root).parts:
                cursor = cursor / part
                if cursor.is_symlink():
                    linked_ancestor = cursor.relative_to(root).as_posix()
                    break
        except ValueError:
            entries.append({'path': raw, 'type': 'outside_repository'})
            continue
        if linked_ancestor is not None and cursor != path:
            entries.append({'path': raw, 'type': 'symlink_ancestor', 'ancestor': linked_ancestor})
            continue
        try:
            if path.is_symlink():
                entries.append({'path': raw, 'type': 'symlink', 'target': os.readlink(path)})
            elif path.is_file():
                add_file(path, raw)
            elif path.is_dir():
                entries.append({'path': raw, 'type': 'directory'})
                def on_walk_error(error):
                    failed = Path(error.filename) if error.filename else path
                    try:
                        label = failed.relative_to(root).as_posix()
                    except ValueError:
                        label = raw
                    entries.append({'path': label, 'type': 'unavailable'})
                for current, directories, files in os.walk(path, followlinks=False, onerror=on_walk_error):
                    current_path = Path(current)
                    for name in sorted(directories):
                        child = current_path / name
                        if child.is_symlink():
                            add_file(child, child.relative_to(root).as_posix())
                    directories[:] = [name for name in directories if not (current_path / name).is_symlink()]
                    for name in sorted(files):
                        child = current_path / name
                        add_file(child, child.relative_to(root).as_posix())
            else:
                entries.append({'path': raw, 'type': 'missing'})
        except OSError:
            entries.append({'path': raw, 'type': 'unavailable'})
    canonical = json.dumps(entries, sort_keys=True, separators=(',', ':')).encode()
    return hashlib.sha256(canonical).hexdigest(), entries


def dirty_fingerprint(root):
    status, error = run_readonly(['git', '-C', str(root), 'status', '--porcelain', '-z'])
    if error or status is None:
        return {'status': 'unavailable', 'reason': 'git_status_unavailable',
                'fingerprint': None, 'files': [], 'paths': []}
    dirty, parts, index = [], (status or '').split('\0'), 0
    while index < len(parts):
        item = parts[index]
        index += 1
        if not item:
            continue
        dirty.append(item[3:])
        if item[:2].strip() in ('R', 'C') and index < len(parts):
            dirty.append(parts[index])
            index += 1
    digest, files = fingerprint(root, dirty)
    if any(entry.get('type') == 'unavailable' for entry in files):
        return {'status': 'unavailable', 'reason': 'dirty_file_unavailable',
                'fingerprint': None, 'files': files, 'paths': dirty}
    return {'status': 'verified', 'fingerprint': digest, 'files': files, 'paths': dirty}


def manifest(args):
    root = Path(args.root).resolve()
    head, _ = git(root, 'rev-parse', 'HEAD')
    branch, _ = git(root, 'branch', '--show-current')
    dirty_record = dirty_fingerprint(root)
    fp, files = fingerprint(root, args.scope)
    command_fingerprint = hashlib.sha256(json.dumps(args.command, separators=(',', ':')).encode()).hexdigest()
    current_executable = shutil.which(args.command[0]) if args.command else None
    current_executable = current_executable or (args.command[0] if args.command else None)
    try:
        current_executable_hash = hashlib.sha256(Path(current_executable).read_bytes()).hexdigest()
    except (OSError, TypeError):
        current_executable_hash = None
    current_collector_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    comparable = {'scopeFingerprint': fp, 'runtime': args.runtime, 'command': sanitized_argv(args.command),
                  'commandFingerprint': command_fingerprint, 'executableSha256': current_executable_hash,
                  'collectorSha256': current_collector_hash, 'selectors': args.selector}
    invalid_scope = [entry for entry in files if entry.get('type') in
                     ('missing', 'outside_repository', 'unavailable', 'symlink', 'symlink_ancestor')]
    reuse = {'evidenceValid': False, 'reason': 'no_comparison_run'}
    if args.compare_run and not invalid_scope and files:
        try:
            previous = json.loads(Path(args.compare_run).read_text(encoding='utf-8'))
            prior_entries = previous.get('scopeBefore') if isinstance(previous, dict) else None
            prior_after = previous.get('scopeAfter') if isinstance(previous, dict) else None
            valid_run = (isinstance(previous, dict) and previous.get('schemaVersion') == SCHEMA_VERSION and previous.get('kind') == 'run'
                         and previous.get('status') == 'verified'
                         and _valid_timestamp(previous.get('capturedAt'))
                         and previous.get('commandFingerprint') and previous.get('collectorSha256')
                         and previous.get('scopeFingerprintBefore')
                         and previous.get('scopeFingerprintBefore') == previous.get('scopeFingerprintAfter')
                         and previous.get('exitCode') == 0 and previous.get('timedOut') is False
                         and isinstance(previous.get('collectorRuntime'), dict)
                         and isinstance(previous.get('dirtyPreservationBefore'), dict)
                         and isinstance(previous.get('dirtyPreservationAfter'), dict)
                         and previous.get('dirtyPreservationBefore', {}).get('status') == 'verified'
                         and previous.get('dirtyPreservationAfter', {}).get('status') == 'verified'
                         and previous.get('dirtyPreservationBefore', {}).get('fingerprint') ==
                             previous.get('dirtyPreservationAfter', {}).get('fingerprint')
                         and _valid_scope_entries(prior_entries) and _valid_scope_entries(prior_after))
            prior_matches = bool(valid_run and previous.get('scopeFingerprintAfter') == fp
                             and previous.get('commandFingerprint') == comparable['commandFingerprint']
                             and previous.get('executableSha256') == comparable['executableSha256']
                             and previous.get('collectorSha256') == comparable['collectorSha256']
                             and previous.get('selectors') == comparable['selectors']
                             and previous.get('runtime') == comparable['runtime']
                             and previous.get('implementationSha') == args.implementation_sha)
            reusable = bool(valid_run and prior_matches)
            reuse = {'evidenceValid': valid_run, 'reusable': reusable,
                     'reason': None if reusable else 'run_record_or_relevant_inputs_mismatch',
                     'headMayDiffer': reusable, 'currentInputs': comparable,
                     'previousRunKind': previous.get('kind') if isinstance(previous, dict) else None,
                     'previousRunStatus': previous.get('status') if isinstance(previous, dict) else None,
                     'provenance': 'collector_record_type; not cryptographic attestation'}
        except (OSError, ValueError):
            reuse = {'evidenceValid': False, 'reusable': False,
                     'reason': 'comparison_run_unreadable_or_not_a_run_record'}
    execution_evidence = ({'status': 'verified', 'recordKind': 'run', 'reusable': reuse.get('reusable', False)}
                          if reuse.get('evidenceValid') else {'status': 'unavailable', 'reason': 'no_successful_run_record'})
    scope_status = ('unavailable' if invalid_scope or not files or
                    dirty_record.get('status') != 'verified' else 'verified')
    emit(envelope('manifest', scope_status, repository=str(root), branch=branch, head=head,
                  implementationSha=args.implementation_sha, scopeFingerprint=fp,
                  claims={'scopeSnapshot': scope_status, 'executionEvidence': execution_evidence},
                  scope=files, invalidScope=invalid_scope, dirtyPreservation=dirty_record,
                  command=sanitized_argv(args.command), commandFingerprint=command_fingerprint,
                  executableSha256=current_executable_hash, collectorSha256=current_collector_hash,
                  selectors=args.selector, runtime=args.runtime,
                  evidencePaths=args.evidence, reuse=reuse))
    return 0 if scope_status == 'verified' else 2


def _valid_timestamp(value):
    if not isinstance(value, str):
        return False
    try:
        datetime.fromisoformat(value.replace('Z', '+00:00'))
        return True
    except ValueError:
        return False


def _valid_scope_entries(entries):
    return (isinstance(entries, list) and bool(entries) and
            all(isinstance(item, dict) and item.get('type') not in
                ('missing', 'outside_repository', 'unavailable', 'symlink', 'symlink_ancestor') for item in entries))


def write_exclusive(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as handle:
        handle.write(data)


def sanitized_argv(argv):
    output = []
    hide_next = False
    secret_names = ('token', 'secret', 'password', 'cookie', 'credential', 'api-key', 'api_key',
                    'apikey', 'auth')
    for index, arg in enumerate(argv):
        if hide_next:
            output.append('[redacted]')
            hide_next = False
            continue
        sensitive_arg = re.search(r'(?i)(?:[A-Za-z_]*)(?:token|secret|password|cookie|credential|api[_-]?key)\s*[=:]\s*\S+', arg)
        auth_header = re.search(r'(?i)authorization\s*:\s*(?:bearer|basic)\s+\S+', arg)
        if sensitive_arg or auth_header:
            output.append(re.sub(r'(?i)((?:[A-Za-z_]*)(?:token|secret|password|cookie|credential|api[_-]?key))\s*[=:]\s*\S+',
                                 r'\1=[redacted]', arg))
            if auth_header:
                output[-1] = re.sub(r'(?i)(authorization\s*:\s*)(?:bearer|basic)\s+\S+',
                                    r'\1[redacted]', output[-1])
            continue
        if any(arg.lower().startswith('-' + name) or arg.lower().startswith('--' + name)
               for name in secret_names):
            if '=' in arg:
                output.append(arg.split('=', 1)[0] + '=[redacted]')
            else:
                output.append(arg)
                hide_next = True
            continue
        if arg in ('-c', '-e'):
            output.extend(argv[index:index + 1])
            output.append('[inline code omitted]')
            break
        if '://' in arg:
            try:
                parsed = urllib.parse.urlsplit(arg)
                if parsed.scheme and parsed.netloc:
                    host = parsed.hostname or ''
                    if parsed.port:
                        host += f':{parsed.port}'
                    arg = urllib.parse.urlunsplit((parsed.scheme, host, parsed.path,
                                                   '[query omitted]' if parsed.query else '', ''))
            except ValueError:
                arg = '[url omitted]'
        output.append(arg)
    return output


def capture(args):
    root = Path(args.root).resolve()
    output = Path(args.output).resolve()
    if output.exists():
        emit(envelope('run', 'mismatch', reason='output_exists', output=str(output)))
        return 2
    if output == root or root in output.parents:
        emit(envelope('run', 'mismatch', reason='artifact_must_be_outside_repository'))
        return 2
    if not args.argv:
        emit(envelope('run', 'unavailable', reason='command_not_supplied'))
        return 2
    if not isinstance(args.runtime, str) or not args.runtime.strip():
        emit(envelope('run', 'unavailable', reason='runtime_not_declared'))
        return 2
    before, before_files = fingerprint(root, args.scope)
    invalid = [entry for entry in before_files if entry['type'] in
               ('missing', 'outside_repository', 'unavailable', 'symlink', 'symlink_ancestor')]
    if invalid:
        emit(envelope('run', 'unavailable', reason='declared_scope_unavailable', invalidScope=invalid))
        return 2
    preservation_before = dirty_fingerprint(root)
    if preservation_before.get('status') != 'verified':
        emit(envelope('run', 'unavailable', reason='dirty_preservation_unavailable',
                      dirtyPreservation=preservation_before))
        return 2
    collector_hash = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    resolved_executable = shutil.which(args.argv[0]) or args.argv[0]
    executable_hash = None
    try:
        executable_hash = hashlib.sha256(Path(resolved_executable).read_bytes()).hexdigest()
    except OSError:
        pass
    start = time.monotonic()
    try:
        run_argv = [resolved_executable, *args.argv[1:]]
        result = subprocess.run(run_argv, cwd=root, capture_output=True, text=True,
                                timeout=args.timeout, check=False)
        code, timed_out = result.returncode, False
    except subprocess.TimeoutExpired:
        code, timed_out = None, True
    except OSError:
        code, timed_out = None, False
    after, after_files = fingerprint(root, args.scope)
    preservation_after = dirty_fingerprint(root)
    if preservation_after.get('status') != 'verified':
        preservation_changed = None
    else:
        preservation_changed = preservation_before['fingerprint'] != preservation_after['fingerprint']
    status = ('unavailable' if timed_out or code is None or preservation_changed is None else
              ('verified' if code == 0 and before == after and not preservation_changed else 'mismatch'))
    record = envelope('run', status, repository=str(root), implementationSha=args.implementation_sha,
                      head=git(root, 'rev-parse', 'HEAD')[0], command=sanitized_argv(args.argv),
                      commandFingerprint=hashlib.sha256(json.dumps(args.argv, separators=(',', ':')).encode()).hexdigest(),
                      resolvedExecutable=resolved_executable, executableSha256=executable_hash,
                      collectorSha256=collector_hash,
                      selectors=args.selector, runtime=args.runtime, runtimeDeclared=True, exitCode=code,
                      timedOut=timed_out, elapsedSeconds=round(time.monotonic() - start, 3),
                      collectorRuntime={'pythonVersion': sys.version.split()[0], 'pythonExecutable': sys.executable,
                                        'childExecutable': args.argv[0]},
                      scopeFingerprintBefore=before, scopeFingerprintAfter=after,
                      scopeChanged=before != after, scopeBefore=before_files, scopeAfter=after_files,
                      dirtyPreservationBefore=preservation_before, dirtyPreservationAfter=preservation_after,
                      dirtyPreservationChanged=preservation_changed,
                      declaredScopeOnly=True, rawOutputPersisted=False,
                      limits=['Only declared scope paths are fingerprinted.',
                              'Command output is discarded and is not retained as proof.'])
    try:
        write_exclusive(output, json.dumps(record, sort_keys=True, indent=2) + '\n')
    except FileExistsError:
        emit(envelope('run', 'mismatch', reason='output_exists', output=str(args.output)))
        return 2
    emit(record)
    return 0 if status == 'verified' else 2


def device(args):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:-]*', args.serial):
        emit(envelope('device', 'unavailable', reason='invalid_adb_serial'))
        return 2
    if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+', args.package):
        emit(envelope('device', 'unavailable', reason='invalid_package_identifier', serial=args.serial))
        return 2
    if (not Path(args.apk_path).is_absolute() or
            not re.fullmatch(r'[A-Fa-f0-9]{64}', args.apk_sha256)):
        emit(envelope('device', 'unavailable', reason='invalid_expected_apk_identity', serial=args.serial))
        return 2
    try:
        local_apk_hash = hashlib.sha256(Path(args.apk_path).read_bytes()).hexdigest()
    except OSError:
        local_apk_hash = None
    expected_apk = {'path': args.apk_path, 'sha256': args.apk_sha256,
                    'observedLocalSha256': local_apk_hash, 'package': args.package}
    local_apk_status = ('unavailable' if local_apk_hash is None else
                        ('verified' if local_apk_hash == args.apk_sha256 else 'mismatch'))

    def adb(*cmd):
        out, err = run_readonly(['adb', '-s', args.serial, *cmd])
        return out.strip() if out else None, err
    devices, err = run_readonly(['adb', 'devices', '-l'])
    fields = next((line.split() for line in (devices or '').splitlines()
                   if line.split() and line.split()[0] == args.serial), [])
    identity = {'model': None, 'product': None, 'device': None}
    for part in fields[2:]:
        if ':' in part:
            k, v = part.split(':', 1)
            if k in identity: identity[k] = v
    matches = len(fields) > 1 and fields[1] == 'device'
    matches = matches and identity['model'] == args.expected_model and identity['product'] == args.expected_product and identity['device'] == args.expected_device
    if not matches:
        identity_status = 'mismatch' if fields else 'unavailable'
        status = 'mismatch' if identity_status == 'mismatch' or local_apk_status == 'mismatch' else 'unavailable'
        emit(envelope('device', status, serial=args.serial,
                      expected={'model': args.expected_model, 'product': args.expected_product, 'device': args.expected_device},
                      observed=identity, identityStatus=identity_status,
                      expectedIdentity={'model': args.expected_model, 'product': args.expected_product,
                                        'device': args.expected_device},
                      expectedApk=expected_apk, localApkStatus=local_apk_status,
                      reason='identity_mismatch_or_device_unavailable'))
        return 2
    android_version, _ = adb('shell', 'getprop', 'ro.build.version.release')
    path, _ = adb('shell', 'pm', 'path', args.package)
    dump, _ = adb('shell', 'dumpsys', 'package', args.package)
    package_paths = [line.removeprefix('package:') for line in (path or '').splitlines() if line.startswith('package:')]
    installed_path = next((candidate for candidate in package_paths if candidate.endswith('/base.apk')),
                          package_paths[0] if package_paths else None)
    installed_hash = None
    path_is_safe = bool(installed_path and installed_path.startswith('/') and
                        re.fullmatch(r'/[A-Za-z0-9_./+=-]+', installed_path) and
                        all(part not in ('', '.', '..') for part in installed_path.split('/')[1:]))
    installed_hash_reason = None
    if path_is_safe:
        checksum, checksum_error = adb('shell', 'sha256sum', '--', installed_path)
        if checksum:
            installed_hash = checksum.split()[0]
        else:
            installed_hash_reason = 'installed_apk_hash_unavailable'
    else:
        installed_hash_reason = 'installed_apk_path_unavailable_or_unsafe'
    expected_hash = local_apk_hash
    observed_hash = installed_hash or None
    package_present = bool(dump and re.search(r'(?<![\w.])' + re.escape(args.package) + r'(?![\w.])', dump))
    version_name = re.search(r'\bversionName=([^\s]+)', dump or '')
    version_code = re.search(r'\bversionCode=(\d+)', dump or '')
    status = ('unavailable' if not path_is_safe or not observed_hash or not expected_hash or not package_present else
              ('verified' if observed_hash == args.apk_sha256 == expected_hash else 'mismatch'))
    emit(envelope('device', status, serial=args.serial, identity=identity, androidVersion=android_version,
                  expectedIdentity={'model': args.expected_model, 'product': args.expected_product,
                                    'device': args.expected_device},
                  expectedApk=expected_apk, installedApk={'path': installed_path,
                               'sha256': observed_hash, 'packagePresent': package_present,
                               'hashReason': installed_hash_reason,
                               'versionName': version_name.group(1) if version_name else None,
                               'versionCode': version_code.group(1) if version_code else None},
                  limits=['No APK is pulled, installed, or replaced.']))
    return 0 if status == 'verified' else 2


def tablet_status(args):
    parsed = urllib.parse.urlsplit(args.endpoint)
    if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
        emit(envelope('tablet-status', 'unavailable', reason='endpoint_must_not_include_credentials_or_query'))
        return 2
    url = args.endpoint.rstrip('/') + '/api/karaoke/tablet/status?' + urllib.parse.urlencode({'partyId': args.party_id})
    token = sys.stdin.readline().strip() if args.token_stdin else ''
    if not token:
        emit(envelope('tablet-status', 'unavailable', reason='token_not_supplied_on_stdin'))
        return 2
    request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token,
                                                   'User-Agent': 'closeout-evidence/1'})
    try:
        with urllib.request.build_opener(_NoRedirect()).open(request, timeout=8) as response:
            data = json.loads(response.read().decode('utf-8'))
    except (OSError, ValueError, urllib.error.URLError, TimeoutError):
        emit(envelope('tablet-status', 'unavailable', reason='request_failed'))
        return 2
    party = data.get('party') if isinstance(data, dict) else None
    controller = data.get('controller') if isinstance(data, dict) else None
    if not isinstance(party, dict) or not isinstance(controller, dict):
        emit(envelope('tablet-status', 'unavailable', reason='response_shape_unavailable'))
        return 2
    state = controller.get('state') if isinstance(controller.get('state'), dict) else {}
    queue = data.get('queue') if isinstance(data, dict) and isinstance(data.get('queue'), list) else []
    playing = next((item for item in queue if isinstance(item, dict) and item.get('status') == 'playing'), None)
    selected_video = None
    if isinstance(playing, dict) and isinstance(playing.get('song'), dict):
        selected_video = playing['song'].get('youtubeId')
    observed = state.get('observedAt')
    age = None
    if isinstance(observed, str):
        try:
            age = (datetime.now(timezone.utc) - datetime.fromisoformat(observed.replace('Z', '+00:00'))).total_seconds()
        except (ValueError, TypeError):
            pass
    fresh = age is not None and 0 <= age <= 90
    connected = controller.get('connected') is True and controller.get('connectionState') == 'connected'
    party_matches = party.get('id') == args.party_id
    reported_video = state.get('videoId')
    playing_state = str(state.get('playerState', '')).lower() == 'playing'
    converged = bool(fresh and party_matches and connected and selected_video and
                     reported_video == selected_video and playing_state)
    status = ('unavailable' if not fresh or not selected_video or not party_matches else
              ('verified' if converged else 'mismatch'))
    emit(envelope('tablet-status', status,
                  party={'id': party.get('id'), 'status': party.get('status'), 'expiresAt': party.get('expiresAt')},
                  controller={'connected': controller.get('connected'), 'connectionState': controller.get('connectionState'),
                              'device': ({key: controller['device'].get(key) for key in ('id', 'name', 'lastSeenAt')
                                         if key in controller['device']} if isinstance(controller.get('device'), dict) else None),
                              'state': {key: state.get(key) for key in ('playerState', 'videoId', 'observedAt') if key in state}},
                  observationAgeSeconds=round(age, 3) if age is not None else None,
                  freshness='fresh' if fresh else 'stale_or_unknown',
                  convergence={'status': 'verified' if converged else 'mismatch' if fresh and selected_video else 'unavailable',
                               'selectedQueueId': playing.get('id') if isinstance(playing, dict) else None,
                               'selectedVideoId': selected_video, 'reportedVideoId': reported_video,
                               'reportedPlaying': playing_state, 'controllerConnected': connected,
                               'partyMatchesRequestedId': party_matches},
                  limits=['Party code and authorization token are never emitted.',
                          'Controller state is server-reported evidence, not physical-TV proof.']))
    return 0 if status == 'verified' else 2


def handoff(args):
    try:
        records = []
        for path in args.record:
            record = json.loads(Path(path).read_text(encoding='utf-8'))
            if not isinstance(record, dict):
                raise ValueError('record must be an object')
            record['_evidencePath'] = str(Path(path).resolve())
            records.append(record)
    except (OSError, ValueError):
        emit(envelope('handoff', 'unavailable', reason='record_unreadable'))
        return 2

    def valid_evidence_record(record):
        if not isinstance(record, dict) or record.get('schemaVersion') != SCHEMA_VERSION or record.get('kind') not in (
                'release', 'run', 'device', 'tablet-status'):
            return False
        if record.get('status') != 'verified' or not _valid_timestamp(record.get('capturedAt')):
            return False
        if record.get('kind') == 'run':
            return bool(record.get('commandFingerprint') and record.get('collectorSha256') and
                        record.get('implementationSha') == args.implementation_sha and
                        record.get('executableSha256') and isinstance(record.get('command'), list) and
                        record.get('runtimeDeclared') is True and isinstance(record.get('runtime'), str) and
                        record.get('scopeFingerprintBefore') and
                        record.get('scopeFingerprintBefore') == record.get('scopeFingerprintAfter') and
                        record.get('exitCode') == 0 and record.get('timedOut') is False and
                        isinstance(record.get('collectorRuntime'), dict) and
                        _valid_scope_entries(record.get('scopeBefore')) and
                        _valid_scope_entries(record.get('scopeAfter')) and
                        isinstance(record.get('dirtyPreservationBefore'), dict) and
                        isinstance(record.get('dirtyPreservationAfter'), dict) and
                        record.get('dirtyPreservationBefore', {}).get('status') == 'verified' and
                        record.get('dirtyPreservationAfter', {}).get('status') == 'verified' and
                        record.get('dirtyPreservationBefore', {}).get('fingerprint') ==
                            record.get('dirtyPreservationAfter', {}).get('fingerprint'))
        if record.get('kind') == 'release':
            retained = record.get('retainedVolume') if isinstance(record.get('retainedVolume'), dict) else {}
            mount = retained.get('mount') if isinstance(retained.get('mount'), dict) else {}
            endpoint = record.get('endpoint') if isinstance(record.get('endpoint'), dict) else {}
            app = record.get('app') if isinstance(record.get('app'), dict) else {}
            expected_volume = retained.get('expectedName')
            latest = record.get('latestFinishedDeployment') if isinstance(record.get('latestFinishedDeployment'), dict) else {}
            phase = record.get('latestDeploymentPhase') if isinstance(record.get('latestDeploymentPhase'), dict) else {}
            container = record.get('container') if isinstance(record.get('container'), dict) else {}
            return bool(record.get('callerApp') and record.get('expectedProductSha') and
                        record.get('expectedProductSha') == args.implementation_sha and
                        re.fullmatch(r'[A-Fa-f0-9]{7,64}', str(record.get('expectedProductSha'))) and
                        record.get('observedProductSha') == record.get('expectedProductSha') and
                        record.get('appRead') == 'verified' and
                        app.get('uuid') == record.get('callerApp') and app.get('status') == 'running:healthy' and
                        phase.get('status') == 'finished' and
                        latest.get('status') == 'finished' and latest.get('commit') == record.get('expectedProductSha') and
                        mount.get('status') == 'verified' and mount.get('actualVolume') == expected_volume and
                        mount.get('volumeType') == 'volume' and mount.get('readWrite') is True and
                        mount.get('running') is True and
                        endpoint.get('status') == 'verified' and
                        isinstance(endpoint.get('httpStatus'), int) and 200 <= endpoint['httpStatus'] < 300 and
                        container.get('name') and container.get('service') and endpoint.get('association') ==
                            'caller_supplied_target_unverified')
        if record.get('kind') == 'device':
            expected = record.get('expectedApk') if isinstance(record.get('expectedApk'), dict) else {}
            installed = record.get('installedApk') if isinstance(record.get('installedApk'), dict) else {}
            identity = record.get('identity') if isinstance(record.get('identity'), dict) else {}
            expected_identity = record.get('expectedIdentity') if isinstance(record.get('expectedIdentity'), dict) else {}
            return bool(record.get('serial') and identity.get('model') and identity.get('product') and
                        identity.get('device') and expected_identity == identity and
                        isinstance(expected.get('path'), str) and Path(expected['path']).is_absolute() and
                        expected.get('package') and expected.get('sha256') and
                        re.fullmatch(r'[A-Fa-f0-9]{64}', str(expected.get('sha256'))) and
                        expected.get('observedLocalSha256') == expected.get('sha256') and
                        installed.get('sha256') == expected.get('sha256') and installed.get('packagePresent') is True and
                        installed.get('path') and installed.get('versionName') is not None and
                        installed.get('versionCode') is not None)
        if record.get('kind') == 'tablet-status':
            convergence = record.get('convergence') if isinstance(record.get('convergence'), dict) else {}
            controller = record.get('controller') if isinstance(record.get('controller'), dict) else {}
            state = controller.get('state') if isinstance(controller.get('state'), dict) else {}
            party = record.get('party') if isinstance(record.get('party'), dict) else {}
            return (record.get('freshness') == 'fresh' and party.get('id') and
                    convergence.get('status') == 'verified' and
                    convergence.get('partyMatchesRequestedId') is True and
                    convergence.get('controllerConnected') is True and
                    convergence.get('reportedPlaying') is True and
                    convergence.get('selectedVideoId') and
                    convergence.get('selectedVideoId') == convergence.get('reportedVideoId') and
                    state.get('videoId') == convergence.get('selectedVideoId') and
                    str(state.get('playerState', '')).lower() == 'playing')
        return True

    def sanitized(value):
        forbidden = ('token', 'secret', 'password', 'cookie', 'credential', 'join_code', 'joincode',
                     'api_key', 'apikey', 'authorization')
        if isinstance(value, dict):
            return {key: ('[redacted]' if key.lower() == 'code' or
                          (key != 'authorizationGrantedByRecord' and
                           any(word in key.lower() for word in forbidden)) else sanitized(item))
                    for key, item in value.items()}
        if isinstance(value, list): return [sanitized(item) for item in value]
        if isinstance(value, str):
            value = re.sub(r'(?i)\bbearer\s+[^\s,;]+', 'Bearer [redacted]', value)
            value = re.sub(r'(?i)(token|secret|password|cookie|credential|api[_-]?key)=([^\s&]+)', r'\1=[redacted]', value)
            value = re.sub(r'(?i)authorization\s*:\s*(?:basic|bearer)\s+[^\s,;]+', 'Authorization: [redacted]', value)
        return value
    proof_records = [record for record in records if record.get('kind') in ('release', 'run', 'device', 'tablet-status')]
    valid_records = [record for record in proof_records if valid_evidence_record(record)]
    by_kind = {kind: next((record for record in records if record.get('kind') == kind), None)
               for kind in ('release', 'device', 'tablet-status')}
    domains = {kind: ('verified' if valid_evidence_record(record) else
                      ('mismatch' if record and record.get('schemaVersion') == SCHEMA_VERSION and
                       record.get('kind') == kind and _valid_timestamp(record.get('capturedAt')) and
                       record.get('status') == 'mismatch' else 'unavailable'))
               for kind, record in by_kind.items()}
    has_mismatch = any(record.get('schemaVersion') == SCHEMA_VERSION and
                       record.get('kind') in ('release', 'run', 'device', 'tablet-status') and
                       _valid_timestamp(record.get('capturedAt')) and record.get('status') == 'mismatch'
                       for record in proof_records)
    evidence_status = ('mismatch' if has_mismatch else
                       ('verified' if valid_records and len(valid_records) == len(proof_records) else 'unavailable'))
    # Human TV observations remain required, so an evidence bundle never means full closeout readiness.
    status = 'mismatch' if has_mismatch else 'unavailable'
    output = {'schemaVersion': SCHEMA_VERSION, 'kind': 'handoff', 'status': status,
              'summary': f'Evidence status: {evidence_status}; readiness: {status}; physical proof pending',
              'capturedAt': datetime.now(timezone.utc).isoformat(),
              'implementationSha': args.implementation_sha, 'documentationHead': args.documentation_head,
              'artifactStatus': 'verified', 'evidenceStatus': evidence_status,
              'readiness': {'status': status, 'requiredDomains': domains, 'physicalProof': 'pending'},
              'records': sanitized(records), 'validatedDiff': sanitized(args.diff), 'tests': sanitized(args.test),
              'recordValidation': {'acceptedEvidenceCount': len(valid_records),
                                   'rejectedRecordCount': len(records) - len(valid_records),
                                   'provenanceLimit': 'schema and collector fields are checked; JSON is not cryptographic attestation'},
              'physicalProof': {'status': 'pending', 'required': ['TV identity', 'playback progression', 'natural completion', 'restart']},
              'approval': sanitized({'source': args.approval_source, 'exactActions': args.approved_action,
                           'targets': args.target, 'effects': args.effect,
                           'exclusions': args.exclusion, 'authorizationGrantedByRecord': False})}
    markdown = render_handoff(output)
    if args.output:
        root, _ = git(Path.cwd(), 'rev-parse', '--show-toplevel')
        target = Path(args.output).resolve()
        if root and (target == Path(root) or Path(root) in target.parents):
            emit(envelope('handoff', 'mismatch', reason='artifact_must_be_outside_repository'))
            return 2
        if target.exists():
            emit(envelope('handoff', 'mismatch', reason='output_exists', output=str(target)))
            return 2
        content = json.dumps(output, sort_keys=True, indent=2) + '\n' if args.format == 'json' else markdown
        try: write_exclusive(target, content)
        except FileExistsError:
            emit(envelope('handoff', 'mismatch', reason='output_exists', output=str(target)))
            return 2
    if args.format == 'json':
        emit(output)
    else:
        print(markdown)
    return 0


def render_handoff(record):
    def bullets(items):
        return '\n'.join(f'- {item}' for item in items) if items else '- None supplied'
    def mapping(value):
        return value if isinstance(value, dict) else {}

    records = record['records']
    release = next((item for item in records if item.get('kind') == 'release'), None)
    device_record = next((item for item in records if item.get('kind') == 'device'), None)
    tablet = next((item for item in records if item.get('kind') == 'tablet-status'), None)
    run = next((item for item in records if item.get('kind') == 'run'), None)
    snapshot = next((item for item in records if item.get('kind') == 'manifest'), None)
    lines = [
        '# Closeout handoff', '',
        f"Evidence status: **{record['evidenceStatus']}**. Readiness: **{record['readiness']['status']}**.", '',
                  f"Captured at: `{record['capturedAt']}`. These are timestamped snapshots; physical proof remains pending.", '',
        f"Implementation SHA: `{record['implementationSha']}`  ",
        f"Documentation checkout HEAD: `{record['documentationHead']}`", '',
        f"Repository: `{(run or snapshot or {}).get('repository', 'not recorded')}`  ",
        f"Branch: `{(run or {}).get('branch') or (snapshot or {}).get('branch') or 'not recorded'}`  ",
        f"Snapshot HEAD: `{(run or snapshot or {}).get('head', 'not recorded')}`", '',
        '## Operator-reported change and test notes', '',
        bullets(record['validatedDiff']), '', bullets(record['tests']), '',
        '## Release and runtime records', '',
    ]
    if release:
        retained = mapping(release.get('retainedVolume'))
        mount = mapping(retained.get('mount'))
        container = mapping(release.get('container'))
        endpoint = mapping(release.get('endpoint'))
        phase = mapping(release.get('latestDeploymentPhase'))
        lines.extend([f"- Release record: **{release.get('status', 'unavailable')}**",
                      f"- Caller app UUID: `{release.get('callerApp', 'unavailable')}`",
                      f"- Expected product SHA: `{release.get('expectedProductSha', 'unavailable')}`",
                      f"- Coolify completed-deployment commit: `{release.get('observedProductSha') or 'unavailable'}`",
                      f"- Latest deployment phase: `{phase.get('status', 'unknown')}`",
                      f"- Container target: `{container.get('name', 'unavailable')}` / "
                      f"`{container.get('service', 'unavailable')}`",
                      f"- Expected retained volume: `{retained.get('expectedName', 'unavailable')}`",
                      f"- Container mount: `{mount.get('actualVolume', 'unavailable')}` at `{mount.get('destination', 'unavailable')}`",
                      f"- Health endpoint: `{endpoint.get('endpoint', 'unavailable')}` (caller-supplied target)"])
    else:
        lines.append('- Release record: unavailable')
    if device_record:
        installed = mapping(device_record.get('installedApk'))
        expected_apk = mapping(device_record.get('expectedApk'))
        lines.extend([f"- Device record: **{device_record.get('status')}** for serial `{device_record.get('serial')}`",
                      f"- Device identity: `{device_record.get('identity')}`",
                      f"- Expected APK: `{expected_apk.get('path', 'unavailable')}` "
                      f"(package `{expected_apk.get('package', 'unavailable')}`)",
                      f"- Installed APK SHA-256: `{installed.get('sha256') or 'unavailable'}`"])
    if tablet:
        conv = mapping(tablet.get('convergence'))
        lines.append(f"- Tablet controller convergence: **{conv.get('status', tablet.get('status'))}**; "
                     f"selected `{conv.get('selectedVideoId') or 'none'}`, reported `{conv.get('reportedVideoId') or 'none'}`")
    else:
        lines.append('- Tablet controller convergence: unavailable')
    if run:
        collector_runtime = mapping(run.get('collectorRuntime'))
        lines.extend(['', '## Captured run evidence', '',
                      f"- Captured at: `{run.get('capturedAt', 'unknown')}`",
                      f"- Command: `{run.get('command')}`",
                      f"- Command fingerprint: `{run.get('commandFingerprint', 'unavailable')}`",
                      f"- Selectors: `{run.get('selectors')}`",
                      f"- Declared runtime: `{run.get('runtime')}`; collector Python: "
                      f"`{collector_runtime.get('pythonVersion', 'unknown')}`",
                      f"- Result: `{run.get('status')}`; exit code `{run.get('exitCode')}`; "
                      f"scope stable `{not run.get('scopeChanged', True)}`",
                      f"- Scope fingerprint: `{run.get('scopeFingerprintAfter', 'unavailable')}`",
                      f"- Evidence record: `{run.get('_evidencePath', 'not recorded')}`"])
    if snapshot:
        lines.extend(['', '## Scoped snapshot', '',
                      f"- Captured at: `{snapshot.get('capturedAt', 'unknown')}`; scope fingerprint "
                      f"`{snapshot.get('scopeFingerprint', 'unavailable')}`",
                      '- Snapshot evidence does not prove a test command ran.'])
    lines.extend(['', '## Required evidence domains', '',
                  bullets([f'{kind}: {value}' for kind, value in record['readiness']['requiredDomains'].items()])])
    lines.extend(['', '## Pending physical proof', '',
                  '- Observe the real tablet/browser UI and record the resulting state.',
                  '- Confirm TV identity and selected video visually.',
                  '- Observe playback progression and natural completion.',
                  '- Verify companion/process restart behavior.', '',
                  '## Approval context', '',
                  f"Source: {record['approval']['source'] or 'not supplied'}", '',
                  'Actions:', bullets(record['approval']['exactActions']), '',
                  'Targets:', bullets(record['approval']['targets']), '',
                  'Expected effects:', bullets(record['approval']['effects']), '',
                  'Exclusions:', bullets(record['approval']['exclusions']), '',
                  'This handoff summarizes approval evidence. It does not grant authorization.', '',
                  '## Evidence record references', '',
                  bullets([f"{item.get('kind', 'unknown')}: {item.get('status', 'unknown')} at "
                           f"{item.get('capturedAt', 'unknown')} — {item.get('_evidencePath', 'path not recorded')}"
                           for item in records])])
    return '\n'.join(lines) + '\n'


def main(argv=None):
    if argv is None:
        argv = sys.argv[1:]
    normalized, index = [], 0
    command_stops = {'--root', '--implementation-sha', '--scope', '--selector', '--runtime',
                     '--compare-run', '--evidence'}
    while index < len(argv):
        if argv[index] == '--command':
            index += 1
            command = []
            while index < len(argv) and argv[index] not in command_stops:
                command.append(argv[index])
                index += 1
            normalized.extend(['--command-json', json.dumps(command)])
        else:
            normalized.append(argv[index])
            index += 1
    parser = argparse.ArgumentParser(prog='python3 -B -m tools.closeout')
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('release'); p.add_argument('--app', required=True); p.add_argument('--product-sha', required=True)
    p.add_argument('--expected-volume', required=True); p.add_argument('--mount-destination', required=True)
    p.add_argument('--endpoint', required=True); p.add_argument('--container'); p.add_argument('--service'); p.add_argument('--docker-context')
    p.set_defaults(func=release)
    p = sub.add_parser('manifest'); p.add_argument('--root', default='.'); p.add_argument('--implementation-sha', required=True)
    p.add_argument('--scope', nargs='+', required=True); p.add_argument('--command-json', dest='command', type=json.loads, required=True)
    p.add_argument('--selector', action='append', default=[]); p.add_argument('--runtime', required=True)
    p.add_argument('--evidence', action='append', default=[]); p.add_argument('--compare-run')
    p.set_defaults(func=manifest)
    p = sub.add_parser('capture-run'); p.add_argument('--root', default='.'); p.add_argument('--implementation-sha', required=True)
    p.add_argument('--scope', nargs='+', required=True); p.add_argument('--selector', action='append', default=[])
    p.add_argument('--runtime', required=True); p.add_argument('--timeout', type=int, default=120)
    p.add_argument('--output', required=True); p.add_argument('argv', nargs=argparse.REMAINDER); p.set_defaults(func=capture)
    p = sub.add_parser('device'); p.add_argument('--serial', required=True); p.add_argument('--expected-model', required=True)
    p.add_argument('--expected-product', required=True); p.add_argument('--expected-device', required=True)
    p.add_argument('--apk-path', required=True); p.add_argument('--apk-sha256', required=True); p.add_argument('--package', required=True)
    p.set_defaults(func=device)
    p = sub.add_parser('tablet-status'); p.add_argument('--endpoint', required=True); p.add_argument('--party-id', required=True)
    p.add_argument('--token-stdin', action='store_true', required=True,
                   help='read ephemeral constrained tablet_admin token from stdin')
    p.set_defaults(func=tablet_status)
    p = sub.add_parser('handoff'); p.add_argument('--implementation-sha', required=True); p.add_argument('--documentation-head', required=True)
    p.add_argument('--record', action='append', default=[]); p.add_argument('--diff', action='append', default=[])
    p.add_argument('--test', action='append', default=[]); p.add_argument('--approval-source', default='')
    p.add_argument('--approved-action', action='append', default=[]); p.add_argument('--target', action='append', default=[])
    p.add_argument('--effect', action='append', default=[]); p.add_argument('--exclusion', action='append', default=[])
    p.add_argument('--output'); p.add_argument('--format', choices=('markdown', 'json'), default='markdown')
    p.set_defaults(func=handoff)
    args = parser.parse_args(normalized)
    if args.action == 'manifest' and not args.command:
        parser.error('--command requires at least one argument')
    if getattr(args, 'argv', None) == ['--']:
        parser.error('capture-run requires an argv after --')
    if getattr(args, 'argv', None) and args.argv[0] == '--': args.argv = args.argv[1:]
    return args.func(args)


if __name__ == '__main__':
    sys.exit(main())
