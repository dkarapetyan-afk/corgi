#!/usr/bin/env python3
"""Real PTY/socket regressions. Provider doubles never make inference requests."""
import fcntl
import base64
import json
import os
import pathlib
import re
import select
import shlex
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
EXE = str(ROOT / 'zig-out/bin/wrangler')

FAKE = r'''#!/usr/bin/env python3
import sys, json
if '--version' in sys.argv:
    print('codex-cli 1.2.3-fixture');sys.exit(0)
claude = '--print' in sys.argv
def emit(x): print(json.dumps(x), flush=True)
for line in sys.stdin:
    v = json.loads(line)
    if v.get('method') == 'initialize': emit({'id': v['id'], 'result': {'version':'fixture'}})
    elif v.get('method') == 'initialized': emit({'method':'ready'})
    elif v.get('method') == 'test/approval':
        emit({'type':'control_request','request_id':'permission-1','request':{'subtype':'can_use_tool','tool_name':'Bash'}} if claude else {'id':900,'method':'item/commandExecution/requestApproval','params':{'threadId':'t'}})
    elif v.get('method') == 'test/flood':
        for i in range(150): emit({'type':'fixture','n':i})
    elif v.get('id') == 900 or v.get('type') == 'control_response':
        emit({'type':'result','result':'complete'} if claude else {'method':'turn/completed','params':{'threadId':'t'}})
    elif v.get('method') == 'test/exit': sys.exit(0)
    elif 'id' in v: emit({'id':v['id'],'result':{'echo':v}})
'''

def screen_text(data, cols=80, rows=24):
    """Decode frame cursor moves so tests click what the user actually sees."""
    grid=[[' ']*cols for _ in range(rows)]
    x=y=0;i=0
    while i<len(data):
        if data[i]=='\x1b':
            match=re.match(r'\x1b\[([0-9;?]*)([@-~])',data[i:])
            if not match:raise AssertionError('unexpected frame escape')
            args,kind=match.groups()
            if kind in ('H','f'):
                values=[int(v or 1) for v in args.split(';')]
                y=values[0]-1;x=(values[1] if len(values)>1 else 1)-1
            elif kind=='J' and args=='2':grid=[[' ']*cols for _ in range(rows)]
            i+=len(match.group());continue
        if data[i]=='\r':x=0
        elif data[i]=='\n':y+=1
        elif data[i]>=' ':
            if 0<=x<cols and 0<=y<rows:grid[y][x]=data[i]
            x+=1
        i+=1
    return [''.join(row) for row in grid]

