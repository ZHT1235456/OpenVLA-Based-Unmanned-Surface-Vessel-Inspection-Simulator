"""Render full, unlabeled bow RGB and separate teacher annotations; split by complete episode."""
import argparse
import base64
from pathlib import Path
import numpy as np
from playwright.sync_api import sync_playwright


def collect(args):
    args.out.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel='msedge', headless=True,
                                     args=['--enable-webgl', '--ignore-gpu-blocklist'])
        for split, count, seed in [('train', args.train, 42981), ('holdout', args.holdout, 85319)]:
            for shard in range(3):
                family='neighbor-' if args.neighbor else ''
                dest = args.out / f'{split}-{family}{shard}.npz'
                if dest.exists():
                    continue
                page = browser.new_page()
                page.goto(args.url + '/training/cleanup-views.js', wait_until='commit')
                page.evaluate("""async ([seed, layout, neighbor])=>{
                    const {cleanupTeacher}=await import('/training/cleanup-views.js');
                    window.teacher=cleanupTeacher(seed,layout,neighbor);
                    await new Promise(r=>setTimeout(r,350));
                }""", [seed+shard*593+(13981 if args.neighbor else 0), shard, args.neighbor])
                frames, labels, episodes = [], [], []
                for episode in range(shard, count, 3):
                    data = page.evaluate('() => teacher.episode()')
                    for raw, rows in data:
                        frames.append(np.frombuffer(base64.b64decode(raw), np.uint8).reshape(80,128,3))
                        target = np.zeros((5,5), dtype=np.float32)
                        if rows:
                            target[:len(rows)] = rows
                        labels.append(target)
                        episodes.append(episode+(100000 if args.neighbor else 0))
                    if len(frames) % 260 == 0:
                        print(split, shard, len(frames), flush=True)
                np.savez_compressed(dest, rgb=np.stack(frames), labels=np.stack(labels), episodes=episodes)
                print(dest.name, len(frames), dest.stat().st_size, flush=True)
                page.close()
        browser.close()


if __name__ == '__main__':
    p = argparse.ArgumentParser()
    p.add_argument('--url', default='http://127.0.0.1:5193')
    p.add_argument('--out', type=Path, default=Path('.training-cache/cleanup-vla/data'))
    p.add_argument('--train', type=int, default=270)
    p.add_argument('--holdout', type=int, default=60)
    p.add_argument('--neighbor', action='store_true')
    collect(p.parse_args())
