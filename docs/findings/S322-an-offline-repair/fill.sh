#!/bin/sh
# In the VM's root: fill its data disk as the lane VM's was found: every
# chunk allocated, data chunks half empty, metadata at ENOSPC.
W=/var/lib/lanehost/fill; mkdir -p $W/big $W/small
i=0; while [ $i -lt 4000 ] && dd if=/dev/zero of=$W/big/$i bs=1M count=1 2>/dev/null; do i=$((i+1)); done; sync
j=0; while [ $j -lt $i ]; do rm -f $W/big/$j; j=$((j+2)); done; sync
n=0; while [ $n -lt 500000 ]; do mkdir -p $W/small/$((n/1000)) 2>/dev/null; head -c 1000 /dev/urandom > $W/small/$((n/1000))/$n 2>/dev/null || break; n=$((n+1)); done
sync; echo "data files $i, inline files $n"; btrfs filesystem usage -T /var/lib/lanehost | sed -n '2,4p;14,20p'
