import argparse, json, shutil
from pathlib import Path
import numpy as np
import torch
import onnx
import onnxruntime as ort
from models import Language, Navigation, WORDS
from export_pilot import export_pilot

def main(data,out):
    torch.set_num_threads(1);errors={}
    for name,model,inputs,ins,outs in [
        ('language',Language(),(torch.randint(150,400,(1,WORDS)),),['ids'],['logits']),
        ('navigation',Navigation(),(torch.rand(1,4,3,20,20),torch.rand(1,4,5),torch.tensor([[1.,0,0,0]])),['crops','geometry','instruction'],['control','focus'])]:
        model.load_state_dict(torch.load(out/(name+'.pt'),map_location='cpu',weights_only=True));model.eval()
        path=out/(name+'.onnx')
        torch.onnx.export(model,inputs,path,opset_version=17,input_names=ins,output_names=outs,do_constant_folding=True)
        onnx.checker.check_model(str(path))
        session=ort.InferenceSession(str(path),providers=['CPUExecutionProvider'])
        with torch.no_grad():ref=model(*inputs)
        if isinstance(ref,torch.Tensor):ref=(ref,)
        results=session.run(None,{k:v.numpy() for k,v in zip(ins,inputs)})
        errors[name]=max(float(np.abs(a-b.numpy()).max()) for a,b in zip(results,ref))
        if errors[name]>.00025:raise RuntimeError((name,errors[name]))
    export_pilot(out)
    shutil.copyfile(data/'vocab.txt',out/'vocab.txt')
    report=json.loads((out/'run.json').read_text(encoding='utf8'));report['onnx_parity_max_abs']=errors
    (out/'run.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print('ONNX validated',errors,flush=True)
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--data',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();main(a.data,a.out)
