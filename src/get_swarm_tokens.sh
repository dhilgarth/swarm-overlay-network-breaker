#!/bin/bash

# Function to check if Docker Swarm is active
is_swarm_active() {
    docker info --format '{{.Swarm.LocalNodeState}}' 2>/dev/null | grep -q "active"
}

# Wait until Docker Swarm is initialized
# echo "Checking if Docker Swarm is active..."
until is_swarm_active; do
    # echo "Docker Swarm not active yet. Waiting for 5 seconds..."
    sleep 5
done

# echo "Docker Swarm is active."

# Retrieve the manager and worker join tokens
# echo "Retrieving Docker Swarm join tokens..."
MANAGER_TOKEN=$(docker swarm join-token -q manager)
WORKER_TOKEN=$(docker swarm join-token -q worker)

# Check if tokens were successfully retrieved
if [[ -z "$MANAGER_TOKEN" || -z "$WORKER_TOKEN" ]]; then
    # echo "Failed to retrieve join tokens. Ensure you have the necessary permissions."
    exit 1
fi

# Output the tokens in JSON format
echo '{"manager": "'"${MANAGER_TOKEN}"'", "worker": "'"${WORKER_TOKEN}"'"}'
