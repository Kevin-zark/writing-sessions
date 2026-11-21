import subprocess, sys, glob, os, numpy as np
def frame(path, last=False, still=False):
    args=['ffmpeg','-v','error']+(['-sseof','-0.1'] if last else [])+['-i',path,'-frames:v','1','-vf','scale=160:90,format=gray','-f','rawvideo','-']
    return np.frombuffer(subprocess.run(args,capture_output=True).stdout,np.uint8).astype(float)
stills={os.path.basename(s)[:-4]:frame(s) for s in glob.glob('' + (os.environ.get('STILLS', '/workspace/dat2/stills')) + '/*.jpg') if 'master' not in s}
def best(f): return min(stills.items(), key=lambda kv: ((kv[1]-f)**2).mean())[0]
for p in sys.argv[1:]:
    print(os.path.basename(p)[:12], best(frame(p)), '->', best(frame(p,True)))
