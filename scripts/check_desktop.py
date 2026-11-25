"""Launch the delivered EXE from an empty working directory and exercise its actual WebView2 window."""
import argparse, base64, ctypes, ctypes.wintypes as wt, hashlib, io, json, math, os, socket, statistics, subprocess, tempfile, time
from pathlib import Path
from urllib.request import urlopen
from playwright.sync_api import sync_playwright, expect
from PIL import Image, ImageChops, ImageStat

class Monitor(ctypes.Structure):
    _fields_=[('size',wt.DWORD),('screen',wt.RECT),('work',wt.RECT),('flags',wt.DWORD)]
u=ctypes.windll.user32
u.MonitorFromWindow.argtypes=[wt.HWND,wt.DWORD];u.MonitorFromWindow.restype=wt.HANDLE
u.GetMonitorInfoW.argtypes=[wt.HANDLE,ctypes.POINTER(Monitor)]
def bounds(pid):
    found=[]
    @ctypes.WINFUNCTYPE(wt.BOOL,wt.HWND,wt.LPARAM)
    def visit(hwnd,_):
        owner=wt.DWORD();u.GetWindowThreadProcessId(hwnd,ctypes.byref(owner))
        if owner.value==pid and u.IsWindowVisible(hwnd) and u.GetWindowTextLengthW(hwnd)>0:found.append(hwnd)
        return True
    u.EnumWindows(visit,0)
    if not found:raise RuntimeError('Window missing')
    hwnd=found[0];r=wt.RECT();u.GetWindowRect(hwnd,ctypes.byref(r))
    m=Monitor();m.size=ctypes.sizeof(m);u.GetMonitorInfoW(u.MonitorFromWindow(hwnd,2),ctypes.byref(m))
    as_list=lambda a:[a.left,a.top,a.right,a.bottom]
    rect,screen=as_list(r),as_list(m.screen)
    return {'rect':rect,'monitor':screen,'covers_monitor':max(abs(x-y) for x,y in zip(rect,screen))<=2},hwnd

def bow_probe(page):
    canvas=page.locator('#bow')
    page.wait_for_function("""() => {const c=document.querySelector('#bow'),p=c.parentElement;
        return c.clientWidth===p.clientWidth && c.clientHeight===p.clientHeight &&
        Math.abs(c.width/c.height-c.clientWidth/c.clientHeight)<.025}""")
    sizes=canvas.evaluate("""c=>({panel:[c.parentElement.clientWidth,c.parentElement.clientHeight],
        css:[c.clientWidth,c.clientHeight],buffer:[c.width,c.height],fit:getComputedStyle(c).objectFit})""")
    image=Image.open(io.BytesIO(canvas.screenshot())).convert('RGB')
    w,h=image.size
    edges=[[(x,y) for x in range(3,w-3,3)] for y in (2,h-3)]
    edges += [[(x,y) for y in range(3,h-3,3)] for x in (2,w-3)]
    sizes['lit_fraction_on_edges']=[round(sum(max(image.getpixel(p))>30 for p in points)/len(points),3) for points in edges]
    assert sizes['css']==sizes['panel'] and sizes['fit']=='fill' and min(sizes['lit_fraction_on_edges'])>.8,sizes
    return sizes

def check_horizontal_orbit(page):
    canvas=page.locator('#world')
    box=canvas.bounding_box()
    x=box['x']+box['width']/2
    y=box['y']+box['height']*.48
    def frame():
        page.wait_for_timeout(120)
        image=Image.open(io.BytesIO(canvas.screenshot())).convert('RGB')
        return image.resize((320,round(image.height*320/image.width)),Image.Resampling.LANCZOS)
    def drag(dx):
        page.mouse.move(x,y)
        page.mouse.down()
        page.mouse.move(x+dx,y,steps=7)
        page.mouse.up()
        return frame()
    # Match a strip of distant shoreline in the paused view. Looking right moves the shore left.
    start=frame()
    w,h=start.size
    left,right=w//3,2*w//3
    top,bottom=round(h*.21),round(h*.42)
    reference=start.crop((left,top,right,bottom))
    def shore_shift(image):
        def difference(offset):
            strip=image.crop((left+offset,top,right+offset,bottom))
            return sum(ImageStat.Stat(ImageChops.difference(reference,strip)).mean)
        return min(range(-76,77),key=difference)
    heading=page.locator('#heading').inner_text()
    rightward=shore_shift(drag(32))
    center=shore_shift(drag(-32))
    leftward=shore_shift(drag(-32))
    restored=shore_shift(drag(32))
    assert rightward<-5 and leftward>5 and abs(center)<=2 and abs(restored)<=2,(rightward,center,leftward,restored)
    assert page.locator('#heading').inner_text()==heading
    return {'drag_css_px':32,'reference_width_px':w,'shore_shift_right_drag_px':rightward,'shore_shift_left_drag_px':leftward,'return_shift_px':restored}

