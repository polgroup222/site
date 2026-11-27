import sys, subprocess, numpy as np
src,out=sys.argv[1],sys.argv[2]
W,H=1920,1080
holes=np.load(out+'/holes.npy').astype(np.float32)
p=subprocess.Popen(['ffmpeg','-v','error','-i',src,'-f','rawvideo','-pix_fmt','rgb24','-'],stdout=subprocess.PIPE)
common=['-f','rawvideo','-s','1920x1080','-r','24']
g=subprocess.Popen(['ffmpeg','-v','error','-y',*common,'-pix_fmt','rgb24','-i','-','-c:v','prores_ks','-profile:v','3','-pix_fmt','yuv422p10le','-vendor','apl0',out+'/portret_zeleno_polotno.mov'],stdin=subprocess.PIPE)
a=subprocess.Popen(['ffmpeg','-v','error','-y',*common,'-pix_fmt','rgba','-i','-','-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le','-alpha_bits','8','-vendor','apl0',out+'/portret_prozore_polotno.mov'],stdin=subprocess.PIPE)
green=np.array([0,255,0],np.float32)
i=0; last=None
while True:
    b=p.stdout.read(W*H*3)
    if len(b)<W*H*3: break
    f=np.frombuffer(b,np.uint8).reshape(H,W,3).astype(np.float32)
    h=holes[i][...,None]
    gf=(f*(1-h)+green*h).round().astype(np.uint8)
    g.stdin.write(gf.tobytes())
    rgba=np.dstack([f.astype(np.uint8),((1-holes[i])*255).round().astype(np.uint8)])
    a.stdin.write(rgba.tobytes())
    if i in (0,40,48,95): np.save(out+f'/prev{i}.npy',gf)
    last=(gf,rgba); i+=1
g.stdin.close(); a.stdin.close(); g.wait(); a.wait()
from PIL import Image
Image.fromarray(last[1],'RGBA').save(out+'/portret_stopkadr_prozoryi.png')
Image.fromarray(last[0]).save(out+'/portret_stopkadr_zelenyi.png')
prev=[Image.fromarray(np.load(out+f'/prev{k}.npy')).resize((960,540)) for k in (0,40,48,95)]
sheet=Image.new('RGB',(1920,1080)); [sheet.paste(im,((j%2)*960,(j//2)*540)) for j,im in enumerate(prev)]
sheet.save(out+'/sheet.jpg'); print('frames',i)
