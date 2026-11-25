"""Train the bow-camera cleanup policy from rendered demonstrations. Export with --export."""
import argparse
import json
import math
from pathlib import Path
import numpy as np
import torch
from torch import nn
import torch.nn.functional as F


HEIGHT, WIDTH = 40, 64  # half-resolution detection map


def conv(i, o, stride=1):
    return nn.Sequential(nn.Conv2d(i, o, 3, stride, 1, bias=False), nn.BatchNorm2d(o), nn.ReLU())


class CleanupPolicy(nn.Module):
    def __init__(self, vocab):
        super().__init__()
        self.local = nn.Sequential(conv(3,16),conv(16,20,2),conv(20,20))
        self.context = nn.Sequential(conv(20,28,2),conv(28,28),conv(28,28))
        self.head = nn.Sequential(conv(48,24),nn.Conv2d(24,2,1))
        nn.init.constant_(self.head[-1].bias,-3)
        self.language = nn.Sequential(nn.Linear(vocab,32),nn.ReLU(),nn.Linear(32,2))
        self.actor = nn.Sequential(nn.Linear(2,72),nn.ReLU(),nn.Linear(72,72),nn.ReLU(),nn.Linear(72,3))
        rows, cols = torch.meshgrid(torch.arange(HEIGHT),torch.arange(WIDTH),indexing='ij')
        self.register_buffer('u',(cols.flatten()+.5)/WIDTH)
        self.register_buffer('v',(rows.flatten()+.5)/HEIGHT)

    def vision(self,rgb):
        z=self.local(rgb)
        context=F.interpolate(self.context(z),scale_factor=2,mode='nearest')
        return self.head(torch.cat([z,context],dim=1))

    def decode(self,heat,words):
        allowed=torch.sigmoid(self.language(words))
        scores=torch.sigmoid(heat).flatten(2)*allowed.unsqueeze(2)
        strongest,material=scores.max(1)
        # Favor a nearer compatible object when several clear peaks are in view.
        index=(strongest*(.70+.30*self.v)).argmax(1,keepdim=True)
        confidence=strongest.gather(1,index)
        u=self.u[index];v=self.v[index]
        uv=torch.cat([u,v],dim=1)
        actions=self.actor((uv-.5)*3)
        control=torch.cat([torch.sigmoid(actions[:,0:1]),torch.tanh(actions[:,1:2]),
                           torch.sigmoid(actions[:,2:3])*confidence],dim=1)
        focus=torch.cat([confidence,uv,material.gather(1,index).float()],dim=1)
        return control,focus

    def forward(self,rgb,words):
        return self.decode(self.vision(rgb),words)


def tokens(text,alphabet):
    return [float(c in text) for c in alphabet]


def language_examples(alphabet):
    verbs=['收集','打捞','回收','清理','捡拾','捞起','清扫']
    types=[['塑料瓶','瓶子','空瓶','饮料瓶','矿泉水瓶','塑料瓶子'],
           ['泡沫','泡沫块','泡沫塑料块'],['漂浮物','漂浮垃圾','水面垃圾','塑料瓶和泡沫块','泡沫与瓶子','清漂']]
    rows=[];labels=[]
    for category,names in enumerate(types):
        for p in ['','只','帮我','请把','仅','请','先去']:
            for verb in verbs:
                for name in names:
                    rows.append(tokens(p+verb+name,alphabet))
                    labels.append([[1,0],[0,1],[1,1]][category])
    return torch.tensor(rows,device='cuda'),torch.tensor(labels,device='cuda',dtype=torch.float32)


def load_frames(root,split):
    files=sorted(root.glob(split+'-*.npz'))
    shards=[np.load(p) for p in files]
    rgb=torch.from_numpy(np.concatenate([s['rgb'] for s in shards])).to('cuda').permute(0,3,1,2)
    labels=torch.from_numpy(np.concatenate([s['labels'] for s in shards])).to('cuda')
    episodes=len(np.unique(np.concatenate([s['episodes'] for s in shards])))
    return rgb,labels,episodes


def imitation(forward,side):
    angle=torch.atan2(side,forward)
    speed=(.32+.48*(forward-1.5)).clamp(.30,2.7)*torch.cos(angle).pow(3).clamp_min(.12)
    turn=(1.9*angle/1.42).clamp(-1,1)
    gate=(forward>=1.2)&(forward<=2.52)&(side.abs()<.42)
    return speed/3.8,turn,gate


def make_maps(rows,x,y):
    u=(rows[:,:,1]*WIDTH).long().clamp(0,WIDTH-1)
    v=(rows[:,:,2]*HEIGHT).long().clamp(0,HEIGHT-1)
    d=(x-u[:,:,None,None]).square()+(y-v[:,:,None,None]).square()
    g=torch.exp(-.5*d/1.25**2)
    return torch.stack([(g*((rows[:,:,0]==k)&(rows[:,:,3]>0))[:,:,None,None]).amax(1) for k in [0,1]],1)


