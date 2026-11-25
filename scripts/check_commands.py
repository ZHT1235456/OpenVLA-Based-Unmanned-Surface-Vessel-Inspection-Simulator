"""Replay the frozen command specification through the actual input and Web Worker in Edge or Tauri."""
import argparse
import hashlib
import json
import os
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from playwright.sync_api import expect, sync_playwright

from cegis_cases import corpus

ROOT=Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_report(path,report):
    body=json.dumps(report,ensure_ascii=False,indent=2)
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(body,encoding='utf8')
    # On Windows a reader can briefly open the destination without delete sharing.
    for attempt in range(8):
        try:
            os.replace(temp,path)
            return
        except PermissionError as exc:
            if getattr(exc,'winerror',None) not in (5,32,33) or attempt==7:raise
            time.sleep(.04*(attempt+1))


def write_summary(path,report):
    rows=report['rows']
    passed=sum(r['pass'] for r in rows)
    rejected=sum(r['op']=='reject' for r in rows)
    captures=sum(len(r['photoChecks']) for r in rows)
    lines=['# 无人艇中文指令测试','',
           f'在发布版 EXE 的输入框回放了 {len(rows)} 条不同指令，通过 {passed} 条。其中 {len(rows)-rejected} 条要求执行，{rejected} 条要求说明原因并拒绝派单。共校验 {captures} 张船首 JPEG。','',
           '每条复测都重置场景。涉及指代、追加或撤单时，通过输入框建立前置任务。仿真按每步 0.1 秒推进，等待真实 ONNX 线程返回。核对内容包括艇号、任务顺序、持续倾斜条件、停船与继续、实际相册和两艇回传影像。照片核对分辨率、目标、取证距离和画面中央的浮标颜色。','',
           f'原始记录包含每条指令的预期、实际结果、场景布局、前置条件和模型调用次数。[逐条 JSON]({path.with_suffix(".json").name})','',
           f'发布版 SHA-256 为 `{report["exeSHA256"]}`。','',
           '## 验证轮次','']
    counterexamples=[]
    planning=any('routeChecks' in r for r in rows)
    for phase,label in [('baseline','旧版 EXE，派单复验'),('discovery','新版发现集闭环'),('holdout','新版独立留出集闭环')]:
        for prefix in (('commands-route',) if planning else ('commands-photo','commands')):
            source=path.parent/f'{prefix}-{phase}.json'
            if not source.exists():continue
            run=json.loads(source.read_text(encoding='utf8'))
            if not run['complete'] or run['corpusSHA256']!=report['corpusSHA256']:continue
            n=sum(r['pass'] for r in run['rows'])
            lines.append(f'- {label}通过 {n}/{len(run["rows"])}。[本轮记录]({source.name})')
            if phase=='baseline':
                counterexamples=[r for r in run['rows'] if not r['pass']]
            break
    lines.append(f'- 发布版 EXE 全量闭环通过 {passed}/{len(rows)}。')
    if planning:
        routes=sum(len(r.get('routeChecks',{})) for r in rows)
        lines.append(f'- 在 {routes} 次单艇派单检查中核对了起航前的 A* 规划日志、海图航段数和规划距离。')
    desktop=path.parent/'desktop.json'
    if desktop.exists():
        realtime=json.loads(desktop.read_text(encoding='utf8'))
        if realtime['exe_sha256']==report['exeSHA256'] and not realtime['page_errors']:
            checks='绿标取证、双艇分工和接力回传'
            if realtime.get('withdrawn_shutter'):
                checks+='，并确认撤销拍摄后继续原航线时相册新增 0 张'
            lines.append(f'- 同一 EXE 在正常播放速度下另行验证了{checks}。[桌面复验记录](desktop.json)')
    lines.append('')
    if counterexamples:
        lines.extend(['## 旧版反例','',
                      '| 编号 | 输入指令 | 旧版实际反馈或派单 |','| --- | --- | --- |'])
        for r in counterexamples:
            observed=r.get('error') if planning else r['feedback']
            if not planning and '本条未派单' not in observed:
                observed=' / '.join(k+'艇 '+' → '.join(b['pending']) for k,b in r['boats'].items() if b['pending']) or observed
            lines.append(f'| {r["id"]} | {r["text"]} | {observed or r["feedback"]} |')
        lines.append('')
    lines.extend(['## 指令与实测结果','',
                  '“保持原任务”表示错误指令到达时艇已在执行命令，核验后旧任务和相册均保留。每条指令的场景条件见原始记录。','',
                  '| 编号 | 指令 | 实测结果 | 船首照片 | 判定 |','| --- | --- | --- | ---: | --- |'])
    for r in rows:
        if r['op']=='reject':
            actual=r['feedback'].split('本条未派单')[0].strip()+' 本条未派单。'
            if r['setup']:actual+='保持原任务。'
        else:
            groups=[]
            for vessel,b in r['boats'].items():
                steps=[*b['done'],*b['pending']]
                if steps:groups.append(vessel+'艇 '+' → '.join(steps))
            actual=' / '.join(groups) or '待办已清空'
            if r['op']=='hold':actual='已停船，保留 '+actual
            if r['op']=='resume':actual='已恢复，'+actual
            if r['op']=='traffic':actual='已启用保洁船，'+actual
        actual=(r.get('error') or actual).replace('|','\\|').replace('\n',' ')
        verdict='通过' if r['pass'] else '失败'
        lines.append(f'| {r["id"]} | {r["text"]} | {actual} | {len(r["photoChecks"])} | {verdict} |')
    path.write_text('\n'.join(lines)+'\n',encoding='utf8')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--url',help='use the development build at this URL; default is the released desktop EXE')
    p.add_argument('--exe',type=Path,default=ROOT/'基于OpenVLA的无人艇巡检模拟.exe')
    p.add_argument('--phase',choices=('discovery','holdout','all'),default='all')
    p.add_argument('--plan-only',action='store_true',help='check dispatch; completion and JPEG evidence require a full run')
    p.add_argument('--ids',help='comma-separated scenario IDs for counterexample replay')
    p.add_argument('--out',type=Path,help='report path; a partial replay writes a separate report')
    opts=p.parse_args()
    specs=corpus()
    encoded=json.dumps(specs,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
    ids=set(opts.ids.split(',')) if opts.ids else None
    cases=[s for s in specs if (opts.phase=='all' or opts.phase==s['phase']) and (not ids or s['id'] in ids)]
    if not cases or ids and len(ids)!=len(cases):
        p.error('No cases matched or some IDs are missing')
    if opts.out is None:
        full_release=not opts.url and not opts.plan_only and not ids and opts.phase=='all'
        filename='commands-final.json' if full_release else 'commands-replay.json'
        opts.out=ROOT/'verification'/filename
    opts.out.parent.mkdir(parents=True,exist_ok=True)
    report=dict(startedUTC=datetime.now(timezone.utc).isoformat(),phase=opts.phase,
                mode='dispatch' if opts.plan_only else 'closed-loop',surface=opts.url or opts.exe.name,
                exeSHA256=None if opts.url else digest(opts.exe),corpusSHA256=hashlib.sha256(encoded).hexdigest(),
                modelSHA256={f.name:digest(f) for f in sorted((ROOT/'public/models').glob('*.onnx'))},
                totalExpected=len(cases),complete=False,rows=[],pageErrors=[])
    def replay(page):
        page.on('pageerror',lambda e:report['pageErrors'].append(str(e)))
        page.add_init_script(path=str(ROOT/'test/command-replay.js'))
        if opts.url:
            page.goto(opts.url,wait_until='domcontentloaded')
        else:
            page.reload(wait_until='domcontentloaded')
        expect(page.locator('#mode')).to_have_text('模型就绪',timeout=60000)
        for index,spec in enumerate(cases,1):
            result=page.evaluate('([s, full])=>window.replayHarborCommand(s,full)',[spec,not opts.plan_only])
            report['rows'].append({**spec,**result})
            if not result['pass']:
                print(spec['id'],spec['text'],result['error'],flush=True)
            if index%10==0 or index==len(cases):
                passed=sum(r['pass'] for r in report['rows'])
                print(f'{index}/{len(cases)} replayed; {passed} passed',flush=True)
            write_report(opts.out,report)
    try:
        if opts.url:
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='msedge',headless=True,args=['--enable-webgl','--ignore-gpu-blocklist'])
                try:replay(browser.new_page(viewport={'width':1000,'height':680}))
                finally:browser.close()
        else:
            from check_desktop import run
            run(opts.exe,opts.out.parent,command_check=replay)
    finally:
        rows=report['rows'];report['complete']=len(rows)==len(cases)
        report['counts']=dict(Counter('passed' if r['pass'] else 'failed' for r in rows))
        report['finishedUTC']=datetime.now(timezone.utc).isoformat()
        write_report(opts.out,report)
    print(str(opts.out),report['counts'],flush=True)
    if not opts.url and not opts.plan_only and not ids and opts.phase=='all' and report['complete']:
        write_summary(opts.out.with_suffix('.md'),report)
    return 0 if report['complete'] and all(r['pass'] for r in rows) and not report['pageErrors'] else 1


if __name__=='__main__':
    sys.exit(main())
