"""Run complete RGB + Chinese -> ONNX -> actuators -> contact/unloading simulations in Edge."""
import argparse
from contextlib import contextmanager
import hashlib
import json
from pathlib import Path
import subprocess
import time
from urllib.parse import urlparse
from urllib.request import urlopen
from playwright.sync_api import sync_playwright


def cases(full):
    checks = [
        ('只收集泡沫块', 0, True, 0, (0,2)), ('只收集塑料瓶', 0, True, 0, (3,0)),
        ('清理所有水面漂浮物', 0, True, 0, (3,2)), ('A艇收集塑料瓶，B艇收集泡沫块', 0, True, 0, (3,2)),
    ]
    # Spatial counterexample: move both materials to other, previously empty water positions.
    unseen=[[3,18],[-10,4],[10,-3],[12,15],[-12,14]]
    for text,layout,traffic,delay,expected in checks:
        yield dict(text=text,layout=layout,traffic=traffic,delay=delay),expected
    for i,(text,_,_,_,expected) in enumerate(checks[:2]):
        yield dict(text=text,layout=i+1,traffic=True,delay=7,placements=unseen),expected
    if not full:
        return
    i=0
    for verb in ['收集','清理','回收','打捞','捡拾','捞起']:
        for material,expected in [('塑料瓶',(3,0)),('泡沫块',(0,2)),('所有水面漂浮物',(3,2))]:
            for suffix in ['', '，装满后返回东泊位卸载','，满舱后回西泊位卸载']:
                for vessel in ['A','B']:
                    text=vessel+'艇'+verb+material+suffix
                    yield dict(text=text,layout=i%3,traffic=i%4!=0,delay=i%5*2),expected
                    i+=1
    for layout in range(3):
        for traffic in [False,True]:
            for text in ['双艇清理所有水面漂浮物','A艇只收集塑料瓶，B艇只收集泡沫块']:
                yield dict(text=text,layout=layout,traffic=traffic), (3,2)
    for text,layout,delay,count in [
        ('请把港池里的漂浮物清理干净，不要碰浮标',2,19,(3,2)),
        ('收集水面漂浮物，不要回收塑料瓶',1,12,(0,2)),
        ('只捡拾漂浮的塑料瓶，满了就回码头卸货',0,26,(3,0)),
        ('双艇清理水面漂浮物，装满后回东泊位卸载',1,15,(3,2))]:
        yield dict(text=text,layout=layout,traffic=True,delay=delay),count
    yield dict(text='穿过浮标门，再清理水面漂浮物，不要拍照',layout=2,traffic=True),(3,2)
    yield dict(text='只收集泡沫块',exercise='reassign'),(3,2)
    yield dict(text='A艇收集塑料瓶，B艇收集泡沫块',layout=1,exercise='reconnect'),(3,2)
    yield dict(text='只收集泡沫块',placements=[[28,-17],[29,-20],[30,-19],[28,-22],[30,-24]]),(0,0)


def report(rows):
    weights=Path(__file__).resolve().parents[1]/'public/models/cleanup.onnx'
    failures=[row['case'] for row in rows if not row['passed']]
    return dict(passed=len(rows)-len(failures),total=len(rows),failed=failures,
                uniqueOrders=len({row['text'] for row in rows}),
                cleanupONNXSHA256=hashlib.sha256(weights.read_bytes()).hexdigest(),
                bowFrames=sum(row.get('counts',{}).get('frames',0) for row in rows),
                collisions=sum(row.get('collisions',0) for row in rows),
                photos=sum(row.get('photos',0) for row in rows),rows=rows)


