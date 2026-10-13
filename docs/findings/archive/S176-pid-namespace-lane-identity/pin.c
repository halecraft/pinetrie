#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/nsfs.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <unistd.h>
static unsigned long long ino(int fd){struct stat s;if(fstat(fd,&s)) {perror("fstat");exit(1);}return s.st_ino;}
int main(int argc,char **argv){if(argc!=3){fprintf(stderr,"usage: pin PID WAITFILE\n");return 2;}char p[64];snprintf(p,sizeof p,"/proc/%s/ns/pid",argv[1]);int fd=open(p,O_RDONLY|O_CLOEXEC);if(fd<0){perror(p);return 1;}printf("opened %llu\n",ino(fd));fflush(stdout);while(access(argv[2],F_OK)!=0)sleep(1);printf("after-exit %llu\n",ino(fd));int par=ioctl(fd,NS_GET_PARENT);if(par<0)printf("parent error=%s\n",strerror(errno));else{printf("parent %llu\n",ino(par));close(par);}close(fd);return 0;}
