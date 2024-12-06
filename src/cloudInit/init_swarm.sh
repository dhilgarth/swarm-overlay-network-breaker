#!/bin/bash
docker_swarm_advertise_interface="enp7s0"
default_address_pool="192.168.64.0/19,192.168.96.0/19,192.168.128.0/19,192.168.160.0/19,192.168.192.0/19"

if [ -n "${docker_swarm_advertise_interface}" ]; then
  primary_manager_ip=$(ip -4 addr show "${docker_swarm_advertise_interface}" | grep -oP '(?<=inet\s)\d+(\.\d+){3}')
else
  primary_manager_ip=$(ip route get 1 | awk '{print $NF; exit}')
fi

DOCKER_SWARM_INIT_CMD="docker swarm init"

IFS=',' read -ra POOLS <<< "${default_address_pool}"
for pool in "${POOLS[@]}"; do
  DOCKER_SWARM_INIT_CMD+=" --default-addr-pool ${pool}"
done

if [ -n "${docker_swarm_advertise_interface}" ]; then
  DOCKER_SWARM_INIT_CMD+=" --advertise-addr ${primary_manager_ip}"
fi

swarm_init_output=$(${DOCKER_SWARM_INIT_CMD} 2>&1)

if echo "${swarm_init_output}" | grep -q "Swarm initialized"; then
  echo "Swarm initialized successfully."
else
  echo "Swarm initialization failed."
  echo "${swarm_init_output}"
fi
