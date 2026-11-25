"""Small domain policies. The action grid follows OpenVLA's 256-edge tokenizer."""
import math
import torch
from torch import nn

WORDS = 40
LABELS = ["pier", "wall", "east", "west", "current", "other", "previous", "unknown"]

class BertBlock(nn.Module):
    def __init__(self):
        super().__init__()
        self.q, self.k, self.v = [nn.Linear(128,128) for _ in range(3)]
        self.out = nn.Linear(128,128)
        self.first = nn.LayerNorm(128,eps=1e-12)
        self.ff = nn.Linear(128,512)
        self.back = nn.Linear(512,128)
        self.second = nn.LayerNorm(128,eps=1e-12)

    def forward(self,x,mask):
        def heads(layer):
            return layer(x).reshape(x.shape[0],-1,2,64).transpose(1,2)
        attention = (heads(self.q) @ heads(self.k).transpose(-2,-1))/8
        attention = (attention + (1-mask[:,None,None,:])*-10000).softmax(-1)
        merged = (attention @ heads(self.v)).transpose(1,2).reshape(x.shape[0],-1,128)
        hidden = self.first(x+self.out(merged))
        return self.second(hidden+self.back(nn.functional.gelu(self.ff(hidden))))

class Language(nn.Module):
    def __init__(self):
        super().__init__()
        self.word = nn.Embedding(21128,128)
        self.pos = nn.Embedding(512,128)
        self.typ = nn.Embedding(2,128)
        self.norm = nn.LayerNorm(128,eps=1e-12)
        self.blocks=nn.ModuleList([BertBlock() for _ in range(2)])
        self.head=nn.Linear(256,len(LABELS))

    def pretrained(self,state):
        def copy(module,prefix):
            module.weight.data.copy_(state[prefix+'.weight'])
            if getattr(module,'bias',None) is not None:module.bias.data.copy_(state[prefix+'.bias'])
        base='bert.embeddings.'
        for target,orig in [('word','word_embeddings'),('pos','position_embeddings'),('typ','token_type_embeddings'),('norm','LayerNorm')]:
            copy(getattr(self,target),base+orig)
        mapping={'q':'attention.self.query','k':'attention.self.key','v':'attention.self.value','out':'attention.output.dense','first':'attention.output.LayerNorm','ff':'intermediate.dense','back':'output.dense','second':'output.LayerNorm'}
        for i,block in enumerate(self.blocks):
            for target,orig in mapping.items():copy(getattr(block,target),f'bert.encoder.layer.{i}.'+orig)

    def forward(self,ids):
        mask=(ids!=0).float()
        x=self.norm(self.word(ids)+self.pos(torch.arange(WORDS,device=ids.device))[None]+self.typ.weight[0])
        for block in self.blocks:x=block(x,mask)
        avg=(x*mask[:,:,None]).sum(1)/mask.sum(1,keepdim=True).clamp(min=1)
        return self.head(torch.cat((x[:,0],avg),1))

class Navigation(nn.Module):
    def __init__(self):
        super().__init__()
        self.stem=nn.Conv2d(3,16,3,stride=2,padding=1,bias=False)
        self.vision=nn.Sequential(nn.BatchNorm2d(16),nn.Hardswish(),nn.Conv2d(16,24,3,padding=1),
            nn.SiLU(),nn.AvgPool2d(5),nn.Flatten(),nn.Linear(96,4))
        self.pilot=nn.Sequential(nn.Linear(5,96),nn.SiLU(),nn.Linear(96,96),nn.SiLU(),nn.Linear(96,64),nn.SiLU())
        self.motor=nn.Linear(64,2)
        self.shutter=nn.Linear(64,1)
        edges=torch.linspace(-1,1,256)
        self.register_buffer('centres',.5*(edges[:-1]+edges[1:]))

    def compute(self,crops,geometry,instruction):
        visual=self.vision(self.stem(crops.reshape(-1,3,20,20)*2-1)).reshape(-1,4,4)
        scores=(visual.log_softmax(-1)*instruction[:,None,:]).sum(-1)
        attention=(scores*2).softmax(-1)
        data=(geometry*attention[:,:,None]).sum(1)
        hidden=self.pilot(data)
        mean=self.motor(hidden).tanh()
        logits=-0.5*((mean[:,:,None]-self.centres)/.035).square()
        return visual,attention,logits,self.shutter(hidden),mean

    def forward(self,crops,geometry,instruction):
        _,focus,bins,photo,_=self.compute(crops,geometry,instruction)
        control=self.centres[bins.argmax(-1)]
        return torch.cat([control,photo.sigmoid()],dim=1),focus
