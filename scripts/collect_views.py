"""Capture optical training crops from the same Three.js fixture meshes and camera as the app."""
import argparse, base64
from pathlib import Path
from playwright.sync_api import sync_playwright

def collect(url, output):
    with sync_playwright() as p:
        browser=p.chromium.launch(channel="msedge",headless=True,args=["--enable-webgl","--ignore-gpu-blocklist"])
        page=browser.new_page()
        page.goto(url,wait_until="domcontentloaded")
        encoded=page.evaluate("""async () => {
          const {makeTrainingBank}=await import('/src/contacts.js');
          const a=makeTrainingBank(80);let b='';
          for(let i=0;i<a.length;i+=8192)b+=String.fromCharCode(...a.subarray(i,i+8192));
          return btoa(b);
        }""")
        browser.close()
    out=Path(output);out.parent.mkdir(parents=True,exist_ok=True);out.write_bytes(base64.b64decode(encoded))
    assert out.stat().st_size==4*80*20*20*3
    print(out, out.stat().st_size)
if __name__=="__main__":
    cli=argparse.ArgumentParser();cli.add_argument("--url",default="http://127.0.0.1:5186/");cli.add_argument("--output",default=".training-cache/visual.bank")
    a=cli.parse_args();collect(a.url,a.output)
