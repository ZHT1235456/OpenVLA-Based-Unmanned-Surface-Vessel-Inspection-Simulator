"""Check floating litter collection in the packaged WebView2 application."""
import hashlib
import json
import re
from pathlib import Path

from playwright.sync_api import expect
from check_desktop import run


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'verification'
EXE = ROOT / '基于OpenVLA的无人艇巡检模拟.exe'


def ledger(page):
    field = lambda key: page.locator('#cleanup-' + key).text_content()
    return dict(water=int(field('water')), cargo=field('cargo'), ashore=int(field('land')),
                detail=field('detail'), phase=field('phase'))


def verify(page):
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    cases = []
    box = page.locator('#command')
    page.locator('#pause').click()
    box.fill('只收集泡')
    box.press('Tab')
    expect(box).to_have_value('只收集泡沫块')
    box.press('Enter')
    expect(page.locator('#cleanup-phase')).to_contain_text('泡沫块')
    expect(page.locator('#speed')).to_have_text('0.0')
    planned = page.locator('#chart').get_attribute('aria-label')
    assert 'A* 规划航线' in planned
    page.locator('#pause').click()
    expect(page.locator('#cleanup-cargo')).to_have_text('1 / 2', timeout=65000)
    rate = float(page.locator('#policy-rate').inner_text())
    assert rate > 0
    page.wait_for_timeout(1900)
    page.locator('#pause').click()
    page.locator('#log-tab').click()
    work = ledger(page)
    assert work['water'] == 4 and work['cargo'] == '1 / 2' and work['ashore'] == 0
    paused_clock = page.locator('#clock').inner_text()
    page.wait_for_timeout(400)
    assert page.locator('#clock').inner_text() == paused_clock and ledger(page) == work
    page.screenshot(path=str(OUT / 'cleanup-desktop.png'), scale='css', timeout=20000)
    page.locator('#pause').click()
    expect(page.locator('#cleanup-phase')).to_have_text('清漂完成', timeout=120000)

    def record(text, bottles, foam, trips, boat_ids):
        final = ledger(page)
        assert final['water'] == 5-bottles-foam and final['ashore'] == bottles+foam
        assert final['cargo'] == '0 / 2' and f'瓶 {bottles} · 泡沫 {foam}' in final['detail']
        unload, picked, photos = [], [], 0
        for vessel in boat_ids:
            if len(boat_ids) > 1:
                page.locator('#follow-boat').select_option(vessel)
            logs = page.locator('#logs > div > span').all_text_contents()
            unload.extend(vessel+'艇 '+line for line in logs if '泊位收到 ' in line)
            picked.extend(re.findall(r'([PF][1-3]) 通过船首收集口', ' '.join(logs)))
            photos += page.locator('#photos img').count()
        assert len(unload) == trips if trips is not None else len(unload) >= 3
        assert len(picked) == len(set(picked)) == bottles+foam and photos == 0, (picked, unload, photos)
        cases.append(dict(command=text, ledger=final, waterToHold=picked, unloading=unload, photos=photos))

    record('只收集泡沫块',0,2,1,['A'])
    # Advance only the animation clock for the remaining cases. The app and its worker run normally.
    page.add_init_script(path=str(ROOT/'test'/'command-replay.js'))
    page.reload(wait_until='domcontentloaded')
    expect(page.locator('#mode')).to_have_text('模型就绪', timeout=60000)
    for i,(text,bottles,foam,trips,ids) in enumerate([
        ('只收集塑料瓶',3,0,2,['A']),
        ('清理所有水面漂浮物',3,2,3,['A']),
        ('A艇收集塑料瓶，B艇收集泡沫块',3,2,None,['A','B']),
    ]):
        page.locator('#reset').evaluate('el => el.click()')
        expect(page.locator('#cleanup-ledger')).to_be_hidden()
        if i == 0:
            page.locator('.cleanup-library').evaluate('el => el.open = true')
            page.locator('.cleanup-library [data-command="只收集塑料瓶"]').evaluate('el => el.click()')
        else:
            box.fill(text)
            box.press('Enter')
        for _ in range(44):
            page.evaluate('() => window.advanceHarborFrames(40)')
            if ledger(page)['ashore'] == bottles+foam:
                break
        page.evaluate('() => window.advanceHarborFrames(20)')
        record(text,bottles,foam,trips,ids)
    assert not errors, errors
    report = dict(exe=EXE.name, sha256=hashlib.sha256(EXE.read_bytes()).hexdigest(),
                  firstRouteWhilePaused=planned, realtimePilotHz=rate, pausedLedger=work,
                  screenshot='cleanup-desktop.png', cases=cases, pageErrors=errors)
    (OUT/'cleanup-desktop.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print([(row['command'],row['ledger']['ashore'],row['photos']) for row in cases], flush=True)


if __name__ == '__main__':
    run(EXE, OUT, command_check=verify)