class Runtime(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='wrangler-test-')
        self.path = self.temp.name + '/control.sock'
        fake = pathlib.Path(self.temp.name, 'provider'); fake.write_text(FAKE); fake.chmod(0o700)
        self.env = {**os.environ, 'WRANGLER_SOCKET':self.path, 'WRANGLER_BELL':'off', 'WRANGLER_CODEX_BIN':str(fake), 'WRANGLER_CLAUDE_BIN':str(fake), 'SHELL':'/bin/sh'}
        self.client = None
        self.client_file = None
        self.proc = None
        self.run_cli('start')
    def tearDown(self):
        if self.client_file: self.client_file.close()
        if self.client: self.client.close()
        if self.proc:
            self.proc.terminate()
            try: self.proc.wait(timeout=3)
            except subprocess.TimeoutExpired: self.proc.kill(); self.proc.wait()
            os.close(self.master)
        try: self.run_cli('shutdown')
        finally:
            time.sleep(.04)
            log=pathlib.Path(self.temp.name,'server.log').read_text()
            self.assertNotIn('panic:',log)
            self.temp.cleanup()
    def run_cli(self,*args):
        p=subprocess.run([EXE,*args],env=self.env,capture_output=True,text=True,timeout=8)
        self.assertEqual(p.returncode,0,(args,p.stderr,p.stdout))
        return p.stdout
    def rpc(self,**v): return json.loads(self.run_cli('rpc',json.dumps(v)))
    def until(self,predicate,timeout=4):
        end=time.monotonic()+timeout
        while time.monotonic()<end:
            value=predicate()
            if value: return value
            time.sleep(.03)
        self.fail('condition timed out')
    def panes(self): return self.rpc(op='list')['panes']
    def attach(self):
        self.client=socket.socket(socket.AF_UNIX);self.client.connect(self.path);self.client.settimeout(3)
        self.client_file=self.client.makefile('rb')
        self.write(op='attach',cols=80,rows=24,cwd=self.temp.name)
        self.assertEqual(self.message()['type'],'attached')
    def write(self,**v): self.client.sendall(json.dumps(v).encode()+b'\n')
    def message(self): return json.loads(self.client_file.readline())
    def get_type(self,kind):
        for _ in range(100):
            m=self.message()
            if m.get('type')==kind:return m
        self.fail('missing message '+kind)
    def input(self,text): self.write(op='input',data=text)
    def click(self,x,y):self.input(f'\x1b[<0;{x};{y}M\x1b[<0;{x};{y}m')
    def frame_with(self,text,cols=80,rows=24):
        for _ in range(100):
            screen=screen_text(self.get_type('frame')['data'],cols,rows)
            if any(text in row for row in screen):return screen
        self.fail('missing visible text '+text)
    def click_text(self,screen,text):
        for y,row in enumerate(screen):
            if text in row:
                self.click(row.index(text)+1,y+1);return
        self.fail('missing mouse target '+text)
    def right_click_tab(self,screen,title):
        x=screen[0].index(title)+1
        self.input(f'\x1b[<2;{x};1M\x1b[<2;{x};1m')
    def test_tab_context_menu_targets_clicked_tab_for_rename_and_new(self):
        one=pathlib.Path(self.temp.name,'one');one.mkdir()
        two=pathlib.Path(self.temp.name,'two');two.mkdir()
        first=self.rpc(op='new',cwd=str(one),title='One')['pane']
        second=self.rpc(op='new',cwd=str(two),title='Two')['pane']
        self.attach();screen=self.frame_with('2:Two')
        self.right_click_tab(screen,'1:One');menu=self.frame_with('|New tab')
        self.assertTrue(any('|Rename' in row for row in menu))
        self.assertTrue(any('|Close' in row for row in menu))
        self.assertEqual(next(p['id'] for p in self.panes() if p['focused']),second)
        self.input('\x1b[200~touch CONTEXT_LEAK\r\x1b[201~')
        self.click_text(menu,'Rename');self.frame_with('rename tab')
        self.input('First\r');screen=self.frame_with('1:First')
        self.assertEqual(next(p['id'] for p in self.panes() if p['focused']),first)
        self.rpc(op='focus',pane=second)
        self.right_click_tab(screen,'1:First');menu=self.frame_with('|New tab')
        self.click_text(menu,'New tab');self.frame_with('new tab')
        self.assertEqual(self.rpc(op='list')['tabs'],2)
        self.input('\r')
        self.until(lambda:self.rpc(op='list')['tabs']==3)
        self.assertEqual(self.rpc(op='list')['tabs'],3)
        new=next(p for p in self.panes() if p['focused'])
        self.assertTrue(pathlib.Path(new['cwd']).samefile(one))
        self.assertFalse((one/'CONTEXT_LEAK').exists());self.assertFalse((two/'CONTEXT_LEAK').exists())
    def test_tab_context_close_keeps_target_through_focus_and_reorder(self):
        first=self.rpc(op='new',cwd=self.temp.name,title='First')['pane']
        self.rpc(op='split',cwd=self.temp.name,axis='right')
        second=self.rpc(op='new',cwd=self.temp.name,title='Second')['pane']
        self.attach();screen=self.frame_with('2:Second')
        self.right_click_tab(screen,'1:First');menu=self.frame_with('|New tab')
        self.click_text(menu,'Close');confirm=self.frame_with('[ Close ]')
        self.rpc(op='focus',pane=second)
        self.rpc(op='action',name='move-tab',value='left')
        self.click_text(confirm,'[ Close ]')
        self.until(lambda:[p['id'] for p in self.panes()]==[second])
        self.assertEqual(self.rpc(op='list')['closed_panes'],2)
        gone=self.rpc(op='new',cwd=self.temp.name,title='Gone')['pane']
        self.rpc(op='focus',pane=second);screen=self.frame_with('2:Gone')
        self.right_click_tab(screen,'2:Gone');self.frame_with('|New tab')
        self.rpc(op='close',pane=gone)
        # Dismiss when its target disappears, never reuse the neighboring tab.
        for _ in range(100):
            screen=screen_text(self.get_type('frame')['data'])
            if '|New tab' not in '\n'.join(screen) and '2:Gone' not in screen[0]:break
        else:self.fail('stale tab menu')
        self.assertEqual([p['id'] for p in self.panes()],[second])
    def test_tab_context_keyboard_dismissal_and_minimum_size(self):
        self.attach();screen=self.frame_with('1:shell')
        self.right_click_tab(screen,'1:shell');menu=self.frame_with('|New tab')
        self.click(79,23);screen=self.frame_with('^B commands')
        self.assertNotIn('|New tab','\n'.join(screen))
        self.right_click_tab(screen,'1:shell');self.frame_with('|New tab')
        self.input('\x1b');screen=self.frame_with('^B commands')
        self.assertNotIn('|New tab','\n'.join(screen))
        self.write(op='size',cols=10,rows=4)
        screen=self.frame_with('1:shel',10,4)
        self.right_click_tab(screen,'1:shel');menu=self.frame_with('|New tab',10,4)
        self.assertTrue(any('|Rename' in row for row in menu))
        self.assertTrue(any('|Close' in row for row in menu))
        self.input('\x1b[');self.input('B\r')
        self.frame_with('rename t',10,4);self.input('Tiny\r')
        self.frame_with('1:Tiny',10,4)
    def test_prefix_menu_keyboard_mouse_and_no_paste_leak(self):
        self.attach();self.get_type('frame')
        self.input('\x02');menu=self.frame_with('Commands')
        self.assertTrue(any('c  New tab' in row for row in menu))
        self.assertTrue(any('r  Resize panes...' in row for row in menu))
        self.input('\x1b[200~touch MENU_LEAK\r\x1b[201~')
        self.click_text(menu,'New tab')
        self.frame_with('new tab');self.input('\r')
        self.until(lambda:self.rpc(op='list')['tabs']==2)
        self.assertFalse(pathlib.Path(self.temp.name,'MENU_LEAK').exists())
        self.input('\x02');menu=self.frame_with('Commands')
        self.click_text(menu,'Split right')
        self.until(lambda:len(self.panes())==3)
        self.input('\x02');menu=self.frame_with('Commands')
        self.click_text(menu,'Resize panes...')
        menu=self.frame_with('Resize panes')
        self.click_text(menu,'Resize left')
        self.frame_with('Resize panes')
        self.input('\x1b');self.frame_with('^B commands')
        self.input('\x02');menu=self.frame_with('Commands')
        self.click_text(menu,'Close pane...')
        confirm=self.frame_with('[ Close ]')
        self.click_text(confirm,'[ Close ]')
        self.until(lambda:len(self.panes())==2)
        self.input('\x02?');self.frame_with('Commands')
        self.click(1,23);self.frame_with('^B commands')
        self.input("printf '%s%s\\n' MENU_ CLOSED\r")
        pane=next(p for p in self.panes() if p['focused'])['id']
        self.until(lambda:'MENU_CLOSED' in self.run_cli('read',str(pane)))
    def test_plus_creates_tab_and_prefills_editable_name(self):
        self.attach();initial=self.frame_with(' + ')
        self.click_text(initial[:1],' + ')
        prompt=self.frame_with('new tab')
        self.assertEqual(self.rpc(op='list')['tabs'],1)
        title_row=next(i for i,row in enumerate(prompt) if 'new tab' in row)
        self.assertIn(pathlib.Path(self.temp.name).name,prompt[title_row+2])
        self.input('My work\r')
        screen=self.frame_with('2:My work')
        self.assertNotIn('new tab','\n'.join(screen))
        pane=next(p for p in self.panes() if p['focused'])
        self.assertTrue(pathlib.Path(pane['cwd']).samefile(self.temp.name))
        self.click_text(screen[:1],' + ');self.frame_with('new tab')
        self.input('\x1b');screen=self.frame_with('^B commands')
        self.assertEqual(self.rpc(op='list')['tabs'],2)
        self.click_text(screen[:1],' + ');self.frame_with('new tab')
        self.input('\r');screen=self.frame_with('3:'+pathlib.Path(self.temp.name).name[:16])
        self.assertEqual(self.rpc(op='list')['tabs'],3)
    def test_menu_paging_and_plus_remain_usable_in_narrow_terminal(self):
        self.attach();self.get_type('frame')
        self.write(op='size',cols=30,rows=8)
        self.input('\x02');menu=self.frame_with('Commands',30,8)
        self.assertTrue(any('Next >' in row for row in menu))
        self.click_text(menu,'Next >');menu=self.frame_with('Split right',30,8)
        self.click_text(menu,'Split right');self.until(lambda:len(self.panes())==2)
        for i in range(4):self.rpc(op='new',cwd=self.temp.name,title='Long tab name '+str(i))
        screen=self.frame_with('5:Long tab',30,8)
        self.click_text(screen[:1],' + ')
        self.frame_with('new tab',30,8);self.input('\r')
        self.until(lambda:self.rpc(op='list')['tabs']==6)
    def test_name_dialog_mouse_buttons_and_cursor_editing(self):
        self.attach();self.get_type('frame')
        self.input('\x02T');dialog=self.frame_with('rename tab')
        self.assertTrue(any('┌' in row and '┐' in row for row in dialog))
        self.click_text(dialog,'^C clear')
        self.input('ac\x1b[Db');dialog=self.frame_with('│abc')
        self.click_text(dialog,'↵ save');screen=self.frame_with('1:abc')
        self.input('\x02T');dialog=self.frame_with('rename tab')
        self.input('discarded');self.frame_with('│discarded')
        self.click_text(dialog,'esc cancel');screen=self.frame_with('1:abc')
        self.assertNotIn('discarded',screen[0])
        self.input('\x02T');self.frame_with('rename tab')
        self.input('\x03\x1b[200~new\rname\x1b[201~')
        dialog=self.frame_with('│newname')
        self.click_text(dialog,'↵ save');self.frame_with('1:newname')
        self.input('\x02c');dialog=self.frame_with('new tab')
        self.click_text(dialog,'esc cancel');self.frame_with('1:newname')
        self.assertEqual(self.rpc(op='list')['tabs'],1)
        self.assertEqual(self.rpc(op='list')['closed_panes'],0)
    def test_name_dialog_retains_target_and_failed_creation_is_cancelable(self):
        self.attach();self.get_type('frame')
        self.input('\x02T');self.frame_with('rename tab')
        self.rpc(op='new',cwd=self.temp.name,title='Other')
        self.input('Original\r');self.frame_with('1:Original')
        self.assertEqual(self.rpc(op='list')['tabs'],2)
        folder=pathlib.Path(self.temp.name,'removed');folder.mkdir()
        self.rpc(op='new',cwd=str(folder),title='Removed')
        self.input('\x02c');self.frame_with('new tab');folder.rmdir()
        self.input('\r');dialog=self.frame_with('Could not save.')
        self.assertEqual(self.rpc(op='list')['tabs'],3)
        self.click_text(dialog,'esc cancel');self.frame_with('3:Removed')
        self.assertTrue(self.rpc(op='ping')['ok'])
    def test_tab_pane_identity_and_process_survival(self):
        first=self.rpc(op='new',cwd=self.temp.name,command="printf 'PERSIST\\n'; exec /bin/sh")['pane']
        second=self.rpc(op='split',cwd=self.temp.name,axis='right',command="printf 'SECOND\\n'; exec /bin/sh")['pane']
        self.until(lambda:'PERSIST' in self.run_cli('read',str(first)))
        self.rpc(op='action',name='break');self.assertEqual(self.rpc(op='list')['tabs'],2)
        self.rpc(op='action',name='join',value='1');self.assertEqual(self.rpc(op='list')['tabs'],1)
        self.assertEqual([p['id'] for p in self.panes()],[first,second])
        self.rpc(op='close',pane=second);self.assertIn('PERSIST',self.run_cli('read',str(first)))
    def test_shell_exit_removes_split_and_hidden_tab(self):
        first=self.rpc(op='new',cwd=self.temp.name)['pane']
        second=self.rpc(op='split',cwd=self.temp.name,axis='right')['pane']
        self.rpc(op='send',pane=second,text='exit',enter=True)
        self.until(lambda:[p['id'] for p in self.panes()]==[first])
        self.assertTrue(self.panes()[0]['focused']);self.assertEqual(self.rpc(op='list')['tabs'],1)
        third=self.rpc(op='new',cwd=self.temp.name)['pane']
        self.rpc(op='send',pane=first,text='exit',enter=True)
        self.until(lambda:[p['id'] for p in self.panes()]==[third])
        self.assertTrue(self.panes()[0]['focused']);self.assertEqual(self.rpc(op='list')['tabs'],1)
    def test_last_shell_exit_and_keyboard_undo_preserve_output_and_cwd(self):
        self.attach();self.get_type('frame')
        sub=pathlib.Path(self.temp.name,'nested');sub.mkdir()
        self.input('cd nested; printf "SAVED_OUTPUT\\n"\r')
        self.until(lambda:'SAVED_OUTPUT' in self.run_cli('read','1'))
        self.until(lambda:pathlib.Path(self.panes()[0]['cwd']).samefile(sub))
        self.input('exit\r');self.until(lambda:self.rpc(op='list')['tabs']==0)
        while 'No panes.' not in self.get_type('frame')['data']:pass
        self.assertEqual(self.rpc(op='list')['closed_panes'],1)
        # Empty-view actions must not leave a stale rename target.
        self.input('\x02T\r\x02u')
        self.until(lambda:len(self.panes())==1)
        pane=self.panes()[0];self.assertNotEqual(pane['id'],1)
        self.assertFalse(pane['exited']);self.assertEqual(pane['provider'],'other')
        self.assertTrue(pathlib.Path(pane['cwd']).samefile(sub))
        self.assertIn('SAVED_OUTPUT',self.run_cli('read',str(pane['id'])))
        self.assertEqual(self.rpc(op='list')['closed_panes'],0)
        self.input("printf '%s%s\\n' FRESH_ SHELL\r")
        self.until(lambda:'FRESH_SHELL' in self.run_cli('read',str(pane['id'])))
    def test_closed_history_is_bounded_and_does_not_rerun_commands(self):
        for i in range(10):
            self.rpc(op='new',cwd=self.temp.name,title=f'saved-{i}',command=f'printf "FINAL_{i}\\n"; echo ran >> runs; exit 7')
            self.until(lambda:self.rpc(op='list')['tabs']==0)
            self.assertEqual(self.rpc(op='list')['closed_panes'],min(i+1,8))
        self.attach();self.get_type('frame')
        for i in range(9,1,-1):
            self.rpc(op='action',name='undo-close')
            pane=next(p for p in self.panes() if p['focused'])
            self.assertIn(f'FINAL_{i}',self.run_cli('read',str(pane['id'])))
        self.assertEqual(self.rpc(op='list')['closed_panes'],0)
        self.assertEqual(len(pathlib.Path(self.temp.name,'runs').read_text().splitlines()),10)
        self.rpc(op='action',name='undo-close')
        self.assertEqual(len(self.panes()),9)  # The attach shell plus eight restores.
    def test_manual_close_retains_scrollback_and_cancels_stale_modes(self):
        self.attach();self.get_type('frame')
        self.input("printf 'SCROLLBACK_SENTINEL\\n'; i=0; while [ $i -lt 50 ]; do echo line-$i; i=$((i+1)); done\r")
        self.until(lambda:'line-49' in self.run_cli('read','1'))
        self.input('\x02TStored name\r\x02[/missing')
        self.rpc(op='close',pane=1)
        self.input('\x02u')
        self.until(lambda:len(self.panes())==1)
        pane=self.panes()[0]['id']
        self.input('\x02[g')
        self.until(lambda:'SCROLLBACK_SENTINEL' in self.run_cli('read',str(pane)))
        while 'Stored name' not in self.get_type('frame')['data']:pass
        self.input('q')
        self.input("printf '%s%s\\n' LIVE_AFTER_ UNDO\r")
        self.until(lambda:'LIVE_AFTER_UNDO' in self.run_cli('read',str(pane)))
    def test_panes_use_full_height_and_translate_first_row_input(self):
        fixture=pathlib.Path(self.temp.name,'screen.py')
        fixture.write_text('''import os, signal, tty
tty.setraw(0)
def draw(*_):
    cols, rows = os.get_terminal_size(0)
    os.write(1, f'\\x1b[2J\\x1b[HTOP_{rows}x{cols}\\x1b[{rows};1HBOTTOM_{rows}\\x1b[1;2H\\x1b[?1000h\\x1b[?1006h'.encode())
signal.signal(signal.SIGWINCH, draw)
draw()
while True:
    with open('mouse-input', 'ab') as log: log.write(os.read(0, 1024))
''')
        command=f'exec {shlex.quote(sys.executable)} {shlex.quote(str(fixture))}'
        first=self.rpc(op='new',cwd=self.temp.name,command=command)['pane']
        self.attach()
        screen=self.frame_with('BOTTOM_22')
        self.assertTrue(screen[1][28:].startswith('TOP_22x52'))
        self.assertTrue(screen[22][28:].startswith('BOTTOM_22'))
        self.rpc(op='hook',pane=first,provider='codex',seq=1,event={'hook_event_name':'SessionStart','session_id':'geometry'})
        frame=self.get_type('frame')['data']
        while 'codex idle' not in frame: frame=self.get_type('frame')['data']
        self.assertIn('\x1b[2;30H\x1b[?25h',frame)
        self.assertIn('codex idle',screen_text(frame)[23])
        self.click(31,2);self.click(31,23)
        log=pathlib.Path(self.temp.name,'mouse-input')
        expected=b'\x1b[<0;3;1M\x1b[<0;3;1m\x1b[<0;3;22M\x1b[<0;3;22m'
        self.until(lambda:log.exists() and log.read_bytes()==expected)
        # Shift-drag the first terminal row while the app has mouse reporting enabled.
        self.input('\x1b[<4;29;2M\x1b[<36;31;2M\x1b[<4;31;2m')
        frame=self.get_type('frame')['data']
        while not frame.startswith('\x1b]52;c;'): frame=self.get_type('frame')['data']
        self.assertEqual(base64.b64decode(frame[7:-1]),b'TOP')
        self.rpc(op='split',cwd=self.temp.name,axis='down',command=command)
        screen=self.frame_with('BOTTOM_11')
        while not screen[1][28:].startswith('TOP_10x52'): screen=self.frame_with('BOTTOM_11')
        self.assertTrue(screen[10][28:].startswith('BOTTOM_10'))
        self.assertTrue(screen[12][28:].startswith('TOP_11x52'))
        self.assertTrue(screen[22][28:].startswith('BOTTOM_11'))
        self.rpc(op='action',name='zoom')
        screen=self.frame_with('TOP_22x52')
        self.assertTrue(screen[1][28:].startswith('TOP_22x52'))
        self.assertTrue(screen[22][28:].startswith('BOTTOM_22'))
        self.input('\x02b')
        screen=self.frame_with('TOP_22x80')
        self.assertTrue(screen[1].startswith('TOP_22x80'))
        self.assertTrue(screen[22].startswith('BOTTOM_22'))
        self.write(op='size',cols=10,rows=4)
        screen=self.frame_with('TOP_2x10',10,4)
        self.assertTrue(screen[1].startswith('TOP_2x10'))
        self.assertTrue(screen[2].startswith('BOTTOM_2'))
    def test_keyboard_fragmented_paste_mouse_resize_and_reattach(self):
        self.attach();self.get_type('frame')
        self.input('\x02v');self.until(lambda:len(self.panes())==2)
        self.input('\x02-');self.until(lambda:len(self.panes())==3)
        self.input('\x02h');self.until(lambda:self.panes()[0]['focused'])
        self.input('\x1b[20');self.input('0~printf PASTED');self.input('\x1b[201~');self.input('\r')
        self.until(lambda:'PASTED' in self.run_cli('read','1'))
        self.input('\x1b[<0;54;10M\x1b[<32;60;10M\x1b[<0;60;10m')
        self.input('\x02c');self.frame_with('new tab');self.input('\r')
        self.until(lambda:self.rpc(op='list')['tabs']==2)
        self.input('\x02TRenamed\r')
        self.input('\x02q');self.get_type('detach')
        self.client_file.close();self.client_file=None;self.client.close();self.client=None
        self.attach();frame=self.get_type('frame');self.assertIn('Renamed',frame['data'])
        self.input('\x021');self.until(lambda:self.panes()[0]['focused'])
        self.assertIn('PASTED',self.run_cli('read','1'))
    def test_sidebar_hook_lifecycle_focus_and_removal(self):
        one=self.rpc(op='new',cwd=self.temp.name,title='Alpha',command='sleep 30')['pane']
        self.rpc(op='new',cwd=self.temp.name,title='Beta',command='sleep 30')
        self.attach();screen=self.frame_with('No agents yet')
        self.assertTrue(screen[0].startswith(' agents'))
        def hook(event,**extra):
            p=subprocess.run([EXE,'hook','codex'],env={**self.env,'WRANGLER_PANE':str(one)},input=json.dumps({'hook_event_name':event,'session_id':'sidebar',**extra}),text=True,capture_output=True,timeout=3)
            self.assertEqual((p.returncode,p.stdout,p.stderr),(0,'',''))
        hook('SessionStart');screen=self.frame_with('codex  idle')
        self.assertNotIn('SessionStart','\n'.join(screen))
        hook('UserPromptSubmit');self.frame_with('Thinking...')
        hook('PreToolUse',tool_name='Bash');screen=self.frame_with('Bash')
        self.assertIn('codex  working','\n'.join(row[:27] for row in screen))
        hook('PermissionRequest');screen=self.frame_with('codex  needs you')
        self.assertEqual(self.panes()[0]['attention'],'needs_input')
        self.click_text([row[:27] for row in screen],'Alpha')
        self.until(lambda:self.panes()[0]['focused'] and self.panes()[0]['attention']=='none')
        self.assertEqual(self.panes()[0]['state'],'blocked')
        self.rpc(op='action',name='rename',value='Renamed')
        screen=self.frame_with('1:Renamed')
        self.assertIn('Renamed','\n'.join(row[:27] for row in screen))
        hook('UserPromptSubmit');self.frame_with('codex  working')
        hook('Stop');self.frame_with('codex  idle')
        hook('SessionEnd');self.frame_with('codex  ended')
        self.rpc(op='close',pane=one)
        screen=self.frame_with('No agents yet')
        self.assertNotIn('Renamed','\n'.join(row[:27] for row in screen))
        self.click(25,1);screen=self.frame_with(' > ')
        self.assertTrue(screen[0].startswith(' > '))
        self.click(2,1);self.frame_with('No agents yet')
    def test_sidebar_scrolling_and_clicks_keep_stable_pane_targets(self):
        panes=[]
        for index in range(10):
            pane=self.rpc(op='new',cwd=self.temp.name,title=f'Agent-{index}',command='sleep 30')['pane'];panes.append(pane)
            self.rpc(op='hook',pane=pane,provider='claude',seq=1,event={'hook_event_name':'SessionStart','session_id':str(index)})
        self.attach();screen=self.frame_with('< 1-6/10 >')
        self.assertNotIn('Agent-9','\n'.join(row[:27] for row in screen))
        self.input('\x1b[<65;5;12M');screen=self.frame_with('< 2-7/10 >')
        self.click(20,23);screen=self.frame_with('< 5-10/10 >')
        self.click_text([row[:27] for row in screen],'Agent-8')
        self.until(lambda:next(p['id'] for p in self.panes() if p['focused'])==panes[8])
        self.rpc(op='action',name='move-tab',value='left')
        self.rpc(op='close',pane=panes[9]);screen=self.frame_with('< 4-9/9 >')
        self.click_text([row[:27] for row in screen],'Agent-8')
        self.until(lambda:next(p['id'] for p in self.panes() if p['focused'])==panes[8])
        self.write(op='size',cols=30,rows=8)
        screen=self.frame_with(' + ',30,8)
        self.assertNotIn('agents',screen[0])
        self.write(op='size',cols=80,rows=24);self.frame_with('< 4-9/9 >')
    def test_sidebar_native_updates_and_selection_keep_approvals_pending(self):
        self.rpc(op='new',cwd=self.temp.name,command='sleep 30')
        self.attach();self.get_type('frame')
        ident=self.rpc(op='native.start',provider='codex',cwd=self.temp.name)['session']
        self.frame_with('codex  ready')
        self.rpc(op='native.send',session=ident,message={'id':1,'method':'test/approval'})
        screen=self.frame_with('codex  needs you')
        self.click_text([row[:27] for row in screen],f'App Server {ident}')
        self.frame_with(f'wrangler native events {ident}')
        session=self.rpc(op='native.list')['sessions'][0]
        self.assertEqual((session['pending_requests'],session['attention']),(1,'needs_input'))
        self.rpc(op='native.send',session=ident,message={'id':900,'result':{'decision':'decline'}})
        self.frame_with('codex  finished')
        self.rpc(op='native.send',session=ident,message={'id':2,'method':'test/exit'})
        self.frame_with('codex  ended')
        self.until(lambda:self.rpc(op='native.list')['sessions'][0]['exited'])
        self.rpc(op='native.stop',session=ident);self.frame_with('No agents yet')
    def test_attention_is_deduplicated_and_explicitly_acknowledged(self):
        self.attach();self.get_type('frame');self.input('\x02v');self.until(lambda:len(self.panes())==2)
        def hook(event,seq,session='test',**extra):
            return self.rpc(op='hook',pane=1,provider='claude',seq=seq,event={'hook_event_name':event,'session_id':session,**extra})
        hook('SessionStart',1);hook('UserPromptSubmit',2);hook('PermissionRequest',3)
        self.assertEqual(self.get_type('bell')['kind'],'needs_input')
        hook('PermissionRequest',4);hook('Stop',5,session='child');hook('Stop',6,agent_id='child')
        self.assertEqual(self.panes()[0]['state'],'blocked');self.assertEqual(self.panes()[0]['attention'],'needs_input')
        self.input('\x02a');self.until(lambda:self.panes()[0]['focused'])
        self.assertEqual(self.panes()[0]['attention'],'none');self.assertEqual(self.panes()[0]['state'],'blocked')
        hook('UserPromptSubmit',7);hook('Stop',8)
        self.assertEqual(self.panes()[0]['attention'],'none')
    def test_slow_and_malformed_clients_do_not_block_runtime(self):
        bad=socket.socket(socket.AF_UNIX);bad.connect(self.path);bad.sendall(b'{incomplete')
        self.assertTrue(self.rpc(op='ping')['ok']);bad.close()
        p=self.rpc(op='new',cwd=self.temp.name,command='printf OUT; exec /bin/sh')['pane']
        self.until(lambda:'OUT' in self.run_cli('read',str(p)))
        s=socket.socket(socket.AF_UNIX);s.connect(self.path);s.sendall(b'[]\n');self.assertIn(b'UnknownOperation',s.recv(1024));s.close()
        self.assertTrue(self.rpc(op='ping')['ok'])
    def test_hook_binary_silent_and_configuration_valid(self):
        pane=self.rpc(op='new',cwd=self.temp.name)['pane']
        payload=json.dumps({'hook_event_name':'UserPromptSubmit','session_id':'session'})
        p=subprocess.run([EXE,'hook','claude'],env={**self.env,'WRANGLER_PANE':str(pane)},input=payload,text=True,capture_output=True,timeout=3)
        self.assertEqual((p.returncode,p.stdout,p.stderr),(0,'',''))
        self.until(lambda:self.panes()[0]['state']=='working')
        for provider in ('claude','codex'):
            config=json.loads(self.run_cli('hooks',provider));self.assertIn('PermissionRequest',config['hooks'])
    def test_native_handshake_retained_approvals_and_event_rotation(self):
        for provider in ('codex','claude'):
            ident=self.rpc(op='native.start',provider=provider,cwd=self.temp.name)['session']
            self.until(lambda:any(s['id']==ident and s['ready'] for s in self.rpc(op='native.list')['sessions']))
            self.rpc(op='native.send',session=ident,message={'id':1,'method':'test/approval'})
            self.until(lambda:any(s['id']==ident and s['pending_requests']==1 for s in self.rpc(op='native.list')['sessions']))
            self.rpc(op='native.send',session=ident,message={'id':2,'method':'test/flood'})
            self.until(lambda:any(s['id']==ident and s['next_seq']>150 for s in self.rpc(op='native.list')['sessions']))
            events=self.rpc(op='native.events',session=ident)
            self.assertLessEqual(len(events['events']),128);self.assertEqual(len(events['pending_requests']),1);self.assertGreater(events['first_seq'],1)
            response={'id':900,'result':{'decision':'decline'}} if provider=='codex' else {'type':'control_response','response':{'subtype':'success','request_id':'permission-1','response':{'behavior':'deny','message':'test'}}}
            self.rpc(op='native.send',session=ident,message=response)
            self.until(lambda:any(s['id']==ident and s['state']=='idle' and s['pending_requests']==0 for s in self.rpc(op='native.list')['sessions']))
            self.rpc(op='native.stop',session=ident)
    def test_native_acknowledgement_refreshes_attached_frame(self):
        self.rpc(op='new',cwd=self.temp.name,command='sleep 30')
        self.attach();self.get_type('frame')
        ident=self.rpc(op='native.start',provider='codex',cwd=self.temp.name)['session']
        self.rpc(op='native.send',session=ident,message={'id':1,'method':'test/approval'})
        while True:
            frame=self.get_type('frame')
            if 'native session' in frame['data'] and 'blocked' in frame['data']:break
        self.rpc(op='native.events',session=ident)
        frame=self.get_type('frame')
        self.assertNotIn('blocked',frame['data'])
        self.assertIn('! 0 needs you',frame['data'])
        self.assertEqual(self.rpc(op='native.list')['sessions'][0]['pending_requests'],1)
    def test_native_codex_discovers_path_without_override(self):
        self.run_cli('shutdown')
        self.until(lambda:not os.path.exists(self.path))
        bin_dir=pathlib.Path(self.temp.name,'auto-bin');bin_dir.mkdir()
        binary=bin_dir/'codex'
        binary.write_text(FAKE.replace('#!/usr/bin/env python3',f'#!{sys.executable}',1));binary.chmod(0o700)
        self.env.pop('WRANGLER_CODEX_BIN')
        self.env['PATH']=str(bin_dir)+os.pathsep+self.env.get('PATH','')
        ident=json.loads(self.run_cli('native','start','codex'))['session']
        self.until(lambda:any(s['id']==ident and s['ready'] for s in self.rpc(op='native.list')['sessions']))
        events=self.rpc(op='native.events',session=ident)['events']
        self.assertTrue(any(json.loads(e['line']).get('result',{}).get('version')=='fixture' for e in events))
    def test_real_client_restores_terminal_on_detach(self):
        self.master,slave=os.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,80,0,0))
        before=termios.tcgetattr(slave)
        self.proc=subprocess.Popen([EXE],env=self.env,stdin=slave,stdout=slave,stderr=slave,start_new_session=True)
        collected=bytearray();end=time.monotonic()+4
        while time.monotonic()<end:
            ready,_,_=select.select([self.master],[],[],.1)
            if ready:collected.extend(os.read(self.master,65536))
            if b'wrangler' in collected:break
        self.assertIn(b'wrangler',collected)
        os.write(self.master,b'\x02q')
        end=time.monotonic()+4
        while self.proc.poll() is None and time.monotonic()<end:
            ready,_,_=select.select([self.master],[],[],.1)
            if ready: collected.extend(os.read(self.master,65536))
        self.proc.wait(timeout=1)
        self.assertEqual(termios.tcgetattr(slave),before)
        os.close(slave)
        self.assertEqual(len(self.panes()),1)

