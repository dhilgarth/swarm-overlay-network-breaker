set -e

STACK=$1
cdktf destroy $STACK --ignore-missing-stack-dependencies
rm -f terraform.$STACK.tfstate || true
rm -f terraform.$STACK.tfstate.backup || true
rm -f terraform.$STACK-services.tfstate || true
rm -f terraform.$STACK-services.tfstate.backup || true
rm -rf $STACK-ssh-control-socket || true