def check_route_before_departure(page,out):
    page.locator('#reset').click()
    page.locator('#pause').click()
    box=page.locator('#command');chart=page.locator('#chart')
    command='检查木栈桥旁的黄标，最后返回西泊位'
    box.fill(command);box.press('Enter')
    expect(page.locator('#logs')).to_contain_text('A* 航线已生成 · 2 个航段')
    expect(page.locator('#speed')).to_have_text('0.0')
    label=chart.get_attribute('aria-label')
    assert 'A* 规划航线 · 2 个航段' in label,label
    types=page.locator('#logs > div > small').all_text_contents()[::-1]
    assert next(i for i,v in enumerate(types) if v.endswith('· 规划'))<next(i for i,v in enumerate(types) if v.endswith('· 执行'))
    chart.screenshot(path=str(out/'planned-route.png'))
    page.locator('#pause').click()
    expect(page.locator('#logs')).to_contain_text('西泊位 · 返航靠泊已完成',timeout=100000)
    expect(page.locator('#photos img')).to_have_count(0)
    page.locator('#reset').click()
    return {'command':command,'chart_before_motion':label,'speed_before_motion':0,'completed_at':'西泊位','screenshot':'planned-route.png'}

def check_navigation_without_photos(page):
    sentence='穿过红绿浮标门，只观察木栈桥旁的黄标，最后返回西泊位'
    page.locator('.command-library summary').click()
    page.locator('#examples').get_by_role('button',name=sentence,exact=True).click()
    page.locator('.command-library summary').click()
    logs=page.locator('#logs')
    expect(logs).to_contain_text('西泊位 · 返航靠泊已完成',timeout=100000)
    expect(logs).to_contain_text('已通过红绿浮标门')
    expect(logs).to_contain_text('栈桥黄标 · 抵近观察已完成')
    expect(page.locator('#photos img')).to_have_count(0)
    tasks=page.locator('#tasks > div > span').all_text_contents()
    assert tasks==['西泊位 · 返航靠泊','栈桥黄标 · 抵近观察','浮标门 · 穿过浮标门'],tasks
    report={'command':sentence,'completed_in_order':tasks[::-1],'photos':0,'elapsed':page.locator('#clock').inner_text()}
    page.locator('#reset').click()
    return report

def check_shutter_withdrawal(page):
    box=page.locator('#command')
    order='给绿标拍照，最后返回东泊位'
    box.fill(order);box.press('Enter')
    expect(page.locator('#tasks')).to_contain_text('浮标门绿标 · 全景拍照')
    box.fill('不要拍照');box.press('Enter')
    expect(page.locator('#tasks')).to_contain_text('浮标门绿标 · 抵近观察')
    expect(page.locator('#tasks')).not_to_contain_text('全景拍照')
    box.fill('继续任务');box.press('Enter')
    expect(page.locator('#logs')).to_contain_text('东泊位 · 返航靠泊已完成',timeout=100000)
    expect(page.locator('#logs')).to_contain_text('浮标门绿标 · 抵近观察已完成')
    expect(page.locator('#photos img')).to_have_count(0)
    page.locator('#reset').click()
    return {'commands':[order,'不要拍照','继续任务'],'finished_at':'东泊位','photos':0}

