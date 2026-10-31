"""Resource-side PTY transport. No input/output logging or credential arguments."""
import base64
import fcntl
import json
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

initial = b''
while not initial.endswith(b'\n'):
    chunk = os.read(sys.stdin.fileno(), 1)
    if not chunk:
        raise EOFError('Missing PTY settings')
    initial += chunk
    if len(initial) > 65536:
        raise ValueError('PTY settings exceed size limit')
config = json.loads(initial)
pid, master = pty.fork()
if pid == 0:
    os.chdir(config['cwd'])
    os.execvpe('/bin/bash', ['bash', '--noprofile', '--norc'], config['env'])

def emit(value):
    print(json.dumps(value), flush=True)

def cleanup():
    try:
        os.close(master)
    except OSError:
        pass
    # Interactive jobs can have their own process groups, but share this PTY Session.
    for item in os.listdir('/proc'):
        if not item.isdigit():
            continue
        try:
            if os.getsid(int(item)) == pid:
                os.kill(int(item), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass

emit({'type': 'ready', 'pid': pid})
buffer = b''
try:
    while True:
        ready, _, _ = select.select([master, sys.stdin.buffer], [], [], 1)
        if master in ready:
            try:
                data = os.read(master, 8192)
            except OSError:
                break
            if not data:
                break
            emit({'type': 'output', 'data': base64.b64encode(data).decode()})
        if sys.stdin.buffer in ready:
            data = os.read(sys.stdin.fileno(), 65536)
            if not data:
                break
            buffer += data
            if len(buffer) > 131072:
                raise ValueError('PTY frame exceeds size limit')
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                msg = json.loads(line)
                if msg['type'] == 'close':
                    raise EOFError()
                if msg['type'] == 'input':
                    os.write(master, base64.b64decode(msg['data'], validate=True))
                elif msg['type'] == 'resize':
                    rows = max(8, min(100, int(msg['rows'])))
                    cols = max(20, min(240, int(msg['cols'])))
                    fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack('HHHH', rows, cols, 0, 0))
except (EOFError, BrokenPipeError):
    pass
finally:
    cleanup()
    emit({'type': 'closed', 'pid': pid, 'released': True})
