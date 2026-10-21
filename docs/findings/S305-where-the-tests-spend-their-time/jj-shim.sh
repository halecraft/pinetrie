#!/bin/sh
# Put first on PATH as `jj` (and a copy as `git`, calling git's real path):
# each call's duration and first words go to $SHIMLOG.
S=$(date +%s%N)
/usr/local/bin/jj "$@"; r=$?
c=""; skip=0
for a in "$@"; do if [ $skip = 1 ]; then skip=0; continue; fi; case "$a" in -R|--config|--repository|-T|-r) skip=1;; -*) ;; *) c="$c$a "; [ ${#c} -gt 14 ] && break;; esac; done
echo "jj $(( ($(date +%s%N)-S)/1000000 )) $c" >> "$SHIMLOG"
exit $r
