STACK=$1
ssh -M -S "${STACK}-ssh-control-socket" -fnNT -o TCPKeepAlive=yes -o ServerAliveInterval=60 -o ServerAliveCountMax=3 -L "/tmp/${STACK}-docker.sock:/var/run/docker.sock" "root@swarm-manager-1" -F "/src/${STACK}/ssh.config"
export DOCKER_HOST="unix:///tmp/${STACK}-docker.sock"