def check_command_suggestions(page):
    command=page.locator('#command')
    key=page.locator('#suggestion-key')
    preview=page.locator('#suggestion-text')
    def accept(text):
        command.press('Tab')
        expect(command).to_have_value(text)
        expect(command).to_be_focused()
        assert command.evaluate('el=>[el.selectionStart,el.selectionEnd]')==[len(text),len(text)]
        expect(page.locator('#tasks > div')).to_have_count(0)

    default='去木栈桥旁的黄标拍照'
    command.focus()
    expect(command).to_have_attribute('placeholder',default)
    expect(key).to_be_visible()
    accept(default)
    command.press('Tab')
    expect(page.locator('#send')).to_be_focused()

    command.fill('返回')
    expect(preview).to_have_text('返回东泊位')
    command.press('Shift+Tab')
    expect(command).to_have_value('返回')
    expect(page.locator('#fleet-mode')).to_be_focused()
    command.focus()
    untouched=command.evaluate("""el=>{
        el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
        const allowed=el.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
        el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
        return allowed && el.value==='返回';
    }""")
    assert untouched
    accept('返回东泊位')
    command.press('Shift+Enter')
    expect(command).to_have_value('返回东泊位\n')
    expect(page.locator('#tasks > div')).to_have_count(0)

    command.fill('B艇只观察防波堤边的红标')
    command.press('Enter')
    expect(preview).to_have_text('B艇只观察浮标门的红标')
    command.fill('我自己的草稿')
    expect(key).to_be_hidden()
    command.press('Tab')
    expect(page.locator('#send')).to_be_focused()
    expect(command).to_have_value('我自己的草稿')

    command.fill('停船')
    command.press('Enter')
    expect(command).to_have_attribute('placeholder','继续任务')
    accept('继续任务')
    expect(page.locator('#mode')).to_have_text('原地等候')
    command.press('Enter')
    expect(page.locator('#mode')).to_have_text('模型就绪')
    expect(command).to_have_value('')
    return {'empty':default,'prefix':'返回东泊位','paused':'继续任务','tab_dispatches':0,
            'caret_at_end':True,'stale_correction_dismissed':True,'ime_and_keyboard_navigation':True}

def check_marker_grounding(page,out):
    command=page.locator('#command')
    def send(text):
        command.fill(text);command.press('Enter')
    wrong='去木栈桥旁边的绿标拍照'
    command.fill(wrong)
    page.locator('#send').click()
    expect(page.locator('#visible-task')).to_contain_text('木栈桥旁没有绿标')
    expect(page.locator('#visible-task')).to_contain_text('本条未派单')
    expect(page.locator('#tasks > div')).to_have_count(0)
    expect(page.locator('#photos img')).to_have_count(0)
    expect(page.locator('#speed')).to_have_text('0.0')
    corrected='去浮标门的绿标拍照'
    expect(page.locator('#suggestion-text')).to_have_text(corrected)
    expect(command).to_be_focused()
    page.keyboard.press('Tab')
    expect(command).to_have_value(corrected)
    expect(command).to_be_focused()
    expect(page.locator('#tasks > div')).to_have_count(0)
    command.press('Enter')
    expect(page.locator('#tasks > div').first).to_contain_text('浮标门绿标')
    expect(page.locator('.actuator-readout')).to_contain_text('海图定位浮标门绿标')
    send(wrong)
    expect(page.locator('#visible-task')).to_contain_text('原任务为浮标门绿标')
    expect(page.locator('#tasks > div')).to_have_count(1)
    photo=page.locator('#photos img').first
    photo.wait_for(state='attached',timeout=75000)
    expect(page.locator('#photos figcaption')).to_contain_text('浮标门绿标')
    jpeg=base64.b64decode(photo.get_attribute('src').split(',',1)[1])
    image=Image.open(io.BytesIO(jpeg)).convert('RGB')
    assert image.size==(720,405)
    region=image.crop((288,142,432,268))
    pixels=list(region.getdata())
    green=sum(g>r*1.45 and g>b*1.15 and g>35 for r,g,b in pixels)
    yellow=sum(r>g*.99 and g>b*1.8 and g>70 for r,g,b in pixels)
    assert green>len(pixels)*.15 and green>4*yellow,(green,yellow)
    (out/'gate-green.jpg').write_bytes(jpeg)
    page.locator('#reset').click()
    return {'rejected':wrong,'tab_accepted':corrected,'idle_dispatches':0,'existing_order_preserved':True,'photo_target':'浮标门绿标',
            'center_green_pixels':green,'center_yellow_pixels':yellow,'roi_pixels':len(pixels)}

