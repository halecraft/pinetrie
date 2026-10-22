L=/tmp/sig-$1; : > $L
for s in HUP INT PIPE TERM USR1; do trap "echo sig-$s >> $L" $s; done
while read -r l; do echo "line $l" >> $L; done
echo stdin-ended >> $L
i=0; while [ $i -lt 20 ]; do sleep 1; i=$((i+1)); echo "alive $i" >> $L; done
echo done >> $L