class Discovery(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='wrangler-discovery-')
        self.root=pathlib.Path(self.temp.name)
        self.env={**os.environ,'HOME':str(self.root),'PATH':''}
        self.env.pop('WRANGLER_CODEX_BIN',None)
    def tearDown(self):self.temp.cleanup()
    def script(self,relative,body):
        path=self.root/relative;path.parent.mkdir(parents=True,exist_ok=True)
        path.write_text('#!/bin/sh\n'+body+'\n');path.chmod(0o700)
        return path
    def which(self):
        p=subprocess.run([EXE,'which','codex'],env=self.env,text=True,capture_output=True,timeout=5,cwd=self.root)
        self.assertEqual(p.returncode,0,p.stderr);self.assertEqual(p.stderr,'')
        return p.stdout.strip()
    def test_skip_broken_and_false_positive_path_entries(self):
        broken=self.script('broken/codex','echo "missing native package" >&2; exit 1')
        unrelated=self.script('unrelated/codex','echo "another tool 1.0"')
        valid=self.script('valid/codex','echo "codex-cli 1.2.3"')
        self.env['PATH']=os.pathsep.join(str(p.parent) for p in (broken,unrelated,valid))
        self.assertEqual(self.which(),str(valid))
        # The interactive launcher must select the same binary, not the broken PATH entry.
        p=subprocess.run([EXE,'agent','codex','--version'],env={**self.env,'WRANGLER_PANE':'1'},text=True,capture_output=True,timeout=5)
        self.assertEqual((p.returncode,p.stdout.strip()),(0,'codex-cli 1.2.3'))
    def test_skip_hanging_candidate(self):
        hung=self.script('hung/codex','/bin/sleep 30')
        valid=self.script('valid/codex','echo "codex-cli 1.2.3"')
        self.env['PATH']=os.pathsep.join(str(p.parent) for p in (hung,valid))
        self.assertEqual(self.which(),str(valid))
    def test_preserve_symlink_shim_invocation(self):
        shim=self.script('shared/shim','case "$0" in */codex) echo "codex-cli 1.2.3";; *) exit 1;; esac')
        link=self.root/'bin/codex';link.parent.mkdir();link.symlink_to(shim)
        self.env['PATH']=str(link.parent)
        self.assertEqual(self.which(),str(link))
    def test_relative_path_resolves_to_absolute_executable(self):
        valid=self.script('relative/codex','echo "codex-cli 1.2.3"')
        self.env['PATH']='relative'
        found=pathlib.Path(self.which())
        self.assertTrue(found.is_absolute());self.assertTrue(found.samefile(valid))
    def test_user_install_fallback(self):
        valid=self.script('.local/bin/codex','echo "codex-cli 1.2.3"')
        self.assertEqual(self.which(),str(valid))
    @unittest.skipUnless(sys.platform=='darwin','macOS app bundles')
    def test_renamed_user_app_bundle_fallback(self):
        valid=self.script('Applications/Codex Beta.app/Contents/Resources/codex','echo "codex-cli 1.2.3"')
        self.assertEqual(self.which(),str(valid))
    def test_explicit_override_is_preserved(self):
        self.env['WRANGLER_CODEX_BIN']='/custom/provider'
        self.assertEqual(self.which(),'/custom/provider')

if __name__=='__main__': unittest.main(verbosity=2)