def check_south_sky(page,out):
    page.locator('#pause').click()
    page.wait_for_timeout(180)
    yaw=math.radians(int(page.locator('#heading').inner_text()))
    # Aim the chase camera across the former south seam, including its 3 m forward look-at.
    azimuth=math.pi-math.asin(-3*math.sin(yaw)/8.25)
    dx=round(math.remainder(azimuth-yaw-.29,2*math.pi)/.008)
    canvas=page.locator('#world');box=canvas.bounding_box()
    x=box['x']+box['width']*.5;y=box['y']+box['height']*.50
    def drag(horizontal,vertical):
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+horizontal,y+vertical,steps=12);page.mouse.up()
        page.wait_for_timeout(150)
    # Lower the camera from 3.35 to 1.53 m so the sky covers the measured rows.
    drag(dx,-52)
    png=canvas.screenshot();image=Image.open(io.BytesIO(png)).convert('RGB');w,h=image.size
    jumps=[];sky_pixels=0;sample_count=0
    for i in range(round(w*.46),round(w*.54)):
        channel_differences=[]
        for j in range(round(h*.035),round(h*.14),2):
            rgb0,rgb1=image.getpixel((i-1,j)),image.getpixel((i,j))
            red,green,blue=rgb1
            sky_pixels+=blue>=red*.95 and blue>=green*.98 and blue>=160
            sample_count+=1
            channel_differences.append(max(abs(a-b) for a,b in zip(rgb0,rgb1)))
        jumps.append(statistics.median(channel_differences))
    jump=max(jumps)
    drag(-dx,52);page.locator('#pause').click()
    sky_fraction=round(sky_pixels/sample_count,3)
    assert sky_fraction>=.8,('sampled region must show sky',sky_fraction)
    assert jump<=24,jump
    (out/'sky-south.png').write_bytes(png)
    return {'view':'south meridian from pier inspection','sky_fraction_in_sample':sky_fraction,
            'max_median_column_jump_8bit':jump,'screenshot':'sky-south.png'}

def check_fleet(page,out):
    page.locator('#reset').click()
    page.locator('#fleet-order').click()
    expect(page.locator('#fleet-mode')).to_have_value('dual')
    expect(page.locator('#link-status')).to_contain_text('链路在线')
    expect(page.locator('#fleet-roster [data-vessel=A]')).to_contain_text('防波堤黄标')
    expect(page.locator('#fleet-roster [data-vessel=B]')).to_contain_text('栈桥黄标')
    page.locator('#follow-boat').select_option('B')
    expect(page.locator('#bow-title')).to_contain_text('B 艇')
    expect(page.locator('#visible-task')).to_contain_text('栈桥黄标')
    expect(page.locator('#policy-rate')).not_to_have_text('—',timeout=5000)
    expect(page.locator('.actuator-readout')).to_contain_text('快门 关闭')
    second_rate=page.locator('#policy-rate').inner_text()
    page.locator('#follow-boat').select_option('A')
    if page.locator('.model-inspector').get_attribute('open') is not None:page.locator('.model-inspector summary').click()
    page.locator('#task-tab').click()
    page.locator('.workbench').evaluate('el=>el.scrollTop=0')
    page.wait_for_timeout(2000)
    first_rate=page.locator('#policy-rate').inner_text()
    page.screenshot(path=str(out/'fleet-desktop.png'))
    patrol_photos={}
    for vessel,target in [('A','防波堤黄标'),('B','栈桥黄标')]:
        page.locator('#follow-boat').select_option(vessel)
        row=page.locator('#tasks > div').filter(has_text=target+' · 抵近观察')
        expect(row).to_contain_text('已完成',timeout=100000)
        expect(page.locator('#photos img')).to_have_count(0)
        patrol_photos[vessel]=page.locator('#photos img').count()
    page.locator('#follow-boat').select_option('A')
    page.locator('#command').fill('双艇分别给木栈桥和防波堤旁的黄标拍照')
    page.locator('#command').press('Enter')
    def read_gallery():
        page.wait_for_function("""()=>document.querySelectorAll('#photos figure img[src^="data:image/jpeg"]').length===2""",timeout=100000)
        data=page.locator('#photos figure').evaluate_all("""figs=>figs.map(f=>({id:f.dataset.photo,
          boat:f.dataset.vessel,caption:f.querySelector('figcaption').textContent,src:f.querySelector('img').src}))""")
        for item in data:
            jpeg=base64.b64decode(item.pop('src').split(',',1)[1]);image=Image.open(io.BytesIO(jpeg))
            assert image.size==(720,405)
            item['sha256']=hashlib.sha256(jpeg).hexdigest()
        return sorted(data,key=lambda x:x['id'])
    gallery_a=read_gallery()
    page.locator('#follow-boat').select_option('B')
    gallery_b=read_gallery()
    assert [x['sha256'] for x in gallery_a]==[x['sha256'] for x in gallery_b]
    assert len(set(x['sha256'] for x in gallery_a))==2
    assert 'B艇回传' in gallery_a[1]['caption'] and 'A艇回传' in gallery_b[0]['caption']
    page.locator('#reset').click()
    page.locator('[data-fleet-command]').click()
    expect(page.locator('#fleet-roster [data-vessel=B]')).to_contain_text('等候首艇回传')
    relay_gallery=read_gallery()
    expect(page.locator('#fleet-messages')).to_contain_text('已根据首拍方位派发侧拍')
    assert '侧面' in relay_gallery[1]['caption'] and '全景' in relay_gallery[0]['caption']
    page.locator('#photo-tab').click()
    page.locator('.fleet-comms summary').click()
    page.locator('.workbench').evaluate('el=>el.scrollTop=0')
    page.screenshot(path=str(out/'fleet-handoff.png'))
    # Two distinct commands entered without waiting for the first classifier result.
    page.evaluate("""() => {const el=document.querySelector('#command'), send=document.querySelector('#send');
        el.value='A艇检查防波堤黄标';send.click();el.value='B艇返航';send.click()}""")
    expect(page.locator('#fleet-roster [data-vessel=A]')).to_contain_text('防波堤黄标')
    expect(page.locator('#fleet-roster [data-vessel=B]')).to_contain_text('西泊位')
    page.locator('#fleet-mode').select_option('single')
    expect(page.locator('#follow-boat')).to_have_value('A');expect(page.locator('#follow-boat')).to_be_disabled()
    expect(page.locator('#fleet-panel')).to_be_hidden()
    return {'split_rate_hz':{'A':first_rate,'B':second_rate},'default_patrol_photos':patrol_photos,'shared_jpegs':gallery_a,'relay_jpegs':relay_gallery,'consecutive_addressed_orders':True,'single_mode_restored':True}