@torch.no_grad()
def evaluate(net,images,labels,alphabet):
    report={}
    for category,phrase in enumerate(['只捡拾水面上的空瓶子','请打捞港池里的泡沫块','收集所有水面漂浮物']):
        tp=fp=miss=none=wrong=gate_yes=gate_tp=gate_fp=0;speeds=[];turns=[]
        words=torch.tensor([tokens(phrase,alphabet)],device='cuda')
        for start in range(0,len(images),64):
            rgb=images[start:start+64].float()/255; rows=labels[start:start+64]
            action,focus=net(rgb,words.expand(len(rgb),-1))
            good=(rows[:,:,3]>0)&((rows[:,:,0]==category)|(category==2))
            du=(rows[:,:,1]-focus[:,1:2])*128;dv=(rows[:,:,2]-focus[:,2:3])*80
            delta=du.square()+dv.square()
            nearest=delta.masked_fill(~good,1e6).argmin(1)
            row=rows[torch.arange(len(rgb),device='cuda'),nearest]
            on=(focus[:,0]>=.55);present=good.any(1)
            match=(delta.masked_fill(~good,1e6).amin(1)<=5**2)&(focus[:,3]==row[:,0])&present
            tp+=int((on&match).sum());fp+=int((on&~match).sum());miss+=int((present&~(on&match)).sum())
            none+=int((~present).sum());wrong+=int((~present&on).sum())
            speed,turn,gate=imitation(row[:,3],row[:,4]);valid=on&match
            speeds+=((action[:,0]-speed).abs()[valid]*3.8).tolist()
            turns+=((action[:,1]-turn).abs()[valid]*1.42).tolist()
            gate_yes+=int((valid&gate).sum());gate_tp+=int((valid&gate&(action[:,2]>=.5)).sum())
            gate_fp+=int(((~(valid&gate))&(action[:,2]>=.5)).sum())
        report[phrase]=dict(frames=len(images),correct_localizations=tp,false_locks=fp,
            missed_visible_targets=miss,empty_or_other_material=none,false_locks_on_empty_or_other=wrong,
            precision=round(tp/max(1,tp+fp),4),recall=round(tp/max(1,tp+miss),4),
            speed_mae_m_s=round(float(np.mean(speeds)),4),turn_mae_rad_s=round(float(np.mean(turns)),4),
            aligned_gate_positives=gate_yes,true_gate_opens=gate_tp,false_gate_opens=gate_fp)
    return report


def main(args):
    alphabet=json.loads(args.lexicon.read_text(encoding='utf8'))['characters']
    net=CleanupPolicy(len(alphabet));args.out.mkdir(parents=True,exist_ok=True)
    if args.export:
        net.load_state_dict(torch.load(args.out/'cleanup.pt',map_location='cpu',weights_only=True))
        net.eval()
        torch.onnx.export(net,(torch.zeros(1,3,80,128),torch.ones(1,len(alphabet))),args.out/'cleanup.onnx',
                          opset_version=17,input_names=['rgb','words'],output_names=['control','focus'])
        return
    torch.manual_seed(2651);np.random.seed(2651)
    net=CleanupPolicy(len(alphabet)).cuda().to(memory_format=torch.channels_last)
    images,labels,episodes=load_frames(args.data,'train')
    validation,truth,test_episodes=load_frames(args.data,'holdout')
    words,meanings=language_examples(alphabet)
    opt=torch.optim.AdamW(net.parameters(),lr=.002,weight_decay=.0002)
    x=torch.arange(WIDTH,device='cuda').view(1,1,1,-1)
    y=torch.arange(HEIGHT,device='cuda').view(1,1,-1,1)
    centers=labels.reshape(-1,5);centers=centers[centers[:,3]>0]
    for step in range(args.steps):
        idx=torch.randint(len(images),(48,),device='cuda')
        rgb=images[idx].float()/255
        rgb=(rgb*(.90+.2*torch.rand(48,3,1,1,device='cuda'))+
             .035*(torch.rand(48,1,1,1,device='cuda')-.5)).clamp(0,1)
        targets=make_maps(labels[idx],x,y)
        logits=net.vision(rgb)
        p=logits.sigmoid(); pos=(targets==1)
        loss=((F.softplus(-logits)*(1-p).square()*pos).sum()+
              (F.softplus(logits)*p.square()*(1-targets).pow(4)*~pos).sum())/pos.sum().clamp_min(1)
        lang=torch.randint(len(words),(128,),device='cuda')
        loss+=F.binary_cross_entropy_with_logits(net.language(words[lang]),meanings[lang])
        rows=centers[torch.randint(len(centers),(320,),device='cuda')]
        uv=rows[:,1:3]+(torch.rand_like(rows[:,1:3])-.5)*.014
        act=net.actor((uv-.5)*3)
        speed,turn,gate=imitation(rows[:,3],rows[:,4])
        loss+=4*F.smooth_l1_loss(act[:,0].sigmoid(),speed,beta=.06)+3*F.smooth_l1_loss(act[:,1].tanh(),turn,beta=.08)
        loss+=F.binary_cross_entropy_with_logits(act[:,2],gate.float(),pos_weight=torch.tensor(2.,device='cuda'))
        opt.zero_grad(set_to_none=True);loss.backward();opt.step()
        if step in [args.steps*2//3,args.steps*9//10]:
            for group in opt.param_groups:group['lr']*=.37
        if step%150==0:print(step,round(float(loss),4),flush=True)
    net.eval()
    report=dict(seed=2651,torch=torch.__version__,gpu=torch.cuda.get_device_name(),steps=args.steps,
                train_episodes=episodes,train_frames=len(images),holdout_episodes=test_episodes,
                holdout_frames=len(validation),threshold=.55,match_radius_px=5,
                holdout=evaluate(net,validation,truth,alphabet))
    torch.save(net.cpu().state_dict(),args.out/'cleanup.pt')
    (args.out/'cleanup-training.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    print(json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--data',type=Path,default=Path('data'))
    p.add_argument('--out',type=Path,default=Path('out'))
    p.add_argument('--lexicon',type=Path,default=Path('cleanup-lexicon.json'))
    p.add_argument('--steps',type=int,default=1250)
    p.add_argument('--export',action='store_true')
    main(p.parse_args())
