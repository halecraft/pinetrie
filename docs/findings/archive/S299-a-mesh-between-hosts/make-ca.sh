#!/bin/sh
# A test CA and a certificate for "headscale", and a bundle every node trusts
# (the image's roots plus the CA), as setup.sh mounts them.
set -e
cd "$(dirname "$0")"; mkdir -p ca; cd ca
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout ca.key -out ca.pem -days 7 -subj "/CN=s299 test CA"
openssl req -newkey ec -pkeyopt ec_paramgen_curve:P-256 -nodes -keyout hs.key -out hs.csr -subj "/CN=headscale"
printf "subjectAltName=DNS:headscale\n" > ext.txt
openssl x509 -req -in hs.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out hs.pem -days 7 -extfile ext.txt
chmod 644 hs.key
docker run --rm s299-node cat /etc/ssl/certs/ca-certificates.crt > bundle.pem; cat ca.pem >> bundle.pem
