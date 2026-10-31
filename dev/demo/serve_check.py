import os, pty, select, signal, subprocess, time, secrets, re, tempfile, json, urllib.request
from pathlib import Path
import argparse, sys
parser=argparse.ArgumentParser()
parser.add_argument('--control-plane',type=Path,required=True)
parser.add_argument('--early-stop',action='store_true')
args=parser.parse_args()
root=Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='flybot-m6-serve-check-') as directory:
    primary, secondary=pty.openpty()
    env=dict(os.environ,TMPDIR=directory)
    child=subprocess.Popen([sys.executable,str(root/'dev/demo/control_plane.py'),'--control-plane',str(args.control_plane.resolve()),'--serve-workbench','--port','0'],cwd=root,env=env,stdin=secondary,stdout=secondary,stderr=secondary,start_new_session=True)
    os.close(secondary)
    passwords=[secrets.token_urlsafe(24),secrets.token_urlsafe(24)]
    sent=0; buffer=b''; url=None
    try:
        deadline=time.monotonic()+50
        while time.monotonic()<deadline:
            if select.select([primary],[],[],.2)[0]:
                buffer+=os.read(primary,65536)
            if sent<2 and (b'Alice demo password' if sent==0 else b'Bob demo password') in buffer:
                os.write(primary,(passwords[sent]+'\n').encode());sent+=1
            if args.early_stop and sent==2:
                time.sleep(1)
                break
            found=re.search(rb'Shared Project workbench: (http://127\.0\.0\.1:\d+/)',buffer)
            if found: url=found.group(1).decode();break
            assert child.poll() is None,'temporary launcher exited early'
        if not args.early_stop:
            assert url,'temporary launcher did not become ready'
            assert json.load(urllib.request.urlopen(url+'health'))['status']=='ok'
            def call(endpoint,payload={},token=''):
                request=urllib.request.Request(url+'api/bot',data=json.dumps({'endpoint':endpoint,'payload':payload}).encode(),headers={'Content-Type':'application/json','x-flybot-member-session':token})
                return json.load(urllib.request.urlopen(request))
            login=call('platform-login',{'email':'alice@example.com','password':passwords[0]})
            assert login['ok']
            state=call('workbench-state',token=login['value']['sessionToken'])
            assert state['value']['demoMode']=='deterministic-fixture'
            assert 'example/delivery-fixture' in state['value']['repositories']
        os.killpg(child.pid,signal.SIGINT)
        child.wait(timeout=20)
        deadline=time.monotonic()+5
        while any(Path(directory).iterdir()) and time.monotonic()<deadline: time.sleep(.1)
        assert not any(Path(directory).iterdir()),'owned temporary data remained after shutdown'
        print('interactive-' + ('early-stop' if args.early_stop else 'launch-platform-login-stop') + '-cleanup: pass')
    finally:
        if child.poll() is None:
            os.killpg(child.pid,signal.SIGKILL);child.wait()
        os.close(primary)