@contextmanager
def vite(url):
    probe=url+'/test/cleanup-camera.js'
    def ready():
        try:
            with urlopen(probe,timeout=1) as response:return b'cameraTrials' in response.read()
        except OSError:return False
    if ready():
        yield
        return
    address=urlparse(url)
    if address.hostname not in ('127.0.0.1','localhost'):raise RuntimeError('Vite server unavailable: '+url)
    root=Path(__file__).resolve().parents[1]
    subprocess.run(['node','scripts/copy-runtime.mjs'],cwd=root,check=True)
    boot="""import {createServer} from 'vite';
      const s=await createServer({server:{host:process.argv[1],port:Number(process.argv[2]),strictPort:true,hmr:false,watch:null}});
      await s.listen();"""
    proc=subprocess.Popen(['node','--input-type=module','-e',boot,address.hostname,str(address.port)],
                          cwd=root,stdout=subprocess.DEVNULL)
    try:
        for _ in range(100):
            if ready():break
            if proc.poll() is not None:raise RuntimeError('Vite exited before serving camera trials')
            time.sleep(.1)
        else:raise TimeoutError('Vite startup')
        yield
    finally:
        proc.terminate();proc.wait()


def main(args):
    rows=[];fail=[]
    args.out.parent.mkdir(parents=True,exist_ok=True)
    with vite(args.url),sync_playwright() as pw:
        browser=pw.chromium.launch(channel='msedge',headless=True,args=['--enable-webgl','--ignore-gpu-blocklist'])
        page=browser.new_page()
        page.goto(args.url+'/test/cleanup-camera.js',wait_until='commit')
        page.evaluate("""async()=>{const m=await import('/test/cleanup-camera.js');window.trial=await m.cameraTrials()}""")
        for i,(case,expected) in enumerate(cases(args.full)):
            if args.only is not None and i not in args.only:continue
            if args.shard and i%args.shard[1]!=args.shard[0]:continue
            row=page.evaluate('c=>trial(c)',{**case,'debug':args.debug})
            landed=[t for t in row.get('transitions',[]) if t[3]=='land']
            counts=tuple(sum(t[1]==k for t in landed) for k in ['bottle','foam'])
            actors=all(('B艇' not in case['text'] or 'A艇' in case['text'] or t[2]=='B')
                       and ('A艇' not in case['text'] or 'B艇' in case['text'] or t[2]=='A') for t in landed)
            if 'A艇' in case['text'] and 'B艇' in case['text']:
                actors=all(t[2]==('A' if t[1]=='bottle' else 'B') for t in landed)
            dock=next((s for s,term in [('east','东泊位'),('west','西泊位')] if term in case['text']),None)
            berths=all(t[4]==(dock or ('east' if t[2]=='A' else 'west')) for t in landed)
            if case.get('exercise')=='reassign':
                berths=(sum(t[4]=='west' and t[1]=='foam' for t in landed)==1 and
                        sum(t[4]=='east' for t in landed)==4 and len(row['checks'])==2)
            if case.get('exercise')=='reconnect':berths=berths and bool(row['checks'])
            ok=(row.get('done') and counts==expected and actors and berths and row['planned'] and row['counts']['frames']>0 and
                not any(row[k] for k in ['photos','badContact','badUnload','overcapacity','collisions']))
            row.update(case=i,passed=bool(ok),expected=expected,
                       setup={key:value for key,value in case.items() if key not in ('text','layout','traffic')})
            rows.append(row)
            if not ok:fail.append(i)
            print(i,case['text'],counts,row.get('time'),row.get('collisions'),bool(ok),flush=True)
            args.out.write_text(json.dumps(report(rows),
                                           ensure_ascii=False,indent=1)+'\n',encoding='utf8')
        browser.close()
    if fail:raise SystemExit(1)


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--url',default='http://127.0.0.1:5194')
    p.add_argument('--out',type=Path,default=Path('verification/cleanup-vision.json'))
    p.add_argument('--full',action='store_true')
    p.add_argument('--debug',action='store_true')
    p.add_argument('--only',type=int,nargs='+')
    p.add_argument('--shard',type=int,nargs=2,metavar=('INDEX','TOTAL'))
    main(p.parse_args())
