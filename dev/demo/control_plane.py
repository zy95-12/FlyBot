"""Run the existing panel/API on loopback with a disposable private SQLite database.

No manager, Docker, production environment file or saved credentials are loaded.
"""
from __future__ import annotations

import argparse
import getpass
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid



def check(base, shared=False, workbench=False, serve=False, runtime_args=None):
    import httpx

    with httpx.Client(base_url=base, timeout=10, trust_env=False) as admin:
        assert admin.get('/api/health').status_code == 200
        assert admin.get('/dashboard/console.html').status_code == 200
        login = admin.post('/api/auth/login', json={
            'email': 'admin@example.com', 'password': os.environ['FLYBOT_DEMO_ADMIN_PASSWORD']})
        assert login.status_code == 200
        headers = {'X-CSRF-Token': login.json()['csrf_token']}
        identities = []
        passwords = {}
        for name in ('Alice', 'Bob'):
            invite = admin.post('/api/admin/invitations', headers=headers,
                                json={'email': f'{name.lower()}@example.com'})
            assert invite.status_code == 200
            passwords[name] = getpass.getpass(f'{name} demo password (12+ characters): ') if serve else secrets.token_urlsafe(24)
            if len(passwords[name]) < 12:
                raise ValueError('Demo passwords need at least 12 characters')
            with httpx.Client(base_url=base, timeout=10, trust_env=False) as member:
                registered = member.post('/api/auth/register', json={
                    'token': invite.json()['token'], 'display_name': name,
                    'password': passwords[name]})
                assert registered.status_code == 200
                session = member.get('/api/auth/session')
                assert session.status_code == 200
                identities.append(session.json()['user']['id'])
                assert member.get('/api/admin/users').status_code == 403
                assert member.get('/api/instance').json()['enabled'] is False
        assert len(set(identities)) == 2
        assert admin.post('/api/admin/invitations', json={
            'email': 'no-csrf@example.com'}).status_code == 403
    with httpx.Client(base_url=base, timeout=10, trust_env=False) as anonymous:
        assert anonymous.get('/api/admin/users').status_code == 401
    if shared:
        credentials = {'origin': base, 'ownerSubject': identities[0], 'bobId': identities[1],
                       'alicePassword': passwords['Alice'], 'bobPassword': passwords['Bob'],
                       'adminPassword': os.environ['FLYBOT_DEMO_ADMIN_PASSWORD']}
        command = ['node', str(Path(__file__).with_name('run.mjs')), '--shared']
        command += ['--workbench-serve'] if serve else ['--workbench'] if workbench else []
        command += runtime_args or []
        if serve:
            result = subprocess.run(command, input=json.dumps(credentials), text=True)
            if result.returncode:
                raise RuntimeError('Shared demo stopped with an error')
            return {'demo': 'stopped and cleaned'}
        result = subprocess.run(command,
                                input=json.dumps(credentials), capture_output=True, text=True, timeout=140)
        if result.returncode:
            raise RuntimeError('Shared runtime check failed: ' + result.stderr[-6000:])
        return json.loads(result.stdout)
    return {'panel_http': 'pass', 'invite_register_two_users': 'pass',
            'distinct_sessions': 'pass', 'admin_and_csrf_gates': 'pass',
            'runtime_manager': 'disabled', 'shared_project': 'not implemented (M1/M2)'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serve-workbench', action='store_true', help='Serve a disposable two-account Project demo; ask passwords privately')
    parser.add_argument('--real-model', action='store_true', help='Use explicit model environment with --serve-workbench')
    parser.add_argument('--github-repo', help='Explicit fork repository for draft delivery artifacts')
    parser.add_argument('--github-config-dir', type=Path, help='Explicit absolute gh credential directory for Project automation')
    parser.add_argument('--workbench-check', action='store_true', help='Run actual two-account browser acceptance through the restricted gateway')
    parser.add_argument('--shared-check', action='store_true', help='Run platform and actual DSH shared-project checks')
    parser.add_argument('--check', action='store_true', help='Run real HTTP checks and exit')
    parser.add_argument('--port', type=int, default=18088, help='Loopback port; 0 allocates a free port')
    parser.add_argument('--control-plane', type=Path, required=True, help='Existing unmodified control-plane checkout')
    args = parser.parse_args()
    if args.real_model and not args.serve_workbench:
        parser.error('--real-model requires --serve-workbench')
    if bool(args.github_repo) != bool(args.github_config_dir) or args.github_repo and not args.serve_workbench:
        parser.error('GitHub requires --serve-workbench, --github-repo and --github-config-dir together')
    if args.real_model and (not os.environ.get('DEEPSEEK_API_KEY') or not os.environ.get('DEEPSEEK_BASE_URL')):
        parser.error('--real-model requires explicit DEEPSEEK_API_KEY and DEEPSEEK_BASE_URL environment configuration')
    runtime_args = ['--real-model'] if args.real_model else []
    if args.github_repo:
        if not args.github_config_dir.is_absolute():
            parser.error('--github-config-dir must be absolute')
        runtime_args += ['--github-repo', args.github_repo, '--github-config-dir', str(args.github_config_dir)]
    checkout = args.control_plane.resolve()
    if not (checkout / 'control_plane/app/main.py').is_file():
        parser.error('Expected a control-plane checkout containing control_plane/app/main.py')
    if not __debug__:
        parser.error('Run checks without Python optimization')
    sys.dont_write_bytecode = True
    sys.path.insert(0, str(checkout / 'control_plane'))
    password = secrets.token_urlsafe(32) if args.check or args.shared_check or args.workbench_check or args.serve_workbench else (
        os.environ.get('FLYBOT_DEMO_ADMIN_PASSWORD') or getpass.getpass('Temporary admin password (12+ characters): '))
    if len(password) < 12:
        parser.error('Admin password needs at least 12 characters')
    with tempfile.TemporaryDirectory(prefix='flybot-control-demo-') as directory:
        # Override inherited production settings before importing any app module.
        os.environ.update(APP_SECRET=secrets.token_urlsafe(48),
                          DATABASE_URL='sqlite:///' + str(Path(directory) / 'control.sqlite3'),
                          AUTO_CREATE_SCHEMA='true', COOKIE_SECURE='false',
                          RUNTIME_MANAGEMENT_ENABLED='false', PLATFORM_DOMAIN='demo.invalid',
                          FLYBOT_DEMO_ADMIN_PASSWORD=password)
        from app.main import app
        from app.models import User
        from app.security import hash_password
        from app.store import SessionLocal, initialize, engine
        import uvicorn

        initialize()
        with SessionLocal() as db:
            db.add(User(id=str(uuid.uuid4()), email='admin@example.com', display_name='Demo Admin',
                        password_hash=hash_password(password), role='admin', status='active'))
            db.commit()
        sock = socket.socket()
        sock.bind(('127.0.0.1', args.port))
        server = uvicorn.Server(uvicorn.Config(app, log_level='error', access_log=False))
        thread = threading.Thread(target=server.run, kwargs={'sockets': [sock]}, daemon=True)
        thread.start()
        try:
            deadline = time.monotonic() + 15
            while not server.started:
                if not thread.is_alive() or time.monotonic() > deadline:
                    raise RuntimeError('Demo API failed to start')
                time.sleep(0.05)
            base = f'http://127.0.0.1:{sock.getsockname()[1]}'
            if args.check or args.shared_check or args.workbench_check or args.serve_workbench:
                print(json.dumps(check(base, args.shared_check or args.workbench_check or args.serve_workbench, args.workbench_check, args.serve_workbench, runtime_args), indent=2))
            else:
                print(f'Panel: {base}/dashboard/console.html\nAccount: admin@example.com\nTemporary data is deleted on exit.', flush=True)
                while thread.is_alive():
                    thread.join(0.5)
        except KeyboardInterrupt:
            pass  # Ctrl-C stops only this disposable server.
        finally:
            server.should_exit = True
            thread.join(10)
            sock.close()
            engine.dispose()


if __name__ == '__main__':
    main()
