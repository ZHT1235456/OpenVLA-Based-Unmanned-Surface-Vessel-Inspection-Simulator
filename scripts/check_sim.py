import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright
def run(url,path,kind='single'):
    with sync_playwright() as p:
        browser=p.chromium.launch(channel="msedge",headless=True,args=["--enable-webgl","--ignore-gpu-blocklist"])
        page=browser.new_page()
        # A minimal test document avoids rendering the entire workstation while fast-forwarding simulations.
        page.route("**/check-port",lambda r:r.fulfill(status=200,content_type="text/html",body="<title>Closed loop validation</title>"))
        page.goto(url+"/check-port")
        suite,entry={'single':('/test/closed-loop.js','checkRuns'),'fleet':('/test/fleet-loop.js','checkFleet'),
                     'sky':('/test/sky-wrap.js','checkSkyWrap')}[kind]
        results=page.evaluate("async ([path, entry]) => (await import(path))[entry]()", [suite,entry])
        browser.close()
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding="utf8")
    print({t['id']:t['pass'] for t in results})
    if not all(t['pass'] for t in results):raise SystemExit(1)
if __name__=="__main__":
    a=argparse.ArgumentParser();a.add_argument("--url",default="http://127.0.0.1:5186");a.add_argument("--out")
    g=a.add_mutually_exclusive_group();g.add_argument("--fleet",dest="kind",action="store_const",const="fleet");g.add_argument("--sky",dest="kind",action="store_const",const="sky")
    a.set_defaults(kind="single");opts=a.parse_args()
    filename={'single':'closed-loop','fleet':'fleet','sky':'sky'}[opts.kind]
    run(opts.url,opts.out or f'verification/{filename}.json',opts.kind)
