"""Fetch the exact published initial weights used by this run; keep downloads outside the app bundle."""
import argparse, hashlib
from pathlib import Path
from urllib.request import urlopen
FILES={
 'pytorch_model.bin':('https://huggingface.co/uer/chinese_roberta_L-2_H-128/resolve/main/pytorch_model.bin','194e5adf1875070804fb6117eb52f66be1fbcfb6a0f04c885e1f85f707ea423c'),
 'vocab.txt':('https://huggingface.co/uer/chinese_roberta_L-2_H-128/resolve/main/vocab.txt','f7863b040bae29ac474065729355252248c92d41141c1e09fbf21dd3e593a238'),
 'mobilenet_v3_small.pth':('https://download.pytorch.org/models/mobilenet_v3_small-047dcff4.pth','047dcff4addef86ea5bc2eff13c9614dc11f47ab1160d0a71a25e7db994f4e1f')}
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,default=Path('.training-cache/base'));a=p.parse_args();a.out.mkdir(parents=True,exist_ok=True)
    for name,(url,digest) in FILES.items():
        target=a.out/name;data=target.read_bytes() if target.is_file() else None
        if data is None or hashlib.sha256(data).hexdigest()!=digest:
            with urlopen(url,timeout=90) as response:data=response.read()
            if hashlib.sha256(data).hexdigest()!=digest:raise ValueError('Digest mismatch for '+name)
            temp=target.with_suffix(target.suffix+'.part');temp.write_bytes(data);temp.replace(target)
        print(name,len(data))
