import argparse, json, time
from pathlib import Path
import numpy as np
import torch
from torch import nn
from models import Navigation, Language, LABELS
from corpus import language_rows
from demonstrations import trajectories, teacher

def language_training(data,out,device):
    # WordPiece vocabulary contains U+2028 / U+2029 as valid tokens.
    # Only LF delimits entries, exactly as in the deployed tokenizer.
    vocab={v:i for i,v in enumerate((data/'vocab.txt').read_text(encoding='utf8').rstrip('\n').split('\n'))}
    rows,tests=language_rows(vocab)
    ids=torch.tensor([x for x,_ in rows],device=device)
    labels=torch.tensor([y for _,y in rows],device=device)
    model=Language()
    model.pretrained(torch.load(data/'pytorch_model.bin',map_location='cpu',weights_only=True))
    model.to(device)
    opt=torch.optim.AdamW([{'params':model.head.parameters(),'lr':.0015},
        {'params':[p for k,p in model.named_parameters() if not k.startswith('head.')],'lr':.00014}],weight_decay=.01)
    for step in range(360):
        j=torch.randint(len(rows),(64,),device=device)
        loss=nn.functional.cross_entropy(model(ids[j]),labels[j])
        opt.zero_grad(set_to_none=True);loss.backward()
        nn.utils.clip_grad_norm_(model.parameters(),1);opt.step()
        if step in (0,119,239,359):print('language',step+1,round(loss.item(),5),flush=True)
    model.eval()
    with torch.no_grad():p=model(torch.tensor([v for _,v,_ in tests],device=device)).argmax(-1).cpu().tolist()
    results=[{'text':s,'expected':LABELS[y],'predicted':LABELS[g]} for (s,_,y),g in zip(tests,p)]
    torch.save(model.cpu().state_dict(),out/'language.pt')
    return {'train_clauses':len(rows),'holdout_correct':sum(r['expected']==r['predicted'] for r in results),
            'holdout_total':len(tests),'held_examples':results}

def navigation_training(data,out,device):
    rng=np.random.default_rng(541)
    gs,ys=trajectories(541,768)
    validation,vlabels=trajectories(918,96)
    bank=np.fromfile(data/'visual.bank',dtype='uint8').reshape(4,80,20,20,3)
    bank=torch.tensor(bank.copy(),device=device).permute(0,1,4,2,3).float()/255
    model=Navigation()
    weights=torch.load(data/'mobilenet_v3_small.pth',map_location='cpu',weights_only=True)
    model.stem.weight.data.copy_(weights['features.0.0.weight'])
    model.to(device);opt=torch.optim.AdamW(model.parameters(),lr=.002,weight_decay=.0001)
    g=torch.from_numpy(gs).to(device); y=torch.from_numpy(ys).long().to(device)
    centres=model.centres
    def batch(n,valid=False):
        if valid:
            idx=rng.integers(len(vlabels),size=n);l=torch.tensor(vlabels[idx],device=device);geo=torch.tensor(validation[idx],device=device)
        else:
            idx=torch.randint(len(y),(n,),device=device);l=y[idx];geo=g[idx].clone()
            # Equal coverage around the stop boundary and after mid-course redirections.
            k=n//2; ang=(torch.rand(k,4,device=device)*2-1)*np.pi
            precise=k//2
            ang[:precise]*=.16
            margins=(torch.rand(k,4,device=device)*7-2)
            margins[:precise]=torch.rand(precise,4,device=device)*3.0-1.25
            geo[:k,:,0]=ang/np.pi;geo[:k,:,1]=ang.sin();geo[:k,:,2]=ang.cos()
            geo[:k,:,3]=margins/16;geo[:k,:,4]=torch.rand(k,4,device=device)
            geo[:precise,:,4]*=.35
        idx=torch.arange(n,device=device)
        sel=geo[idx,l]
        ang=sel[:,0]*np.pi; margin=sel[:,3]*16
        speed=((margin-.08)/3.8).clamp(0,1)*((ang.cos()-.12)/.88).clamp(0,1).square()
        turn=(ang*1.8/1.42).clamp(-1,1)
        photo=((ang.abs()<.22)&(margin.abs()<1.12)&(sel[:,4]*4<.82)).float()
        acts=torch.stack((speed*2-1,turn),1)
        lang=nn.functional.one_hot(l,4).float()
        shuf=torch.rand(n,4,device=device).argsort(1)
        views=torch.randint(64,80,(n,4),device=device) if valid else torch.randint(0,64,(n,4),device=device)
        crops=bank[shuf,views]
        if not valid:
            crops=(crops*(.92+torch.rand(n,4,1,1,1,device=device)*.16)+torch.randn_like(crops)*.013).clamp(0,1)
        return crops,geo[idx[:,None],shuf],lang,shuf,acts,photo
    for step in range(1850):
        if step==1150:
            for group in opt.param_groups:group['lr']=.00065
        crops,geo,lang,order,acts,photo=batch(96)
        logits,focus,motor,shutter,means=model.compute(crops,geo,lang)
        # Same continuous action -> uniform bin as OpenVLA ActionTokenizer.
        bins=((acts+1)*127.5).floor().long().clamp(0,254)
        loss=.65*nn.functional.cross_entropy(logits.flatten(0,1),order.flatten())+ \
            .055*nn.functional.cross_entropy(motor.flatten(0,1),bins.flatten())+ \
            nn.functional.smooth_l1_loss(means,acts,beta=.04)+ \
            .13*nn.functional.binary_cross_entropy_with_logits(shutter[:,0],photo)
        opt.zero_grad(set_to_none=True);loss.backward();nn.utils.clip_grad_norm_(model.parameters(),4);opt.step()
        if (step+1)%250==0:print('navigation',step+1,round(loss.item(),5),flush=True)
    model.eval();correct=0;mae=torch.zeros(2,device=device);sh_ok=0;total=0
    with torch.no_grad():
        for _ in range(24):
            crops,geo,lang,order,acts,photo=batch(128,True)
            outact,focus=model(crops,geo,lang);n=len(acts);total+=n
            correct+=(order[torch.arange(n,device=device),focus.argmax(1)]==lang.argmax(1)).sum().item()
            mae+=(outact[:,:2]-acts).abs().sum(0)
            sh_ok+=((outact[:,2]>.5)==photo.bool()).sum().item()
    torch.save(model.cpu().state_dict(),out/'navigation.pt')
    return {'training_episodes':768,'train_frames':len(gs),'holdout_episodes':96,
            'heldout_view_ids':list(range(64,80)),'sampled_validation_frames':total,'grounding_accuracy':correct/total,
            'normalized_action_mae':(mae/total).cpu().tolist(),'shutter_accuracy':sh_ok/total}

if __name__=='__main__':
    cli=argparse.ArgumentParser();cli.add_argument('--data',type=Path,required=True);cli.add_argument('--out',type=Path,required=True)
    args=cli.parse_args();args.out.mkdir(parents=True,exist_ok=True)
    torch.manual_seed(541);torch.set_num_threads(2);torch.backends.cuda.matmul.allow_tf32=True
    start=time.time();dev=torch.device('cuda');report={'gpu':torch.cuda.get_device_name(0),'torch':torch.__version__,'seed':541}
    report['language']=language_training(args.data,args.out,dev)
    (args.out/'run.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    report['navigation']=navigation_training(args.data,args.out,dev)
    report['elapsed_seconds']=round(time.time()-start,2)
    report['peak_allocated_mib']=round(torch.cuda.max_memory_allocated()/2**20,1)
    (args.out/'run.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print('finished',report['elapsed_seconds'],flush=True)
