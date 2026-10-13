# S177's cases, pasted into the observer suite's guest init
# (packages/lanehost/observer/suite/init) after its lanes are registered,
# before `step flush`, with dash, strace and eintr in the guest: see
# README in this folder. Disposable.
step probe
mkdir -p /w/p
# S170's dash loop: a redirection right after killing a background job.
for where in run none; do
  if [ $where = run ]; then
    inrun $PA 30 dash -c 'f=0; i=0; while [ $i -lt 3000 ]; do sleep 1 & kill $!; echo $i > /w/p/x || f=$((f+1)); i=$((i+1)); done; echo $f' > /tmp/dash.$where 2>&1
  else
    outside $PA dash -c 'f=0; i=0; while [ $i -lt 3000 ]; do sleep 1 & kill $!; echo $i > /w/p/y || f=$((f+1)); i=$((i+1)); done; echo $f' > /tmp/dash.$where 2>&1
  fi
  say dash $where "$(tail -1 /tmp/dash.$where)"
done
# S170's per-call EINTR count, a SIGALRM every 50 µs, in a run and outside.
inrun $PA 31 eintr /w/p 5000 > /tmp/eintr.run 2>&1
say eintr run "$(tr '\n' ' ' < /tmp/eintr.run)"
outside $PA eintr /w/p 5000 > /tmp/eintr.none 2>&1
say eintr none "$(tr '\n' ' ' < /tmp/eintr.none)"
# strace inside a run, its traced command's write still the run's.
inrun $PA 32 strace -f -o /tmp/trace sh -c 'echo t > /w/p/traced.txt'
say strace $? $(grep -c openat /tmp/trace)
