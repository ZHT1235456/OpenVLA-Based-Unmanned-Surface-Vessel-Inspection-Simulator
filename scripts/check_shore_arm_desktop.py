"""Exercise the shore transfer through the packaged Windows application's public controls."""
import hashlib
import json
from pathlib import Path

from playwright.sync_api import expect
from check_desktop import run


ROOT = Path(__file__).resolve().parents[1]
EXE = ROOT / '基于OpenVLA的无人艇巡检模拟.exe'
OUT = ROOT / 'verification'


def verify(page):
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.add_init_script(path=str(ROOT / 'test/command-replay.js'))
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('#mode')).to_have_text('模型就绪', timeout=60000)
    page.evaluate("""() => {
      window.armRead = () => {
        const el = id => document.getElementById(id), arm = el('shore-state');
        return {stage:arm.dataset.stage, berth:arm.dataset.berth, id:arm.dataset.item,
          cargo:parseInt(el('cleanup-cargo').textContent), ashore:Number(el('cleanup-land').textContent),
          water:Number(el('cleanup-water').textContent), speed:Number(el('speed').textContent),
          phase:el('cleanup-phase').textContent, label:arm.textContent, clock:el('clock').textContent};
      };
      window.armHistory = [];
      window.untilArm = async (finish) => {
        let previous = '';
        for(let i=0;i<2800;i++) {
          await window.advanceHarborFrames(2);
          const r=window.armRead(), key=[r.stage,r.id,r.water,r.cargo,r.ashore].join('/');
          if(key!==previous){window.armHistory.push(r);previous=key}
          if(finish ? r.phase==='清漂完成' : r.stage==='swing')return r;
        }
        throw Error('岸端交接超时 '+JSON.stringify(window.armRead()));
      };
    }""")
    command = '只收集泡沫块'
    box = page.locator('#command')
    box.fill(command); box.press('Enter')
    expect(page.locator('#cleanup-ledger')).to_be_visible()
    camera = page.locator('#shore-view')
    camera.evaluate('e=>e.click()')
    expect(camera).to_have_attribute('aria-pressed','true')
    expect(page.locator('#view')).to_have_text('岸端接应')
    progress = page.evaluate('() => window.untilArm(false)')
    assert progress['ashore']==0 and progress['cargo']==1 and progress['speed']==0, progress
    page.evaluate('() => window.advanceHarborFrames(4)')
    page.locator('#pause').evaluate('e=>e.click()')
    page.locator('#log-tab').evaluate('e=>e.click()')
    frozen = page.evaluate('() => window.armRead()')
    page.evaluate('() => window.advanceHarborFrames(12)')
    assert page.evaluate('() => window.armRead()') == frozen
    page.screenshot(path=str(OUT/'shore-arm-desktop.png'),scale='css')
    page.locator('#pause').evaluate('e=>e.click()')
    final = page.evaluate('() => window.untilArm(true)')
    photos = page.locator('#photos img').count()
    assert (final['water'],final['cargo'],final['ashore'],final['stage'],photos)==(3,0,2,'idle',0), final
    rows = page.evaluate('window.armHistory')
    ids = list(dict.fromkeys(r['id'] for r in rows if r['stage']=='lift'))
    assert set(ids)=={'F1','F2'}
    for index,item in enumerate(ids):
        transfer=[r for r in rows if r['id']==item]
        for stage in ['reach','lower','close','lift','swing','place','open','stow']:
            assert any(r['stage']==stage for r in transfer),(item,stage)
        for r in transfer:
            assert r['berth']=='east' and r['speed']==0
            if r['stage'] in ('lift','swing','place','open'):
                assert (r['cargo'],r['ashore'])==(1-index,index),r
            if r['stage']=='stow': assert r['ashore']==index+1,r
    camera.evaluate('e=>e.click()')
    expect(camera).to_have_attribute('aria-pressed','false')
    expect(page.locator('#view')).to_have_text('随艇视角')
    assert not errors,errors
    result = dict(command=command,exeSHA256=hashlib.sha256(EXE.read_bytes()).hexdigest(),
                  screenshot='shore-arm-desktop.png',paused=frozen,final=final,
                  sequence=rows,photos=photos,pageErrors=errors)
    (OUT/'shore-arm-desktop.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(ids, final, flush=True)


if __name__ == '__main__':
    run(EXE, OUT, command_check=verify)
