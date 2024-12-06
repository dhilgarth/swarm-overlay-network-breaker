STACK=$1
ssh -O exit -S "${STACK}-ssh-control-socket" "root@swarm-manager-1" -F "/src/${STACK}/ssh.config"
rm -rf "${STACK}-ssh-control-socket"
