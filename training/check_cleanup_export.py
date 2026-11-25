"""Check the deployed graph on held-out raw pixels and counterfactual Chinese instructions."""
import argparse
import hashlib
import json
from pathlib import Path
import numpy as np
import onnxruntime as ort
import torch
from cleanup_policy import CleanupPolicy, tokens


def check(root, data, lexicon):
    alphabet=json.loads(lexicon.read_text(encoding='utf8'))['characters']
    net=CleanupPolicy(len(alphabet))
    net.load_state_dict(torch.load(root/'cleanup.pt',map_location='cpu',weights_only=True))
    net.eval();torch.set_num_threads(1)
    opts=ort.SessionOptions();opts.intra_op_num_threads=1;opts.inter_op_num_threads=1
    path=root/'cleanup.onnx'
    session=ort.InferenceSession(str(path),opts,providers=['CPUExecutionProvider'])
    parity=0.;frames=mixed=switched=empty=false_open=0;best=-1.
    for shard in sorted(data.glob('holdout-*.npz')):
        batch=np.load(shard)
        for frame_index,(frame,labels) in enumerate(zip(batch['rgb'],batch['labels'])):
            frames+=1
            rgb=np.ascontiguousarray(frame.transpose(2,0,1)[None].astype(np.float32)/255)
            rows=labels[labels[:,3]>0]
            if not len(rows):empty+=1
            both=all(np.any(rows[:,0]==k) for k in (0,1))
            hits=[];points=[]
            for k,words in enumerate(['只收集塑料瓶','只收集泡沫块']):
                words=np.array([tokens(words,alphabet)],np.float32)
                actions,focus=session.run(None,{'rgb':rgb,'words':words})
                with torch.no_grad():ref=net(torch.from_numpy(rgb),torch.from_numpy(words))
                for a,b in zip([actions,focus],ref):
                    parity=max(parity,float(np.max(np.abs(a-b.numpy()))))
                score,u,v,kind=focus[0]
                points.append(focus[0].copy())
                distances=np.hypot((rows[:,1]-u)*128,(rows[:,2]-v)*80)
                hits.append(bool(score>=.55 and kind==k and np.any((rows[:,0]==k)&(distances<=5))))
                if not len(rows) and actions[0,2]>=.5:false_open+=1
            if both:
                mixed+=1
                if all(hits):
                    switched+=1
                    a,b=points
                    quality=min(a[2],b[2])+.3*abs(a[1]-b[1])
                    if quality>best and all(.09<p[1]<.91 and p[2]<.85 for p in points):
                        best=quality
                        np.savez(root/'cleanup-example.npz',rgb=frame,pred=points,
                                 shard=shard.name,index=frame_index)
    assert parity<2e-4 and mixed>0 and switched/mixed>.85 and false_open==0
    result=dict(onnx_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),frames=frames,
                command_pairs=frames,frames_with_both_materials=mixed,both_commands_localized_correctly=switched,
                empty_frames=empty,gate_requests_on_empty=false_open,pytorch_onnx_max_abs_error=parity)
    (root/'cleanup-export.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
    print(result)


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--out',type=Path,default=Path('out'));p.add_argument('--data',type=Path,default=Path('data'))
    p.add_argument('--lexicon',type=Path,default=Path('cleanup-lexicon.json'))
    a=p.parse_args();check(a.out,a.data,a.lexicon)
