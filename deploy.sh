set -e

STACK=$1
ONLY_SERVICES=$2
LOOP_SERVICES=$3
if [ "$ONLY_SERVICES" != "true" ]; then
  cdktf deploy $STACK
fi
source ./create_docker_socket.sh $STACK
if [ "$LOOP_SERVICES" == "true" ]; then
  for ((i=0; i<150; i++)); do
    current_iteration=$((i + 1))
    echo "On iteration $current_iteration"
    cdktf deploy $STACK-services --ignore-missing-stack-dependencies --auto-approve
    if (( current_iteration % 10 == 0 )); then
      echo "Reached iteration $current_iteration. Sleeping for 10 seconds..."
      sleep 10
    fi
  done
else
  cdktf deploy $STACK-services --ignore-missing-stack-dependencies --auto-approve
fi
./close_docker_socket.sh $STACK
cdktf output $STACK