def run(exe,out,keep=False,command_check=None):
    exe=exe.resolve();out=out.resolve();out.mkdir(parents=True,exist_ok=True)
    try:u.SetProcessDpiAwarenessContext(ctypes.c_void_p(-4))
    except (AttributeError,OSError):pass
    with socket.socket() as s:s.bind(('127.0.0.1',0));port=s.getsockname()[1]
    cache=Path('.training-cache/qa').resolve();cache.mkdir(parents=True,exist_ok=True)
    cwd=Path(tempfile.mkdtemp(prefix='desktop-',dir=cache))
    env=os.environ.copy();env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS']=f'--remote-debugging-port={port} --remote-debugging-address=127.0.0.1'
    env['WEBVIEW2_USER_DATA_FOLDER']=str(cwd/'profile')
    app=subprocess.Popen([str(exe)],cwd=cwd,env=env);hwnd=None
    try:
        url=f'http://127.0.0.1:{port}';deadline=time.monotonic()+40
        while time.monotonic()<deadline:
            if app.poll() is not None:raise RuntimeError('Native launch exited '+str(app.returncode))
            try:
                with urlopen(url+'/json/version',timeout=.6):break
            except OSError:time.sleep(.2)
        with sync_playwright() as p:
            browser=p.chromium.connect_over_cdp(url,timeout=12000)
            context=browser.contexts[0];page=context.pages[0] if context.pages else context.wait_for_event('page')
            errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            expect(page.locator('#mode')).to_have_text('模型就绪',timeout=45000)
            expect(page.locator('#send')).to_be_enabled()
            assert page.title()=='基于OpenVLA的无人艇巡检模拟'
            init,hwnd=bounds(app.pid);assert init['covers_monitor'],init
            if command_check is not None:
                return command_check(page)
            suggestions=check_command_suggestions(page)
            page.locator('#pause').click()
            full_bow=bow_probe(page)
            orbit=check_horizontal_orbit(page)
            page.locator('#fullscreen').click()
            expect(page.locator('#fullscreen')).to_have_attribute('aria-pressed','false')
            time.sleep(.35);small,_=bounds(app.pid);assert not small['covers_monitor'],small
            window_bow=bow_probe(page)
            assert window_bow['panel']!=full_bow['panel']
            page.locator('#fullscreen').click()
            expect(page.locator('#fullscreen')).to_have_attribute('aria-pressed','true')
            time.sleep(.35);big,_=bounds(app.pid);assert big['covers_monitor'],big
            restored_bow=bow_probe(page);assert restored_bow['panel']==full_bow['panel']
            page.locator('#pause').click()
            planned=check_route_before_departure(page,out)
            observation=check_navigation_without_photos(page)
            withdrawn=check_shutter_withdrawal(page)
            marker=check_marker_grounding(page,out)
            times=[];seq=['先查木栈桥旁的黄标','改去防波堤旁那座，栈桥留到回程','去西泊位','回东泊位','去防波堤旁的黄标拍照','去木桥附近那颗拍照','检查石堤边那座','去木栈桥旁的黄标拍照']
            for sentence in seq:
                prev=page.locator('#logs').text_content()
                box=page.locator('#command');box.fill(sentence);box.press('Enter')
                expect(page.locator('#logs')).not_to_have_text(prev,timeout=15000)
                expect(page.locator('#logs > div').first).to_contain_text('首条控制量',timeout=15000)
                value=page.locator('#logs > div').first.inner_text();import re
                times.append(int(re.search(r'(\d+) ms',value).group(1)))
            page.locator('.model-inspector summary').click()
            page.locator('#photos img[src^="data:image/jpeg"]').first.wait_for(state='attached',timeout=100000)
            sky=check_south_sky(page,out)
            page.screenshot(path=str(out/'desktop.png'),timeout=25000)
            page.locator('#photo-tab').click();im=page.locator('#photos img').first;im.click()
            photo_data=page.locator('dialog[open] img').get_attribute('src').split(',',1)[1]
            assert Image.open(io.BytesIO(base64.b64decode(photo_data))).size==(720,405)
            with page.expect_download(timeout=12000) as download_event:
                page.locator('dialog .download-photo').click()
            output_photo=cwd/'saved-photo.jpg'
            download_event.value.save_as(output_photo)
            assert output_photo.read_bytes()==base64.b64decode(photo_data)
            page.keyboard.press('Escape')
            rate=page.locator('#policy-rate').inner_text();latency=page.locator('#latency').inner_text()
            page.locator('#reset').click();page.locator('#compare').click()
            assert page.locator('#compare').get_attribute('aria-pressed')=='true'
            page.locator('#compare').click()
            fleet=check_fleet(page,out)
            report={'exe':exe.name,'exe_sha256':hashlib.sha256(exe.read_bytes()).hexdigest(),'page_title':page.title(),'origin':page.url,'initial':init,'windowed':small,'restored':big,'command_response_ms':times,'saved_jpeg_verified':True,
                    'median_ms':statistics.median(times),'maximum_ms':max(times),'last_rate_hz':rate,'last_navigation_ms':latency,'snapshot_width':720,'snapshot_height':405,'compare_after_reset':True,'bow_while_paused':{'fullscreen':full_bow,'windowed':window_bow,'restored':restored_bow},'horizontal_orbit':orbit,'navigation_without_photos':observation,'fleet':fleet,'page_errors':errors}
            report.update(command_suggestions=suggestions,marker_grounding=marker,south_sky=sky,withdrawn_shutter=withdrawn,route_before_departure=planned)
            (out/'desktop.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
            print(json.dumps(report,ensure_ascii=True),flush=True)
            assert not errors,errors
    finally:
        if not keep and app.poll() is None:
            if hwnd:u.PostMessageW(hwnd,0x0010,0,0)
            else:app.terminate()
            try:app.wait(timeout=6)
            except subprocess.TimeoutExpired: app.terminate()
if __name__=='__main__':
    a=argparse.ArgumentParser();a.add_argument('--exe',type=Path,default=Path('基于OpenVLA的无人艇巡检模拟.exe'));a.add_argument('--out',type=Path,default=Path('verification'))
    opts=a.parse_args();run(opts.exe,opts.out)
