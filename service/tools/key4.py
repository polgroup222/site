import sys, subprocess, numpy as np, cv2
src,out=sys.argv[1],sys.argv[2]
W,H=1920,1080
p=subprocess.Popen(['ffmpeg','-v','error','-i',src,'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
F=[np.frombuffer(p.stdout.read(W*H*3),np.uint8).reshape(H,W,3) for _ in range(96)]
clean=np.median(np.stack(F[-8:]).astype(np.float32),0)
static=np.load(out+'/static.npy'); st8=static.astype(np.uint8)
def ratios(x):
    x=cv2.GaussianBlur(x.astype(np.float32),(5,5),0)
    r=x[...,0]+1; return x[...,1]/r, x[...,2]/r, x.mean(-1)
crg,crb,cl=ratios(clean)
def ss(x,a,b): t=np.clip((x-a)/(b-a),0,1); return t*t*(3-2*t)
holes=[]
for i,f in enumerate(F):
    rg,rb,l=ratios(f)
    dc=np.maximum(np.abs(rg-crg)/0.07, np.abs(rb-crb)/0.08)
    lr=l/(cl+1)
    x=cv2.GaussianBlur(f.astype(np.float32),(3,3),0); r=x[...,0]+1
    strong=(((x[...,1]/r)<0.4)&(x[...,0]>40)) | (((x[...,1]/r)>0.86)&(x.mean(-1)>120))
    strong=cv2.morphologyEx(strong.astype(np.uint8),cv2.MORPH_OPEN,np.ones((3,3),np.uint8))
    zone=cv2.GaussianBlur(cv2.dilate(strong,np.ones((31,31),np.uint8)).astype(np.float32),(15,15),0)
    tol=1.0-0.6*zone
    trans=(1-ss(dc/tol,0.8,1.1))*ss(lr,0.55,0.7)*(1-ss(lr,1.12+0*zone,1.2))
    trans=trans*(1-strong)
    trans*=static
    hard=(trans>0.5).astype(np.uint8)
    n,lab,stt,_=cv2.connectedComponentsWithStats(hard,8)
    for k in range(1,n):
        m=lab==k
        if stt[k,4]<300 or (stt[k,4]<2500 and zone[m].mean()>0.6): trans[m]=0
    hc=(trans>0.5).astype(np.uint8)
    trans=trans*cv2.dilate(hc,np.ones((5,5),np.uint8))
    opq=((trans<=0.5)&static).astype(np.uint8)
    n,lab,stt,_=cv2.connectedComponentsWithStats(opq,8)
    for k in range(1,n):
        if stt[k,4]<150: trans[lab==k]=1
    trans=cv2.GaussianBlur(trans.astype(np.float32),(3,3),0)*static
    holes.append(trans.astype(np.float16))
holes=np.stack(holes); np.save(out+'/holes.npy',holes)
print([round(float(h.astype(np.float32).sum()/static.sum()),3) for h in holes[::6]])
