# Purpose

This repository contains an infrastructure setup and a deployment script that will break the overlay
network of a Docker Swarm cluster.  
The way it's implemented right now, it only reproduces issues with incorrect networkDB entries leading to packages being sent to incorrect nodes or not being routed to the containers on the correct nodes.  
It doesn't reproduce DNS bugs, because its always the same swarm services. To reproduce DNS bugs, instead of restarting the containers of the same services, we might need to delete and re-create the services themselves or perform DNS tests on container DNS names.

# Usage
To deploy this infrastructure, an account with Hetzner is needed. Create a new project in the cloud console and a new API token in the project.

## Preparations
Create a .env file with these entries:  
DOCKER_USER=\<username of docker hub>  
DOCKER_PASSWORD=\<password of docker hub account>  
HETZNER_TOKEN=\<the API token for the project in Hetzner>  

Additionally, add a fourth line:  
ADDITIONAL_SSH_KEY_NAME=\<name of SSH key in Hetzner cloud console>  

The docker account is needed to prevent rate limiting when pulling images and it is also needed for the network checker (see below) which creates an image and needs to push it.  
The additional SSH key is helpful to easily connect to the created servers from your local machine,
without the need to extract and store the automatically generated SSH key from the terraform state.  
You need to manually upload the public key in the Hetzner cloud console in the project under security -> SSH keys

## Deployment
Source `.env`, then run `deploy.sh` with the stack name, e.g. `./deploy.sh docker27`. This will deploy the complete system.

## System
- It will create the Hetzner cloud servers in the two German data centers of Hetzner
- It will setup a Docker Swarm cluster on those servers and two overlay networks
- It will install a few Docker Swarm services
  - network-watcher: A global service that reads the local network db on each node via the diagnostics port. For each entry, it asks the owner node if it really has a container with that IP. If not, the DB entry is considered bad and printed to STDOUT
  - crashing-service: A service that crashes right after starting. Goal: Quick succession of IP requests and IP to container associations
  - stressor: A global service that puts load on each node
  - network-breaker-global-{1-7}: 7 global services running traefik/whoami, attached to both networks with a dummy environment variable
  - network-breaker-replicated-{1-7}: 7 replicated services with 5 replicas each, connecting to the network-breaker-global services every 10 seconds. ALso with a dummy environment variable 
  - meshed-connection-tester: Two global services, one per data center with the containers being constraint to that data center that use memberlist to measure node reachability and latency outside of overlay networks

This is a simplification of the cluster environment in which I repeatedly had the issues with Docker Swarm overlay networks:
- Servers in two data centers
- load on the servers
- a service that crashes in a tight loop
- services that talk to each other
- the meshed connection tester
- the network watcher

After the initial deployment, this system will run just fine, so all of these factors aren't yet enough to break the networks

## Reproduction
First, connect to any of the created servers via SSH with two separate sessions. If you specified a local SSH key as additional key, this is as simple as `ssh root@<server-ip-from-terraform-output>`  
In one session, run `/show_watcher_logs.sh`, in the other, run `./network-checker.js`.  
Then, to actually reproduce the problem, run the deployment script with two additional "true" as parameter: `./deploy.sh docker27 true true`  

This will run the services deployment in a loop. Because the dummy environment variable on the network-breaker services is the current date time, they will be updated every time.
This script will update those services up to 150 times, but it may crash earlier, once the cluster has become unstable.

# Scripts
## show_watcher_logs
When no service update is happening, this script will print no messages about invalid entries / only messages about no invalid entries.  
When a service is currently deploying while the network-watcher checks the networkDB, it will print some messages about invalid entries. These will go away on their own, and are just attributed to the networkDB implementation being eventually consistent.
Once the network is broken, there will basically only be messages about invalid entries and nothing else.

## network-checker
This runs two global services, one per network, where the tasks end after each run. The task outputs are then gathered by the script and interpreted and output.  
While the network is okay, each column in the DNS lookup result should have the same IP address in all cells of the column and all GET request results should return 200.  
If a check is running during a deployment, there may be intermittent errors.  
However, there will be connection errors even when no deployments are running once the network is broken.  
Every check will show different services as having issues, which is due to the fact that each service has a container on each node, and every request usually uses a different container due to the service load balancer and not all entries in the network DB are incorrect.
