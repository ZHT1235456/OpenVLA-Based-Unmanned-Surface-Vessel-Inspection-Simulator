"""Generate imitation trajectories and displaced recovery states in the port's planar dynamics."""
import numpy as np

def geometry(boat,points,radii):
    dx=points[:,:,0]-boat[:,None,0];dz=points[:,:,1]-boat[:,None,1]
    delta=np.arctan2(dx,-dz)-boat[:,None,2]
    delta=(delta+np.pi)%(2*np.pi)-np.pi
    margin=np.sqrt(dx**2+dz**2)-radii
    return np.stack((delta/np.pi,np.sin(delta),np.cos(delta),np.clip(margin/16,-.6,2.8),np.broadcast_to(boat[:,None,3]/4,margin.shape)),axis=-1).astype('f')

def teacher(g):
    err=g[:,0]*np.pi; margin=g[:,3]*16;speed=g[:,4]*4
    turn=np.clip(err*1.8/1.42,-1,1)
    throttle=np.clip((margin-.08)/3.8,0,1)*np.clip((np.cos(err)-.12)/.88,0,1)**2
    shutter=(np.abs(err)<.22)&(np.abs(margin)<1.12)&(speed<.82)
    return np.stack((throttle*2-1,turn,shutter),axis=1).astype('f')

def trajectories(seed,n,steps=92):
    rng=np.random.default_rng(seed); idx=np.arange(n);geom=[];targets=[]
    sign=rng.choice([-1.,1.],n)
    points=np.stack((np.stack((sign*rng.uniform(9,17,n),rng.uniform(-13,-1,n)),1),
          np.stack((-sign*rng.uniform(9,17,n),rng.uniform(-14,-3,n)),1),
          np.stack((rng.uniform(14,21,n),rng.uniform(20,29,n)),1),
          np.stack((rng.uniform(-21,-14,n),rng.uniform(20,29,n)),1)),1)
    radii=np.broadcast_to([4.2,4.2,1.35,1.35],(n,4))
    boat=np.stack((rng.uniform(-9,9,n),rng.uniform(11,29,n),rng.uniform(-2.6,2.6,n),rng.uniform(0,.8,n)),1)
    label=rng.integers(0,4,n);switch=rng.integers(15,69,n)
    for j in range(steps):
        changes=switch==j;label[changes]=(label[changes]+rng.integers(1,4,changes.sum()))%4
        g=geometry(boat,points,radii)
        geom.append(g);targets.append(label.copy());a=teacher(g[idx,label])
        dt=.30
        boat[:,3]+= (3.8*(a[:,0]+1)/2-boat[:,3])*(1-np.exp(-dt/.5))
        boat[:,2]+= a[:,1]*1.42*dt
        boat[:,0]+= (np.sin(boat[:,2])*boat[:,3]+.025*np.sin(j*.28))*dt
        boat[:,1]-= np.cos(boat[:,2])*boat[:,3]*dt
    return np.concatenate(geom),np.concatenate(targets)
